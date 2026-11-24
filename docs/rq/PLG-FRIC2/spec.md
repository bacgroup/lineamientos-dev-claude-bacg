# PLG-FRIC2 · Fricciones del ciclo vistas en R-QA-CI2 (PunAPP)
Tipo: RQ · Clasificación: Acotado · Repos: lineamientos-dev-claude-bacg (después, derivación a dev-fullflow)
## Qué / Síntoma
Handoff docs/handoff/2026-11-23-punapp-r-qa-ci2.md, sección 2 (puntos 2.1 a 2.7). Las secciones 1 y 2.8-2.9 van en
PLG-CI-MIN, PLG-CICLO-CONFIG y PLG-WORKTREE.
## Por qué / Esperado vs. actual
Cada fricción obliga a un rodeo manual (repetir la frase con el "1- ", revertir a mano un estado.yml ajeno, deshacer un
stage, completar el backlog) o deja un test sin correr.
## Alcance (dentro / fuera)
Dentro: 2.1 a 2.7. Fuera: el detalle de qué archivos viajan a sedes (lo decide el workflow de sync de cada proyecto).
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: no aplica — correcciones internas de la CLI y un hook.
## Criterio de aceptación → flujo E2E que lo prueba
1. (2.1) Una frase dicha en una lista ("1- Omití el E2E…", "2. …", "- …", "* …", "• …") se reconoce sin el marcador.
2. (2.2) Con dos RQ en ACTIVO, un push cuyos commits nombran sólo a uno anota el paso sólo en ése; si ningún commit
   nombra a un RQ activo, sigue anotándose en todos (como hoy).
3. (2.3) Si una compuerta o los tests frenan `$RQ commit`, lo que la CLI agregó al stage vuelve a como estaba.
4. (2.4/2.5) Un commit de sólo tests corre esos tests cuando `tests.unit` usa `{archivos}`; sin el placeholder, lo dice.
   La revisión vence como con cualquier commit (ya es así): queda alineado.
5. (2.6) `paso no-aplica merge-prs-sync:<sede> "<motivo>"` se acepta después del push y sin PR de sync abierto en esa
   sede; si no se pueden consultar los PR, se rechaza (falla cerrada). `push:` sigue sin poder marcarse.
6. (2.7) `abrir --prioridad Alta|Media|Baja --impacto "<texto>"` los guarda y completa la fila del backlog.
→ tests de la CLI y del hook (`tests/fric2.test.mjs`, en `npm run test:e2e`) y de `tests/transcript*.test.mjs`.

## Diseño

### Enfoques
- **A (elegido) — una corrección por fricción, en el lugar donde nace**, cada una con su test; sin cambiar el modelo
  del ciclo.
- B — para 2.2, atribuir el push por el rango pusheado (`<remoto>..<local>`). Más preciso, pero el hook no siempre ve las
  refs del push (HEAD:main, push sin argumentos, PowerShell). Queda A: los commits alcanzables desde HEAD (300) que
  nombran el código, con el comportamiento de hoy como respaldo.

### Partes
- **2.1 `lib/transcript.mjs` `vecesQueLoDijo`:** a cada oración se le quita el marcador de lista inicial
  (`^\s*(?:\d+\s*[-.)]|[-*•])\s+`) antes de comparar.
- **2.2 `lib/hooks/post-tool.mjs` `anotar`:** candidatos = RQ activos cuyo código aparece como palabra en los asuntos del
  rango que informa git en la salida del push (`abc..def  dev -> main`) o, si no lo informa, de `git log -300 HEAD`; si
  hay alguno, sólo ésos; si no, todos los activos.
- **2.3 `rq.mjs` `commit`:** se guarda la lista en stage antes de `agregarRutas`; si algo lanza antes del `git commit`,
  `git reset -q -- <rutas que agregó la CLI>`, y el mensaje lo dice.
- **2.4 `rq.mjs` `commit` y `correrTests`:** sin archivos de producto y con archivos de test en stage (`*.test.*`,
  `*.spec.*` fuera de `e2e/`, `tests/**`, `__tests__/**`), corre `tests.unit` con esos archivos si el comando tiene
  `{archivos}`; si no, "sólo docs y tests: sin correr tests (tests.unit no usa {archivos})". No exige el desarrollo
  (un commit de sólo tests sigue siendo libre).
- **2.6 `rq.mjs` `marcarNoAplica`:** `merge-prs-sync:` deja de ser obligatorio para no-aplica; antes consulta los PR de
  sync abiertos de la sede (`prsAbiertos`), sólo con un `push:` ya registrado: si hay uno abierto o no pudo consultar, rechaza
  (revisión integral: antes quedaba `sin_verificar` y fallaba abierto).
- **2.7 `rq.mjs` `abrir`:** opciones `--prioridad` (Alta, Media o Baja) e `--impacto`; van a `estado.prioridad` /
  `estado.impacto` y a la fila del backlog (sólo si la fila no los tiene).

## Tareas
1. 2.1 frases en lista + tests.
2. 2.2 push atribuido por commits + test en hooks.
3. 2.3 deshacer el stage + 2.4 commit de sólo tests + tests.
4. 2.6 no-aplica de merge-prs-sync + test.
5. 2.7 abrir con prioridad e impacto + test.
6. ciclo-rq, CHANGELOG y `test:e2e`.
