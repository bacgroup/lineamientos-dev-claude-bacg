# PLG-E2E-ALC · E2E con alcance y suite completa una sola vez
Tipo: RQ · Clasificación: Acotado · Repos: lineamientos-dev-claude-bacg (después, derivación a dev-fullflow)
## Qué / Síntoma
`tests.e2e` sin `{specs}` hace que cada `verificar` corra la suite E2E entera (39 specs en CRM, ~20 en PunAPP), varias
veces por RQ, sin que nada lo avise. Con `{specs}`, el agente tiende a resolver un RQ sin specs propios con `--completo`.
Handoff: docs/handoff/2026-11-23-crm-e2e-con-alcance.md (incluye PLG-E2E-COMPLETO).
## Por qué / Esperado vs. actual
Actual: tiempo, máquina y tokens por corrida completa repetida, y el lock del E2E frena a otras sesiones. Esperado: el
alta y el arranque avisan el placeholder faltante, `verificar` dice cuándo corrió todo y cuánto tardó, y la suite
completa corre una vez antes de PROD.
## Alcance (dentro / fuera)
Dentro: puntos 1 a 6 del handoff. Fuera: cambiar la compuerta de PROD (sigue exigiendo un E2E completo en verde).
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: no aplica — cambio interno de la CLI, el alta y la skill.
## Criterio de aceptación → flujo E2E que lo prueba
1. `tests.e2e` sin `{specs}` → paso del alta `tests-e2e-alcance` en aviso (no obligatorio) con el ejemplo; con `{specs}`, ok.
2. El arranque y `estado` muestran "tests.e2e corre la suite completa en cada verificar: agregá {specs}" cuando falta.
3. `verificar` sin `{specs}` dice que corrió la suite completa por falta del placeholder y cuánto tardó (toda corrida dice su duración).
4. Cada `verificar --completo` suma `e2e_completos`; `estado` avisa si hay más de uno antes de la etapa 5.
5. `tests.e2e_mapa` (glob de código → specs) suma specs a los del diff; sin specs, el error sugiere elegir los de la
   pantalla tocada (o declarar el mapa) antes que `--completo`.
6. La plantilla `proyectos/_plantilla/proyecto.yml` dice que sin placeholder se corre la suite completa siempre.
→ tests de la CLI (`tests/e2e-alcance.test.mjs`, en `npm run test:e2e`) y de `tests/alta.test.mjs`.

## Diseño

### Enfoques
- **A (elegido) — avisos y contador, sin cambiar las compuertas.** El placeholder sigue siendo opcional (un runner que no
  acepta specs sueltos puede seguir sin él); el plugin lo hace visible en el alta, el arranque, `verificar` y `estado`.
- B — exigir `{specs}` (paso obligatorio del alta). Descartado: rompe proyectos cuyo runner no acepta specs.
- C — que `verificar` ignore `--completo` repetidos. Descartado: una corrida completa después de un arreglo grande puede
  ser legítima; se avisa, no se impide.

### Partes
- **Alta (lib/alta.mjs):** paso `tests-e2e-alcance` (no obligatorio) después del de E2E, sólo si hay `tests.e2e`:
  `aviso` sin `{specs}` con ejemplo `npx playwright test {specs}`; `ok` con él. El paso `tests-rel` (PLG-TEST-INFRA)
  ya cubre `tests.unit` con `{archivos}`.
- **Arranque (hooks/session-start.mjs):** como el de `tests-rel`, una línea "Aviso: tests.e2e corre la suite completa
  en cada verificar: agregá {specs}".
- **verificar (rq.mjs):** mide la duración y la imprime (`en 3m 12s`); sin `{specs}` agrega "suite completa: tests.e2e
  no usa {specs}". Con `--completo` y `{specs}`, suma `estado.e2e_completos`.
- **estado (rq.mjs):** con `e2e_completos > 1` antes de la etapa 5: "Corriste la suite E2E completa N veces: va una sola,
  justo antes de pedir el OK de PROD".
- **Mapa (rq.mjs `specsDelRq`):** `tests.e2e_mapa: { "<glob de código>": ["<spec>", …] }`; los specs de los globs que
  coinciden con rutas del RQ se suman a los del diff (sin duplicados, sólo los que existen). Usa `globARegExp` de lib/rutas.mjs.
- **Mensaje sin specs:** sugiere `$RQ verificar <spec de la pantalla tocada>` o declarar `tests.e2e_mapa`, y deja
  `--completo` para antes de PROD.
- **ciclo-rq (sección 4, E2E live):** `--completo` una sola vez, justo antes de pedir el OK de PROD, nunca después de
  cada corrección; mencionar `tests.e2e_mapa`.
- **Plantilla:** comentario junto a `unit` y `e2e`.

## Tareas
1. Alta `tests-e2e-alcance` y aviso del arranque + tests en alta.test.mjs.
2. `verificar`: duración, aviso de suite completa y `e2e_completos` + tests (e2e-alcance.test.mjs).
3. `estado`: aviso de más de una corrida completa antes de la etapa 5 + test.
4. `tests.e2e_mapa` en `specsDelRq` y mensaje sin specs + tests.
5. ciclo-rq, plantilla, CHANGELOG 4.8.0 y `test:e2e`.
