# PLG-DFF2 Plan de implementación

> **Ejecución:** `superpowers:executing-plans` en línea, registrada con la autonomía total de la sesión. Un commit por tarea con `$RQ commit`.

**Objetivo:** que la versión 4.4.0 del plugin controle el cumplimiento, no la carga, y que deje de frenar la autonomía.

**Arquitectura:**
- Las reglas nuevas viven en módulos chicos de `plugin/scripts/lib/`: `reglas`, `ok`, `diseno-ui`, `devoluciones` y `traza`.
- La CLI (`rq.mjs`), las compuertas (`requisitos.mjs` y `compuerta-edicion.mjs`) y los hooks los consumen.
- Todo lo nuevo aplica sólo si `estado.reglas >= 44`.

**Stack:** Node 22 ESM, `node:test` y el `js-yaml` vendorizado.

**Spec:** `docs/rq/PLG-DFF2/spec.md`

## Restricciones globales
- **Compatibilidad.** Los RQ sin `reglas: 44` se comportan igual que en la 4.3.1, y los 608 tests de hoy siguen en verde.
- **PROD.** Nunca lo cubre `ok`, `autonomia total` ni ningún tramo flexible: sigue pidiendo `aprobar 5`.
- **Saltos.** Siguen pidiendo la frase literal del usuario, y ninguna autonomía los registra.
- **Texto en español rioplatense,** como el resto del plugin.

## Foco de la revisión
1. Negación dentro de un tramo ("no, dale después no"): no debe registrarse como OK.
2. Una frase de `ok` reusada para un segundo `ok` en el mismo RQ: no debe contar dos veces sin que el usuario la repita.
3. Una transcripción con compactación y sin skills después: la compuerta de UI debe pedir de nuevo `diseno-frontend`.
4. Una revisión ok seguida de un commit de sólo docs: debe seguir vigente.
5. `traza.yml` mal formado o ausente: falla cerrada, con un mensaje que dice cómo armarlo (`$RQ trazar`).

---

### Tarea 1: marca de reglas 4.4
**Archivos:**
- Crear: `plugin/scripts/lib/reglas.mjs`
- Modificar: `rq.mjs` (`abrir` y subcomando `reglas`)
- Test: `tests/reglas-44.test.mjs`

**Interfaces:** produce `REGLAS_ACTUALES = 44` y `reglas44(estado): boolean`.

- [ ] Test: `abrir` deja `reglas: 44`; `reglas actualizar` lo pone en un RQ viejo; un estado sin la clave → `reglas44` da false.
- [ ] Implementar y correr `npm test`.
- [ ] Commit.

### Tarea 2: OK flexibles y autonomía total (S-1, S-2, S-3)
**Archivos:**
- Crear: `plugin/scripts/lib/ok.mjs`
- Modificar: `plugin/scripts/lib/transcript.mjs` (`vecesQueLoDijo`), `rq.mjs` (`usosDeFrase`, `aplicarAutonomia`, `autonomia total`, `ok`) y `compuerta-bash.mjs` (si niega los subcomandos nuevos)
- Test: `tests/ok-flexible.test.mjs`

**Interfaces:** produce `tramoDeAprobacion(tramo): boolean`, con `RE_APROBACION` y `RE_NEGACION`.

- [ ] Tests:
  - "Sí, dale, pero mañana revisamos" registra "Sí, dale".
  - "no, dale después" no registra "dale después".
  - `autonomia total` en un Arquitectónico con `## Diseño` y `plan.md` deja la clasificación, `aprobar 1`, la ejecución inline y la autonomía hasta 4, todo con `via: sesion-total`.
  - Sin `plan.md`, avisa que falta.
  - `ok "<frase>"` registra todo lo pendiente con `via: ok` y `grupo`, y `usosDeFrase` da 1.
  - Un segundo `ok` con la misma frase falla.
  - `etapaCumplida(PROD)` sigue en false.
- [ ] Implementar y correr `npm test`.
- [ ] Commit.

### Tarea 3: Superpowers como eje (S-4)
**Archivos:**
- Modificar: `plugin/scripts/lib/requisitos.mjs` (`exigencias`)
- Test: `tests/superpowers-eje.test.mjs`

- [ ] Tests con `reglas: 44`:
  - Etapa 2: `brainstorming`, `writing-plans` (Acotado y Arquitectónico), `test-driven-development` y `executing-plans` o `subagent-driven-development` según `estado.ejecucion.modo` (inline si falta). En BUG, además `systematic-debugging`.
  - Etapa 3: `requesting-code-review` y `verification-before-completion`; `receiving-code-review` si `estado.revisiones_bloqueantes > 0`.
  - Sin la marca, las exigencias de la 4.3.
- [ ] Implementar, correr `npm test` y commit.

