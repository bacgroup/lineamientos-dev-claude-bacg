# PLG-DFF2 · Compuertas de cumplimiento, OK flexibles, Superpowers como eje, revisión de calidad y journey UX
Tipo: RQ · Clasificación: Arquitectónico · Repos: bacgroup/lineamientos-dev-claude-bacg

## Qué
El plugin pasa de controlar que las skills **se cargaron** a controlar que **se cumplieron**. Además, deja de frenar la autonomía con un OK por etapa.

## Por qué
- El retrabajo de R-MOD-V2 (22 devoluciones, unos 82 puntos, 6 casos de producto encontrados por el usuario) está en `nkick25/dev-fullflow` → `docs/rq/PLG-DFF2/propuesta.md` y `retrabajo-r-mod-v2.md`.
- Hay cuatro premisas del usuario (15/11):
  1. Los OK son rígidos y la autonomía vuelve a pedir OK.
  2. Superpowers dejó de ser el eje.
  3. La revisión de código es floja en calidad.
  4. Los mockups y el journey UX son optativos.

## Alcance
**Dentro**
- OK flexibles y autonomía total.
- Superpowers como motor obligatorio.
- Revisión multi-pasada y vigente.
- Journey y mockups obligatorios en UI.
- Compuertas de cumplimiento: P-4, cambio 1, cambio 2, P-11, P-14, P-16 y P-17.
- El plugin como su propio proyecto.

**Fuera (backlog)**
- P-1 y P-2 automatizados.
- P-3 `cotejar`.
- P-5, P-6, P-7, P-9, P-10, P-12, P-18 y P-19.
- Cambios 3, 9 y 10 de la propuesta.

## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: amerita (más de 10 archivos; cambia el contrato de aprobaciones y de compuertas) — sin ADR nuevo: no hay `adr/` del proyecto plugin; la decisión queda en este spec y en el CHANGELOG.

## Criterio de aceptación → flujo E2E que lo prueba
- S-1: con `autonomia total`, un Arquitectónico pasa de la etapa 0 a DEV con una sola frase del usuario. PROD sigue pidiendo `aprobar 5`. → `tests/ok-flexible.test.mjs`
- S-2: `ok "<frase>"` registra de una vez todas las decisiones pendientes hasta DEV, y la frase cuenta como un solo uso. → `tests/ok-flexible.test.mjs`
- S-3: una frase de aprobación vale como tramo entre comas si trae un verbo de aprobación y ninguna negación. → `tests/ok-flexible.test.mjs`
- S-4: un RQ de ciclo 4.4 exige `writing-plans` (también en Acotado), TDD y la skill de ejecución antes del primer commit de código, y `requesting-code-review` y `verification-before-completion` en la etapa 3. → `tests/superpowers-eje.test.mjs`
- S-5: `revision ok` exige las pasadas `pr-review-toolkit:code-reviewer`, `pr-review-toolkit:pr-test-analyzer` y `revisor-rq` (el hook registra los subagentes). La revisión vence si hay commits de código posteriores. → `tests/revision-calidad.test.mjs`
- S-6: editar UI (salvo cambio menor) exige en `## Diseño`: `### Journey` (3 pasos o más), `### Mockups` (archivo en `docs/rq/<código>/mockups/` o URL de Figma), `### Referencias leídas` y `### Paridad`. → `tests/journey-mockups.test.mjs`
- S-7: las skills de UI valen por contexto: después de una compactación, la compuerta de UI las vuelve a pedir. → `tests/journey-mockups.test.mjs`
- S-8: con UI, `verificar --local` exige capturas a 390, 768 y 1280, y `ref-*.png` si hay referencia. → `tests/journey-mockups.test.mjs`
- S-9: `devolucion` lleva la lista cerrada de puntos. Al segundo punto sobre el mismo elemento corta la iteración, y la revisión ok exige que no queden puntos pendientes. → `tests/devoluciones.test.mjs`
- S-10: `trazar` arma `traza.yml` desde el spec, y la revisión ok exige un estado por ítem y un test en los "hecho". → `tests/traza.test.mjs`
- S-11: el diseño de un Arquitectónico de ciclo 4.4 exige `### Criterios centrales`. → `tests/traza.test.mjs`
- E2E del plugin: `npm run test:e2e` (ciclo completo de la CLI en repos temporales) y `npm test` sin rojos nuevos.

