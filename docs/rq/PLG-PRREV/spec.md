# PLG-PRREV · Revisor automático independiente en PR y push
Tipo: RQ · Clasificación: Arquitectónico · Repos: lineamientos-dev-claude-bacg
## Qué / Síntoma
Toda la revisión ocurre en la misma sesión que escribió el código, antes del PR. Lo que no pasa por ciclo-rq (Lovable, ediciones a mano) llega a DEV y PROD sin revisión.
## Por qué / Esperado vs. actual
Handoff del usuario (18/11, mejora 1): una segunda línea independiente que revise en GitHub con las reglas del proyecto, no criterios genéricos. Comenta y no bloquea, salvo hallazgos de seguridad críticos.
## Alcance (dentro / fuera)
Dentro: skill `revision-pr` del plugin; plantilla de workflow; comando de la CLI que la instala en un repo con sus ramas; paso recomendado del alta; texto en ciclo-rq sección 5.
Fuera: activar la protección de rama en GitHub (lo hace un admin; se documenta); cargar el secret (lo hace el usuario); reemplazar la revisión multi-pasada (no la reemplaza).
## Toca: UI [ ] · sensible [x] (secrets de CI) · migraciones [ ] · varias sedes [ ]
## ARQ: amerita — suma una integración (GitHub Actions + API de Claude) y un secret (arq.md)
## Criterio de aceptación → flujo E2E que lo prueba
1. `$RQ revisor-pr` escribe `.github/workflows/bacg-revisor.yml` con `pull_request` hacia `ramas_solo_pr` + `ramas_prod` del repo y `push` a esas ramas → tests/revisor-pr.test.mjs.
2. El workflow no contiene ninguna clave: sólo `${{ secrets.ANTHROPIC_API_KEY }}` → mismo test.
3. La skill nombra `reglas.md`, los ADR vigentes, el canon de UI y el checklist de `general/seguridad.md` (PLG-SEG), y define "crítico" → test de contenido.
4. En vivo (paso manual, necesita el secret en un repo): un PR de prueba con un error a propósito recibe el comentario; un push de Lovable que sólo toca `.lovable/**` también → `manual:prueba-revisor-en-repo` con la evidencia (link al PR y al run).

## Diseño
### Criterios centrales
1. Revisa con las reglas del proyecto y el checklist de seguridad, no con criterios genéricos.
2. Nunca hay una clave en el repo.
3. Sólo un hallazgo de seguridad crítico pone el check en rojo; lo demás es comentario.

- **Motor:** `anthropics/claude-code-action@v1` (docs oficiales leídas el 18/11/2026). Instala por `plugin_marketplaces` nuestro marketplace (el repo es público) y `claude-plugins-official`, con `plugins: lineamientos-dev-claude-bacg@lineamientos-dev-claude-bacg` y `pr-review-toolkit@claude-plugins-official`. `prompt: /lineamientos-dev-claude-bacg:revision-pr <contexto>`.
- **Skill `revision-pr`:** lee el diff (PR o rango del push), `.bacg-dev/reglas.md`, `.bacg-dev/adr/` vigentes, `ui.canon` de `proyecto.yml` y el checklist de seguridad del plugin. Tres focos: calidad y convenciones, errores silenciados, seguridad (checklist). En un PR: comentarios en línea (`mcp__github_inline_comment__create_inline_comment`) y uno de resumen. En un push: un comentario en el commit. Escribe `bacg-revision.json` con `{ "criticos": n }`.
- **Crítico** = hallazgo de los puntos 1 a 5 del checklist (acceso, entradas, sesiones, secretos, datos personales) con evidencia en el diff. Último paso del workflow: falla si `criticos > 0`.
- **Disparadores:** `pull_request` (opened, synchronize, reopened, ready_for_review) a las ramas de DEV y PROD; `push` a esas ramas **sólo si el autor es un agente externo** (`agentes_externos` / autores de Lovable), para no revisar dos veces lo que ya vino por PR.
- **Secret:** `ANTHROPIC_API_KEY` a nivel organización (recomendado por la doc para secrets compartidos); `CLAUDE_CODE_OAUTH_TOKEN` como alternativa comentada en la plantilla. Costo acotado con `--max-turns` y `concurrency`.
- **Instalación:** `$RQ revisor-pr [--repo <nombre>]` renderiza la plantilla con las ramas del repo y la deja para commitear; el alta suma el paso recomendado `revisor-pr` por repo del proyecto que no lo tenga, con el recordatorio del secret y de la protección de rama.
- **ciclo-rq sección 5:** "El revisor del PR es una segunda línea independiente; no reemplaza las pasadas de esta sección."
- Depende de PLG-SEG (el checklist). Versión 4.7.0 con la tanda.

## Tareas
El plan con sus tareas está en `docs/rq/PLG-PRREV/plan.md` (Arquitectónico).

### Desvíos decididos al ejecutar (19/11)
- La plantilla vive en `plugin/plantillas/bacg-revisor.yml` (viaja con el plugin instalado), no en `plantillas/repo-proyecto/`: la compuerta de edición toma esa carpeta como otro proyecto (PLG-PLANT).
- En un push, el resumen va al resumen del job (`bacg-revision.md` → `$GITHUB_STEP_SUMMARY`), no a un comentario del commit: comentar un commit pide `contents: write` y el revisor sólo lee.
- `revisor-pr` instala en el repo actual (sin `--repo`): cada repo del proyecto lo corre desde su checkout.
- Endurecido tras la revisión: token `GITHUB_TOKEN` (respeta `permissions`, sin `id-token`), `gh api` acotado a archivos del PR y comentarios, `Write` sólo a `bacg-revision.*`, se borran los `bacg-revision.*` que traiga el PR, sin forks ni Dependabot, y si no hubo revisión el check avisa en vez de quedar verde en silencio (no rojo: criterio central 3).