### Tarea 4: revisión multi-pasada y vigente (S-5)
**Archivos:**
- Crear: `plugin/agents/revisor-rq.md`
- Modificar: `plugin/hooks/hooks.json` (matcher `Agent|Task` en `PostToolUse`), `plugin/scripts/lib/hooks/post-tool.mjs` (anota el `subagent_type` con `:` como skill), `requisitos.mjs` (pasadas exigidas en la etapa 3 con 4.4; `revisionVigente`) y `rq.mjs` (`revision` guarda `head`; un bloqueante incrementa `revisiones_bloqueantes`)
- Test: `tests/revision-calidad.test.mjs`

**Interfaces:**
- `PASADAS_REVISION = ['pr-review-toolkit:code-reviewer', 'pr-review-toolkit:pr-test-analyzer', 'lineamientos-dev-claude-bacg:revisor-rq']`
- `revisionVigente(raiz, estado, proyecto): boolean`

- [ ] Tests:
  - El hook con `tool_name: Agent` anota la pasada.
  - `revision ok` sin pasadas falla y nombra las que faltan.
  - Un commit de código posterior a `head` hace que `faltaParaEtapa(PROD)` pida la revisión otra vez.
  - Un commit de sólo docs no.
- [ ] Implementar, correr `npm test` y commit.

### Tarea 5: journey, mockups, referencias y paridad; skills por contexto; capturas (S-6, S-7, S-8)
**Archivos:**
- Crear: `plugin/scripts/lib/diseno-ui.mjs`
- Modificar: `compuerta-edicion.mjs`, `transcript.mjs` (`skillsContexto`: se vacía en `compact_boundary` / `isCompactSummary`), `hooks/pre-tool.mjs` (le pasa `skillsContexto`) y `rq.mjs` (`verificarLocal`)
- Test: `tests/journey-mockups.test.mjs`

**Interfaces:**
- `faltasDisenoUi(raiz, codigo): string[]`, que controla:
  - `### Journey` con 3 ítems o más;
  - `### Mockups` con un archivo en `mockups/` o una URL de figma.com;
  - `### Referencias leídas`;
  - `### Paridad`.
- `refExigida(raiz, codigo): boolean`

- [ ] Tests:
  - Con `reglas: 44`, editar UI sin journey o sin mockup → deny con la lista de lo que falta; con todo → allow.
  - Con la skill cargada sólo antes de una compactación → deny ("cargala de nuevo").
  - `verificar --local` sin 390, 768 o 1280 → error; sin `ref-*.png` con referencia → error; con "no aplica" → ok.
- [ ] Implementar, correr `npm test` y commit.

### Tarea 6: devoluciones y corte por vueltas (S-9)
**Archivos:**
- Crear: `plugin/scripts/lib/devoluciones.mjs`
- Modificar: `rq.mjs` (subcomando `devolucion`, revisión y cierre)
- Test: `tests/devoluciones.test.mjs`

**Interfaces:** `agregar(estado, texto, elemento)`, que devuelve `{ n, corte: boolean }`, y `pendientes(estado)`, que devuelve un array.

- [ ] Tests:
  - El segundo punto del mismo elemento imprime el protocolo de corte.
  - `revision ok` con pendientes → error.
  - Marcar un punto "hecho" exige evidencia.
- [ ] Implementar, correr `npm test` y commit.

### Tarea 7: traza y criterios centrales (S-10, S-11)
**Archivos:**
- Crear: `plugin/scripts/lib/traza.mjs`
- Modificar: `rq.mjs` (subcomando `trazar`, revisión y `aprobar 1` / autonomía en Arquitectónico 4.4)
- Test: `tests/traza.test.mjs`

**Interfaces:**
- `itemsDelSpec(texto)` devuelve `[{ id, texto }]` y lee `## Criterio de aceptación` (respeta `S-n:`; si no, numera).
- `faltasTraza(raiz, codigo)` devuelve un array.

- [ ] Tests:
  - `trazar` crea `traza.yml` y conserva lo que ya estaba completado.
  - La revisión ok exige un estado por ítem y un test en cada "hecho".
  - Un Arquitectónico 4.4 sin `### Criterios centrales` no se aprueba.
- [ ] Implementar, correr `npm test` y commit.

### Tarea 8: skills, documentos, versión y E2E
**Archivos:**
- `ciclo-rq/SKILL.md`: Superpowers obligatorio, `ok` y `autonomia total`, revisión multi-pasada, devoluciones, `trazar`, criterios centrales. Mover 1.1, 2.0.1, 2.3 y 8 a `references/`.
- `diseno-frontend/SKILL.md`: checklist con evidencia, mockup obligatorio, `/prototype` sin estilos.
- `decision-arq/SKILL.md`: la ruta única del ADR.
- Descripciones de `design-taste-frontend` y `redesign-existing-projects`, acotadas.
- `plantillas/`, si hay una plantilla de spec.
- `README.md`, `CHANGELOG.md` (4.4.0), `plugin.json`, `marketplace.json` y `docs/backlog.md` (las filas diferidas).
- Verificación: `npm test` (sólo los rojos conocidos) y `$RQ verificar` (E2E de la CLI).
- [ ] Commit.
