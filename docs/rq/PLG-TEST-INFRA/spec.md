# PLG-TEST-INFRA · Commits sin rechazos falsos y canon de UI al cierre
Tipo: RQ · Clasificación: Acotado · Repos: lineamientos-dev-claude-bacg (port a nkick25/lineamientos-dev → dev-fullflow)
## Qué / Síntoma
~90 % de los commits rechazados por tests en CRM (38 de 42, 15-21/11) no fueron código rojo sino tiempo: tests que
superan su límite bajo carga o el worker de vitest que no contesta con todo en verde. El plugin no distingue esos casos,
no reintenta, no deja registro de la clase del rechazo ni avisa que `tests.unit` corre la suite entera. Además, el
cierre no pregunta si el RQ decidió un lineamiento de UI nuevo que debería quedar en el canon.
## Por qué / Esperado vs. actual
Actual: cada rechazo falso cuesta 3-5 min y un reintento manual. Esperado: el plugin reintenta una vez lo que no es un
test rojo, dice qué clase de falla fue, la anota y avisa en el alta cómo correr sólo los tests relacionados.
## Alcance (dentro / fuera)
Dentro: G1, G2, G5 (PLG-TEST-INFRA), G4 (PLG-TEST-REL) y pregunta de canon al cierre (PLG-CANON-CIERRE).
Fuera: G3 (PLG-TEST-LOCK) y los cambios del proyecto CRM (P1-P3).
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: no aplica — cambio interno de la CLI y la skill, sin contratos, datos ni despliegue nuevos.
## Criterio de aceptación → flujo E2E que lo prueba
1. Salida con todos los tests en verde y error de worker → se reintenta una vez; si vuelve a pasar, el mensaje dice
   "falla de infraestructura, no de tests" → tests de `correrTests` con un comando falso que imprime esa salida.
2. Salida cuyos únicos fallos son `Test timed out` → se reintenta una vez; si pasa, el commit sigue y el test queda
   anotado como inestable en estado.yml.
3. Un test rojo de verdad → se rechaza como hoy, sin reintento.
4. Cada rechazo deja su clase (rojo / timeout / infraestructura) en estado.yml y el cierre la resume en docs/log/rq.jsonl.
5. `tests.unit` sin `{archivos}` → el alta muestra un aviso (no obligatorio) con el comando sugerido del stack.
6. Al cerrar un RQ que tocó UI en un proyecto con `ui.canon`, `cerrar` no avanza hasta registrar si hay lineamiento
   nuevo para el canon → E2E de la CLI (`npm run test:e2e`) con un RQ de UI.

## Diseño

### Enfoques
- **A (elegido) — reintento del mismo comando, una vez.** Sirve para cualquier runner (vitest, jest, pytest, Odoo)
  sin armar comandos propios. Con `{archivos}` (PLG-TEST-REL) el comando ya es corto, así que el reintento cuesta poco.
- B — reintentar sólo los archivos con timeout. Más rápido con la suite entera, pero exige armar el comando de cada
  runner (vitest, jest) y falla con scripts propios (`npm test` que envuelve otra cosa). Queda como mejora si A no alcanza.
- C — subir los timeouts desde el plugin. Descartado: es configuración del proyecto (P2), no del plugin.

### Clasificación de la falla (lib/cli.mjs, `claseFalla(salida)`)
- `infraestructura`: el resumen dice que no falló ningún test ni archivo (vitest `Test Files`/`Tests`, jest `Test Suites:`/`Tests:`)
  y el runner perdió un worker (`[vitest-worker]`, `Timeout calling "onTaskUpdate"`, `Channel closed`); un error que vitest
  atribuye a un archivo de test ("This error originated in") es rojo.
- `timeout`: hay fallos y todos vienen de `Test timed out in <n>ms` / `Exceeded timeout of <n> ms`, contados por test distinto
  (vitest y jest repiten cada fallo en un segundo reporte).
- `rojo`: cualquier otro caso (falla cerrada: ante la duda, rojo).

### Comportamiento en `correrTests` (rq.mjs)
- `rojo`: igual que hoy.
- `infraestructura` o `timeout`: avisa en una línea y reintenta el mismo comando **una vez**. Si el reintento pasa, sigue y
  anota `estado.tests.inestables` (fecha, clase, tests). Si falla de nuevo, rechaza con un mensaje por clase:
  "Falla de infraestructura del runner, no de tests (todos pasaron): …" o "Tests que superan su tiempo dos veces seguidas: …",
  y la pista de `tests.unit` con `{archivos}` si no lo usa.
- Cada rechazo suma a `estado.tests.rechazos` (`{ rojo, timeout, infraestructura }`); se conservan entre corridas.
- Las variables `BACG_DEV_SIN_REINTENTO=1` apagan el reintento (para CI o para quien lo prefiera).

### Log (G5)
`registrarCierre` agrega `rechazos_tests` y `tests_inestables` a la línea de docs/log/rq.jsonl cuando existen.

### Aviso de tests relacionados (PLG-TEST-REL, lib/alta.mjs)
Paso no obligatorio `tests-rel`: si `tests.unit` (o el de la PC) no tiene `{archivos}`, estado `aviso`:
"Cada commit corre la suite entera" + comando sugerido según el repo (vitest → `npx vitest related --run {archivos}`,
jest → `npx jest --findRelatedTests {archivos}`; pytest no tiene equivalente y, como cualquier runner no reconocido, va sin sugerencia).
Se ve en `$RQ alta` y en la línea del alta del arranque.

### Canon de UI al cierre (PLG-CANON-CIERRE)
- Si el RQ tocó UI (archivos de `ui.patrones` en sus commits o `Toca: UI [x]`) y el proyecto declara `ui.canon`,
  `cerrar` frena con: "¿Este RQ decidió un lineamiento de UI nuevo que debe ir al canon (<ruta>)?".
- Se responde con `$RQ canon no "<frase del usuario>"` o `$RQ canon documentado` (verifica que el archivo del canon
  cambió en commits de la rama del RQ y no tiene cambios sin commitear). Sin `ui.canon` declarado, pregunta igual y sugiere crearlo.
- ciclo-rq sección 7: antes de `cerrar`, preguntarle al usuario y, si dice que sí, escribir el lineamiento en el canon.

### Port a dev-fullflow
El código es idéntico (`correrTests`, `cerrar`, `alta.mjs`): el mismo parche se aplica en una rama de
nkick25/lineamientos-dev. Esta sesión no puede pushear ahí (falta la app de GitHub en esa cuenta): queda como patch.

## Tareas
1. `claseFalla` + tests (cli.mjs) — TDD con salidas reales de vitest/jest.
2. Reintento, mensajes, `inestables` y `rechazos` en `correrTests` + tests en rq-cli.
3. `rechazos_tests` e `inestables` en `registrarCierre` + test.
4. Paso `tests-rel` en alta.mjs + tests en alta.test.mjs.
5. `canon` en `cerrar` + subcomando `$RQ canon` + tests y caso E2E.
6. ciclo-rq SKILL.md (sección 7) y README/CHANGELOG (versión 4.8.0); fila PLG-CANON-CIERRE en el backlog.
7. Port: patch para nkick25/lineamientos-dev (dev-fullflow) con sus tests en verde.
