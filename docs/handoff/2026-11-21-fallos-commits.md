# Por qué fallan tantos commits: causa raíz y soluciones

Fecha: 21/11/2026. Origen: análisis pedido durante UX-07 (proyecto CRM, plugin de origen dev-fullflow). El código
citado (`correrTests` en `plugin/scripts/rq.mjs`, `fallosDe` y `soloRojosConocidos` en `plugin/scripts/lib/cli.mjs`)
es el mismo en este plugin, así que las mejoras G1-G5 aplican acá.

## Datos (15/11 al 21/11, 42 commits rechazados por tests, 13 RQ)

| Qué pasó | Corridas | Qué significa |
|---|---|---|
| Algún test superó su tiempo (`Test timed out in 5000ms / 15000ms / 30000ms`) | 32 | Un test de pantalla en jsdom tarda ~1 s solo y más de 5 s con la PC cargada |
| Vitest perdió la comunicación con un worker (`[vitest-worker]: Timeout calling "onTaskUpdate"`, `Unhandled Error`) | 32 (casi siempre junto con lo anterior) | La suite termina con código 1 aunque los tests pasen |
| Todos los tests pasaron y sólo hubo el timeout del worker | 5 | Rechazo sin ningún test rojo (dos en UX-07: 1608/1608 en verde) |
| Un test rojo de verdad, sin timeouts | 4 | Falla real que el commit tenía que frenar |

~38 de 42 rechazos (~90 %) no fueron errores del código sino de tiempo. Cada reintento cuesta 3-5 min (suite entera).

## Causa raíz

1. **Cada commit corre la suite completa** (del proyecto): `tests.unit: "npm test"` sin `{archivos}`; `conArchivos`
   no tiene qué reemplazar y corre ~196 archivos / ~1600 tests.
2. **La suite corre en una PC muy cargada** (de entorno): Supabase local en Docker, servidores de desarrollo,
   edge functions y a veces Playwright en paralelo.
3. **El plugin no distingue una falla de infraestructura de un test rojo** (del plugin): `fallosDe` devuelve vacío
   cuando todos pasaron, `soloRojosConocidos` devuelve no y se rechaza igual. No reintenta los timeouts, y
   `rojos_conocidos` no sirve porque caen cada vez en un test distinto.
4. **El lock del E2E no cubre los tests de commit** (del plugin): un commit corre la suite unitaria mientras
   Playwright usa la CPU.
5. **Tests con un límite propio corto** (del proyecto; corregido en UX-07).

## Mejoras del plugin

| # | Cambio | Dónde | Fila del backlog |
|---|---|---|---|
| G1 | Todos los tests pasaron y sólo hay error de infraestructura de vitest/jest: reintentar una vez; si se repite, decir "falla de infraestructura, no de tests" | `correrTests`, `fallosDe` | PLG-TEST-INFRA |
| G2 | Los únicos fallos son `Test timed out`: volver a correr sólo esos archivos una vez antes de rechazar, anotarlo como inestable en estado.yml | ídem | PLG-TEST-INFRA |
| G5 | Guardar en docs/log/rq.jsonl la clase de cada rechazo (rojo / timeout / infraestructura) | `correrTests` | PLG-TEST-INFRA |
| G3 | No correr los tests de commit mientras un E2E tiene el lock: esperar o avisar | `correrTests` + lock de `verificar` | PLG-TEST-LOCK |
| G4 | En alta/arranque, avisar si `tests.unit` no tiene `{archivos}` y sugerir el comando de tests relacionados del stack (vitest related, jest --findRelatedTests, pytest con archivos) | alta / arranque | PLG-TEST-REL |

## Del proyecto y del entorno (no van a este backlog)

- P1 `tests.unit: "npx vitest related --run {archivos}"`; P2 `testTimeout: 15_000` global; P3 limpiar `rojos_conocidos`.
- Apagar servidores y edge functions que no se usan; no commitear durante un E2E (lo automatiza G3).