## Diseño

### Enfoques considerados
1. **Sólo texto en las skills.** Barato, pero es lo que falló en R-MOD-V2: las reglas existían y nadie las cumplía. Descartado.
2. **Compuertas de cumplimiento con evidencia en disco, versionadas por RQ (elegido).** La CLI y los hooks verifican artefactos concretos: secciones del spec, archivos en `mockups/`, capturas, `traza.yml`, subagentes en la transcripción y el estado de las devoluciones. Las reglas nuevas aplican a los RQ abiertos con la 4.4 o más (`ciclo: 4.4` en `estado.yml`): los RQ en curso no se rompen y los tests viejos siguen valiendo.
3. **Un agente orquestador propio que reemplace a Superpowers.** Duplica Superpowers, contradice la premisa 2 y es caro de mantener. Descartado.

### Criterios centrales
- C-1: el usuario da un OK y el agente avanza hasta DEV sin volver a pedirlo. PROD es la única parada.
- C-2: nada se da por hecho sin evidencia verificable (artefacto, test o captura).
- C-3: Superpowers es el motor; las skills de BACG lo refuerzan y no lo reemplazan.

### 1. OK flexibles y autonomía (premisa 1)
- **`$RQ autonomia total "<frase>"`:** autonomía de sesión de nivel total.
  - Cubre, en toda clasificación, Arquitectónico incluido:
    - confirma la clasificación propuesta;
    - aprueba diseño y plan cuando están escritos (`## Diseño` y `## Tareas`, o `plan.md` en Arquitectónico);
    - registra la ejecución (por defecto `inline`; `--ejecucion subagentes`);
    - da autonomía hasta DEV, incluido el OK de DEV del Arquitectónico (`aprobar 4`).
  - Nunca cubre PROD ni los saltos de compuertas.
  - Se registra con `via: sesion-total`. `autonomia aplicar` la vuelve a aplicar cuando el diseño o el plan se escriben después.
- **`$RQ ok "<frase>"`:** una respuesta del usuario cubre todas las decisiones pendientes del RQ hasta DEV (las mismas de arriba), cada una con `via: ok` y un `grupo` común. `usosDeFrase` cuenta un grupo como un solo uso.
- **Tramos naturales:** además del mensaje entero o la oración, vale un tramo separado por comas que traiga un verbo de aprobación (ok, dale, apruebo, aprobado, adelante, avanzá, seguí, confirmo, de acuerdo, sí, listo, perfecto) y no traiga negación (no, ni, nunca, todavía, esperá, frená, pará, stop). Con eso, "Sí, dale, pero mañana revisamos" registra "Sí, dale".
- **La skill deja de explicar el parser:** se hace una sola pregunta con opciones numeradas y se registra la respuesta con `ok`.

### 2. Superpowers como eje (premisa 2)
Diagnóstico ([Seguro], por `requisitos.mjs` y `ciclo-rq`):
- Se exigían sólo `brainstorming`, `systematic-debugging`, `writing-plans` (únicamente en Arquitectónico), TDD (recién en la etapa 3) y `verification-before-completion` (recién en PROD).
- `requesting-code-review` estaba prohibida.
- La skill decía que "el resto es opcional" y anulaba `using-superpowers`.

Ciclo 4.4:
- **Etapa 2** (antes del primer commit de código): `brainstorming`, `writing-plans` (Acotado y Arquitectónico; en Acotado su salida va a `## Tareas`), `test-driven-development` y la skill de la ejecución elegida (`executing-plans` o `subagent-driven-development`). En BUG, además `systematic-debugging`.
- **Etapa 3:** `requesting-code-review` (dispara la revisión de la sección 3), `verification-before-completion` y, si hubo una revisión bloqueante, `receiving-code-review`.
- `ciclo-rq` declara a Superpowers obligatorio y completo. Sólo hay tres excepciones, que son reemplazos deliberados:
  - spec y plan van a `docs/rq/`;
  - `finishing-a-development-branch` → `$RQ entregar`;
  - la aprobación es una sola.

  Se borra "el resto es opcional".

