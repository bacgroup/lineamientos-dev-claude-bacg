# PLG-SP · Superpowers como columna vertebral (segunda pasada)
Tipo: RQ · Clasificación: Acotado · Repos: lineamientos-dev-claude-bacg
## Qué / Síntoma
El ciclo exige 6 skills de Superpowers por etapa (`requisitos.mjs:205-224`), pero el arranque le dice al agente que **no** aplique la regla de using-superpowers de invocar toda skill que aplique (`session-start.mjs:70-73`). `systematic-debugging` sólo se exige en BUG: un RQ con un E2E rojo se arregla a ojo. `dispatching-parallel-agents` no aparece en el plugin.
## Por qué / Esperado vs. actual
Pedido del usuario (18/11): Superpowers como columna vertebral obligatoria del proceso. Esperado: toda skill de Superpowers cuya descripción aplique se usa; la tabla de ciclo-rq es el mínimo, no el máximo; un rojo se depura con método. Actual: la tabla es el máximo y el resto queda opcional.
## Alcance (dentro / fuera)
Dentro: texto del arranque (`REGLA_SKILLS`); `systematic-debugging` exigido en un RQ que tuvo un E2E rojo; ciclo-rq (2, 2.2 y 5) y `general/proceso.md`.
Fuera: `finishing-a-development-branch` y `using-git-worktrees` siguen reemplazadas por la entrega del plugin (sus compuertas de PROD); se explica el motivo en ciclo-rq. Las skills que no son de Superpowers siguen por tabla, compuerta o pedido (costo de tokens).
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: no aplica — cambio de reglas de proceso y una exigencia más en la CLI
## Criterio de aceptación → flujo E2E que lo prueba
1. El arranque dice que toda skill de Superpowers que aplique se invoca y que la tabla es el mínimo → tests/hooks.test.mjs.
2. Un RQ con un `verificar` en rojo exige `superpowers:systematic-debugging` para la revisión ok; sin rojos, no → tests/rq-cli.test.mjs y tests/revision-calidad.test.mjs.
3. ciclo-rq nombra `dispatching-parallel-agents` para las pasadas de la sección 5 y explica por qué se reemplazan las dos skills de entrega → test de contenido.

## Diseño
- **`REGLA_SKILLS` nueva:** "Superpowers es la columna del ciclo: invocá toda skill de Superpowers cuya descripción aplique a lo que estás por hacer (la tabla de ciclo-rq es el mínimo exigido, no el máximo). Las de otros plugins, sólo las de la tabla, las que pida el usuario y las que exija la compuerta." Así se recupera la regla de using-superpowers para su propio motor sin cargar skills ajenas (el motivo original era el costo de tokens).
- **Rojo → método:** `verificar` cuenta los E2E en rojo en `estado.e2e_rojos`; con reglas 4.4, si es > 0, la revisión ok exige `superpowers:systematic-debugging` (como hoy en BUG). También en CI rojo ya lo pide el texto de la sección 6.
- **ciclo-rq:** sección 2: "Las demás skills de Superpowers se usan siempre que su descripción aplique" (reemplaza "No hace falta invocar…"); sección 5: las tres pasadas se lanzan con `superpowers:dispatching-parallel-agents`; sección 2.2: una línea del porqué de los dos reemplazos (la entrega tiene compuertas de PROD que esas skills no conocen).
- `general/proceso.md`: misma regla en una línea.
- Versión 4.7.0 con la tanda.

## Tareas
1. Test rojo en `tests/hooks.test.mjs` (texto de la regla) y `tests/etapas.test.mjs` (rojo → systematic-debugging exigido; sin rojo, no).
2. `session-start.mjs`: `REGLA_SKILLS`.
3. `rq.mjs` (`verificar`): `estado.e2e_rojos` += 1 cuando falla; `requisitos.mjs` (`exigencias44`): exigir `systematic-debugging` en VERIFICACION si `e2e_rojos > 0`.
4. Textos de ciclo-rq y proceso.md.
5. Suite completa en verde.
