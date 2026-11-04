# Tests: todo automatizado

El QA manual no es una etapa; queda como mirada opcional. Las capturas y reportes van a `docs/rq/<código>/qa/`.

## Matriz de capas

| Capa | Herramienta | Entorno |
|---|---|---|
| Lógica pura, hooks | Vitest | node |
| Componentes / UI aislada | Vitest Browser Mode, motor Playwright (Chromium real). Sin jsdom | navegador |
| SQL, RPC, RLS (un caso por rol), migraciones | Vitest contra Postgres local | base local |
| Edge functions | Vitest sobre módulos puros; `deno test` sólo para APIs exclusivas de Deno | stack local |
| Flujos, pantallas, regresión visual | Playwright Test (E2E y visual) | app local + base local |
| Procesos sensibles | Todo lo anterior + suite Vitest de **motor viejo vs nuevo** sobre un clon de PROD | clon local |

La matriz es la del stack de referencia (TypeScript + Supabase); en otro stack cada capa usa su herramienta (por ejemplo, el runner de tests del ERP o pytest para la lógica, y Playwright igual para el E2E). Los comandos de cada capa se declaran en `tests` de `proyecto.yml` y corren con el shell del sistema (cmd.exe en Windows): escribilos portables (`node`, `npx`) o declarà `tests.shell: bash`. Las versiones exactas de Vitest y Playwright se confirman con `context7` al implementar.

## Compuertas

- **Plan:** cada tarea declara las capas que toca y sus tests. Un plan sin esa matriz no se aprueba.
- **Commit:** de código de producto, sólo con tests corridos y registrados sobre lo que está en stage (`rq.mjs commit` o `registrar-tests`). Cada archivo de producto modificado tiene un test nuevo o modificado, o una justificación explícita en el plan.
- **Push:** suite completa verde más los flujos de Playwright marcados, y revisión registrada.

Hoy las compuertas verifican tests verdes registrados (commit) y, en el push, además la revisión registrada; los flujos de Playwright marcados y la regla de justificar archivos sin test se cumplen por disciplina. Que la **cobertura de líneas cambiadas** sea ≥ `cobertura_cambios_min` (80 %) y que **todo archivo de producto tenga un test** llegan con el sub-proyecto 4 (infraestructura de tests por proyecto); hasta entonces se cumplen por disciplina y en la revisión.

## Reglas de escritura

- TDD: el test falla primero (RED), después pasa (GREEN). Guardá la salida de ambos.
- RLS: un caso por rol, incluidos los que **no** deben poder.
- Procesos sensibles (facturación, cobros, altas y bajas masivas, migraciones de datos): la verificación es automática, motor viejo contra nuevo sobre un clon de PROD, con la misma entrada y resultados comparados.
- Un test que se arregla "para que pase" sin entender por qué falló no cuenta.