### 3. Revisión de calidad multi-pasada (premisa 3)
- **Agente propio `plugin/agents/revisor-rq.md`.** Revisa el diff del RQ contra:
  - el spec (criterios, `traza.yml`, criterios centrales);
  - la paridad y los duplicados de componentes y cálculos compartidos (cambio 5, lección 12);
  - las invariantes de dominio y la cobertura de combinaciones (P-15);
  - el canon del proyecto.

  Devuelve hallazgos clasificados.
- **Pasadas exigidas en la 4.4:**
  - `superpowers:requesting-code-review`;
  - `pr-review-toolkit:code-reviewer` (calidad y convenciones);
  - `pr-review-toolkit:pr-test-analyzer` (calidad de los tests);
  - `lineamientos-dev-claude-bacg:revisor-rq`.

  Condicionales, por guía de la skill:
  - `silent-failure-hunter` (manejo de errores);
  - `type-design-analyzer` (tipos nuevos);
  - `code-simplifier` o `/simplify` (reuso);
  - `claude-security` (sensible).
- **Registro:** el hook `PostToolUse` suma `Agent|Task` y anota el `subagent_type` con prefijo de plugin como skill del RQ.
- **Revisión vigente:** `revision ok` guarda `head`. Si después entran commits de código, deja de valer y `faltaParaEtapa` vuelve a pedirla.

### 4. Journey y mockups en UI (premisa 4)
- Todo cambio de UI que no sea menor exige, en `## Diseño`:
  - `### Journey`: los pasos del usuario, con rol, pantalla, decisión y datos; 3 o más ítems.
  - `### Mockups`: uno o más archivos en `docs/rq/<código>/mockups/` (HTML navegable estilo Figma, PNG o SVG) o una URL de figma.com.
  - `### Referencias leídas`: archivo y componente, leídos enteros, o "no aplica — motivo".
  - `### Paridad`: elemento, referencia, nuevo y cómo (reusa / reimplementa / fuera), o "no aplica — motivo".
- Lo exige la compuerta de edición de UI.
- `diseno-frontend`:
  - el mockup es obligatorio y deja de ser una propuesta;
  - `/prototype` y los mockups definen layout y dirección, nunca estilos (cambio 4);
  - la checklist tiene evidencia.
- **`verificar --local` con UI:** pide capturas cuyo nombre trae 390, 768 y 1280 y, si `### Referencias leídas` no dice "no aplica", al menos una `ref-*.png` (cambio 1).
- **P-4:** la compuerta de UI cuenta sólo las skills cargadas desde la última compactación. `leerTranscript` devuelve `skillsContexto`.

### 5. Lista cerrada de devoluciones y corte por vueltas (P-11, P-14)
- **Comandos:**
  - `$RQ devolucion agregar "<punto>" [--elemento <x>]`
  - `$RQ devolucion <n> hecho|consultado|rechazado "<evidencia>"`
  - `$RQ devolucion` (lista)
- Se guarda en `estado.devoluciones`.
- Al agregar el segundo punto sobre un mismo elemento, la CLI imprime el protocolo de corte: captura junto a la referencia, causa raíz en una línea, transcripción literal del pedido y mockups que la cumplan.
- La revisión ok y el cierre exigen que no queden puntos pendientes.

### 6. Trazabilidad y criterios centrales (P-16, P-17)
- **`$RQ trazar`:** lee los ítems de `## Criterio de aceptación` (`S-n:` o viñetas) y crea o completa `docs/rq/<código>/traza.yml` con `id`, `texto`, `archivos`, `test` y `estado` (hecho | parcial | fuera).
- La revisión ok de la 4.4 (Acotado y Arquitectónico) exige un estado por ítem y un `test` en cada "hecho".
- El diseño de un Arquitectónico de la 4.4 exige `### Criterios centrales`.
- `ciclo-rq` agrega una regla: toda recomendación estructural se contrasta con los criterios centrales; si rompe alguno, es una decisión del usuario y no un "costo menor".

### Lo que queda al implementador
Nombres internos, mensajes y los detalles de los tests. Los tests nuevos replican el estilo de `tests/helpers.mjs`.
