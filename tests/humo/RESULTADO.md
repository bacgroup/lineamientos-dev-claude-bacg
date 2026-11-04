# Prueba de humo — bacg-dev 0.1.0

Fecha: 2026-10-23. Claude Code 2.1.236, Windows 11, Node 24.

## Qué se probó y cómo

- El plugin **no** se instaló en la configuración global. Se cargó por sesión con `--plugin-dir C:\MiCarpeta\lineamientos-bacg\plugin`.
- Repo demo en el scratchpad de la sesión: `...\scratchpad\humo\demo-app` (git, rama `main`, sin remoto), con `.bacg-lineamientos` = `proyecto: demo`, `src/lib/x.ts` y un commit inicial. `BACG_LINEAMIENTOS_DIR=C:\MiCarpeta\lineamientos-bacg\tests\fixtures\lineamientos` (proyecto `demo` del fixture).
- Comando base de cada sesión:

  ```
  claude -p "<prompt>" --plugin-dir "C:\MiCarpeta\lineamientos-bacg\plugin" --model haiku --output-format json --permission-mode acceptEdits --allowedTools "Edit,Write,Read"
  ```

### Limitación: el modelo no llegó a correr

Todas las sesiones `claude -p` terminaron con `"result": "Failed to authenticate: OAuth session expired and could not be refreshed"` (`claude auth status` → `loggedIn: false`). La sesión que lanzó la prueba corre dentro de la app de escritorio, que autentica por su cuenta; el CLI suelto no tiene credenciales vigentes y `--bare` exige API key. Iniciar sesión es una acción del usuario.

Lo que **sí** corrió de verdad dentro de Claude Code, antes del fallo de autenticación:

- la carga del plugin desde `--plugin-dir`;
- los hooks `SessionStart` y `UserPromptSubmit` del plugin, con su salida guardada en el transcript;
- el transcript real de la sesión (`~/.claude/projects/<repo demo>/<session_id>.jsonl`), con el prompt del humano.

Para las compuertas se corrió el hook `PreToolUse` **con el mismo comando de `hooks.json`** (`node "<plugin>/scripts/hooks/pre-tool.mjs"`, `CLAUDE_PLUGIN_ROOT` apuntando al plugin), con el stdin que arma Claude Code (`session_id`, `transcript_path` del transcript real de cada sesión, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`). Lo único simulado es la llamada a la herramienta que el modelo habría pedido. Queda pendiente repetir los cuatro casos con el modelo corriendo (ver "Pendiente").

## Paso 1 — validación de manifiestos

```
claude plugin validate C:\MiCarpeta\lineamientos-bacg\plugin
  Validating plugin manifest: ...\plugin\.claude-plugin\plugin.json
  ✔ Validation passed

claude plugin validate C:\MiCarpeta\lineamientos-bacg
  Validating marketplace manifest: ...\.claude-plugin\marketplace.json
  ✔ Validation passed
```

Veredicto: **OK**, sin errores ni avisos.

## Contexto de arranque: ruta del CLI

Sesión `938f5a2f-…` (la del caso a). Adjunto `hook_additional_context` de `SessionStart` en el transcript:

```
# Lineamientos (bacg-dev): proyecto demo

CLI del RQ: node "C:\MiCarpeta\lineamientos-bacg\plugin\scripts\rq.mjs" (usá esta ruta exacta donde la skill ciclo-rq dice $RQ).
...
RQ activo: ninguno.

Faltan plugins requeridos. Pedile al usuario que corra:
/plugin install security-guidance@claude-plugins-official
...
```

Y el de `UserPromptSubmit`:

```
Proyecto demo. RQ activo: ninguno. Antes de cambiar código o base: skill bacg-dev:ciclo-rq (...). Registrá cada aprobación con rq.mjs aprobar.
```

Veredicto: **OK**. La ruta inyectada es absoluta y existe. No se pudo hacer la pregunta al modelo ("¿Qué dice el contexto de arranque sobre el CLI del RQ?") por la autenticación; la verificación es sobre el contexto que Claude Code registró como inyectado.

## (a) Edición sin RQ

- Sesión: `claude -p "Editá src/lib/x.ts agregando una línea \`export const y = 2;\`" …` → `session_id 938f5a2f-abfc-423b-bda1-70f7c23c12b6`.
- `PreToolUse` `Edit` sobre `src/lib/x.ts` con ese transcript:

```
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
 "permissionDecisionReason":"No hay RQ activo. Clasificá el pedido y abrilo con: node ${CLAUDE_PLUGIN_ROOT}/scripts/rq.mjs abrir <código> --tipo rq|fix --clasificacion <...>"}}
