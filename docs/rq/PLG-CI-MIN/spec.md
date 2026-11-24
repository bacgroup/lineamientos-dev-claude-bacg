# PLG-CI-MIN · Que el ciclo no queme minutos de GitHub Actions
Tipo: RQ · Clasificación: Acotado · Repos: lineamientos-dev-claude-bacg (después, derivación a dev-fullflow)
## Qué / Síntoma
CRM AHRAI pasó los 2000 min/mes de Actions (≈2102, del 1 al 23/11): 28 de 68 corridas del CI por push a main fueron de
commits de sólo docs del ciclo (cierre, OK de PROD, revisión, traza…), cada una ~16 min. Handoffs:
docs/handoff/2026-11-23-crm-minutos-actions.md y la sección 1 de docs/handoff/2026-11-23-punapp-r-qa-ci2.md.
## Por qué / Esperado vs. actual
Actual: cada commit de docs del ciclo, en su propio push, dispara el CI completo. Esperado: los commits de sólo docs
llevan `[skip ci]` (decisión del usuario del 24/11: prendido por defecto, se apaga por proyecto), después del merge los
registros de docs viajan en un solo push al cierre, y el arranque avisa los workflows que corren por docs.
## Alcance (dentro / fuera)
Dentro: puntos 1, 2 y 4 del handoff de CRM; 1.1 a 1.3 de PunAPP como guía y aviso. Fuera: un workflow de CI genérico
(los stacks difieren: Node, Odoo, n8n), el punto 5 opcional (compuerta de push de docs) y editar el CI de cada proyecto.
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: no aplica — mensajes de commit de la CLI, un aviso del arranque y documentación.
## Criterio de aceptación → flujo E2E que lo prueba
1. El commit de `cerrar` y el de `$RQ commit` con sólo docs llevan `[skip ci]` si todo lo que falta subir también es de
   docs (revisión integral: GitHub mira el commit de punta); con código sin subir, sin remoto o con `ci.skip_docs: false`,
   no. Docs = textos, registros y capturas de `docs/` y `.md` de la raíz; un SQL en `docs/` o un `.md` de `.bacg-dev/`, no.
2. El arranque avisa cada workflow `on: push` / `pull_request` sin filtro que deje afuera `docs/**`: "cada commit de
   docs del ciclo corre <workflow>". También avisa si el filtro deja afuera `.bacg-dev/**` (ahí están `rojos_conocidos`
   y los comandos de tests) y si un test lee archivos de una ruta excluida (`readFileSync`/`?raw`/`import.meta.glob`
   con `docs/`).
3. ciclo-rq (secciones 6 y 7): los registros de docs posteriores al merge se commitean y viajan en un solo push, el de
   `cerrar`; el agente pone `[skip ci]` en sus commits de sólo docs salvo `ci.skip_docs: false`.
4. `plugin/general/ci.md`: el filtro recomendado (`paths:` con `'**'`, exclusiones `!docs/**`, `!**/*.md` y re-inclusión
   de lo que lee la suite; nunca excluir `.bacg-dev/**`), `concurrency` y revisar los workflows de sync o despliegue.
→ tests de la CLI y del arranque (`tests/ci-min.test.mjs`, en `npm run test:e2e`).

## Diseño

### Enfoques
- **A (elegido) — la CLI marca sus commits de docs, la skill ordena los pushes y el arranque señala el CI que corre
  por docs.** Funciona en cualquier proyecto, tenga o no filtro.
- B — plantilla de workflow con el filtro. Descartada como entregable: cada proyecto tiene su CI; queda la guía (ci.md)
  con el bloque para copiar.
- C — compuerta que niegue pushes de docs repetidos (punto 5). Descartada por ahora: con A y la regla de la skill
  alcanza; si no, se suma después.

### Partes
- **`lib/ci.mjs`:** `saltarCi(proyecto)` (true salvo `ci.skip_docs === false`), `soloDocs(rutas)` y `conSkipCi(msg)`
  (agrega ` [skip ci]` a la primera línea si no lo tiene); `avisosCi(raiz)` lee `.github/workflows/*.yml` con js-yaml y
  devuelve los avisos del criterio 2.
- **`rq.mjs`:** `registrarCierre` y `commit` (rama de sólo docs) usan `conSkipCi` cuando corresponde.
- **`hooks/session-start.mjs`:** suma las líneas de `avisosCi` (como el aviso de tests relacionados).
- **ciclo-rq y `general/ci.md`**, CHANGELOG.

## Tareas
1. `lib/ci.mjs` con `saltarCi`, `soloDocs`, `conSkipCi` + tests.
2. `[skip ci]` en `cerrar` y en `commit` de sólo docs + tests.
3. `avisosCi` y el arranque + tests.
4. ciclo-rq, `general/ci.md`, CHANGELOG, `test:e2e` y backlog (decisiones de PLG-CICLO-CONFIG y PLG-WORKTREE).