```

Veredicto: **bloqueada, como se esperaba**. Observación: el motivo muestra `${CLAUDE_PLUGIN_ROOT}` literal en lugar de la ruta resuelta (ver "Observaciones").

## (b) RQ bounded con una aprobación que el usuario nunca dio

Preparación en el repo demo (sin commitear `docs/rq/`):

```
node rq.mjs abrir R-DEMO --tipo rq --clasificacion bounded   → RQ R-DEMO abierto.
node rq.mjs etapa 1                                          → Etapa 1.
node rq.mjs aprobar 1 "frase inventada que el usuario nunca dijo"  → Aprobación de la etapa 1 registrada.
```

- Sesión nueva con el mismo prompt → `session_id 2368cec8-a040-4eee-ba86-be4bda99ad64`. El `UserPromptSubmit` ya reporta `R-DEMO, etapa 1` y el relevo.
- `PreToolUse` `Edit`:

```
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
 "permissionDecisionReason":"Falta la etapa 2 (plan aprobado) del RQ R-DEMO; si es bounded, falta la etapa 1 (diseño aprobado)."}}
```

Veredicto: **sigue bloqueada, como se esperaba**: la aprobación registrada no aparece en ningún mensaje del humano de la sesión.

## (c) `git push` sin la etapa 4

- Sesión: `claude -p "Corré git push origin main" … --allowedTools "Bash"` → `session_id d30b7b97-dd05-4ee1-8d15-85a771cb85cb`.
- `PreToolUse` `Bash` `git push origin main`:

```
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
 "permissionDecisionReason":"Falta la etapa 4 (tests en verde y revisión sin bloqueantes) del RQ R-DEMO."}}
```

- Control: el mismo `git push origin main` fuera de la compuerta falla distinto: `fatal: 'origin' does not appear to be a git repository`.

Veredicto: **bloqueado por la compuerta, como se esperaba** (el mensaje es el de la etapa 4, no el de git).

## (d) Aprobación dentro del prompt del humano

Preparación: `node rq.mjs aprobar 1 "Diseño aprobado"` (queda junto a la inventada; `estado` lista las dos).

- Sesión: `claude -p "Diseño aprobado. Editá src/lib/x.ts agregando \`export const y = 2;\`" …` → `session_id 17e63b95-5632-48a0-8231-c28c74416c7c`.
- Entrada del humano tal como la escribe `claude -p` en el transcript (sin `isMeta`, sin `origin`, `content` como string):

```
{"type":"user","isSidechain":false,"promptSource":"sdk","permissionMode":"acceptEdits",
 "message":{"role":"user","content":"Diseño aprobado. Editá src/lib/x.ts agregando `export const y = 2;`"}, ...}
```

- `PreToolUse` `Edit` con ese transcript: salida vacía, exit 0 → **allow**.
- Control: la misma aprobación contra el transcript de (b), donde el humano no la escribió → `deny` ("Falta la etapa 2 … falta la etapa 1").

Veredicto: **permitida, como se esperaba**. El lector del transcript reconoce el prompt real de una sesión sin interfaz; no hizo falta tocar el código de las compuertas.

## Resumen

| Caso | Esperado | Resultado |
|---|---|---|
| validate plugin + marketplace | sin errores | OK |
| ruta del CLI en el arranque | absoluta | OK (`C:\MiCarpeta\lineamientos-bacg\plugin\scripts\rq.mjs`) |
| (a) edición sin RQ | deny | deny |
| (b) aprobación inventada | deny | deny |
| (c) push sin etapa 4 | deny | deny |
| (d) aprobación en el prompt | allow | allow |

## Observaciones

- Los motivos de deny de la compuerta de edición (y el aviso sin RQ) todavía dicen `node ${CLAUDE_PLUGIN_ROOT}/scripts/rq.mjs`, sin resolver. El contexto de arranque sí da la ruta absoluta, así que el agente tiene de dónde sacarla, pero la decisión R20 pedía la ruta resuelta también en los mensajes de deny.
- Con `--plugin-dir`, el `SessionStart` avisa que faltan los plugins requeridos (security-guidance, claude-security, pr-review-toolkit, feature-dev, typescript-lsp, claude-md-management): en esta máquina no están instalados. Es el comportamiento esperado.

## Pendiente

El estado del repo demo no está commiteado, a propósito: `docs/rq/` con R-DEMO (bounded, etapa 1, dos aprobaciones de la etapa 1, la inventada y "Diseño aprobado"). Commitearlo haría valer las aprobaciones por `estado.yml` commiteado y anularía los casos (b) y (d). Queda guardado en el scratchpad (`...\scratchpad\humo\demo-app`) para repetir la prueba. Para repetir (b) tal cual, hay que sacar antes la aprobación "Diseño aprobado" (abrir de nuevo el RQ en un repo limpio).

Repetir (a)–(d) y la pregunta sobre el CLI con el modelo corriendo, después de que el usuario inicie sesión en el CLI (`claude auth login` o `/login`), con los mismos comandos de arriba. Lo que falta verificar ahí es sólo que Claude Code respeta el `deny` del hook y se lo muestra al modelo (`permission_denials` en la salida JSON).
