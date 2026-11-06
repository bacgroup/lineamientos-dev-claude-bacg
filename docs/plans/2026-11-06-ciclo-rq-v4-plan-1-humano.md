# Ciclo RQ v4 · Plan 1: ciclo humano Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar el plugin a 4.0.0 con el ciclo humano v4: etapas 0–6, arranque inicio/reanudación, clasificación confirmada con nombres nuevos, diseño y plan unificados con `brainstorming` siempre, ejecución elegida por el usuario, Odoo condicional y los puntos M1, M2, M4–M7 del handoff absorbido.

**Architecture:** La numeración vive en un módulo nuevo (`lib/etapas.mjs`) y todo `estado.yml` se normaliza a v4 al cargarse, así el resto del código sólo conoce la numeración nueva. Clasificación y arranque son módulos nuevos y chicos; `rq.mjs` sólo suma subcomandos que los llaman. El circuito autómata queda para el Plan 2: acá no se toca `autonomia` más allá de renumerarla.

**Tech Stack:** Node ≥ 22, ESM, `node:test` + `node:assert/strict`, git por `child_process`. Sin dependencias nuevas.

**Spec:** `docs/specs/2026-11-06-ciclo-rq-v4-design.md` (secciones 3–8, 10–12). El Plan 2 cubre la sección 9.

## Global Constraints

- Etapas v4: 0 Arranque y clasificación · 1 Diseño y plan · 2 Desarrollo · 3 Verificación · 4 DEV / Preview · 5 PROD y entrega · 6 Cierre.
- Nombres visibles: Exploración / Acotado / Arquitectónico. Valores en `estado.yml`: `spike` / `bounded` / `arquitectonico` (sin cambio).
- `estado.yml` nuevo lleva `version_ciclo: 4`; sin el campo es v3 y se convierte al leer (etapas y aprobaciones ≥ 2 → −1), sin reescribir el archivo hasta el próximo comando que escriba.
- `proyecto.yml` sin `version_ciclo: 4`: `skills_requeridas[].etapa` 3→2, 4→3, 6→5.
- Toda frase (`aprobar`, `autonomia`, `saltar`, `clasificacion`, `ejecucion`) es texto literal del usuario; la compuerta de frases lo verifica.
- Sin Odoo (ni declarado ni detectado): ninguna compuerta, mensaje ni línea del arranque nombra Odoo.
- Detección de Odoo: `__manifest__.py` a profundidad ≤ 3 desde la raíz del repo, cacheado por proceso.
- Verificación local (M1): al menos una captura, guardada en `docs/rq/<código>/qa/`.
- Versión 4.0.0 en `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (si la nombra) y `CHANGELOG.md`.
- Sin push, sin PR, sin merge: el plan termina en commits locales en `plg-ciclo-ui`.
- Tests por archivo: `node --import ./tests/setup-env.mjs --test tests/<archivo>.test.mjs`. La suite completa (`npm test`, ~53 min en esta PC) se corre una sola vez, en la tarea 12, en segundo plano.

## Review Focus

1. Un RQ abierto con 3.x en etapa 5 y `aprobar 6` registrado: tras actualizar, `estado` muestra etapa 4 con la aprobación como 5, y `aprobar 6` sobre ese RQ se traduce a 5 con aviso. → test en Tarea 3.
2. Un `proyecto.yml` externo (en `.bacg-dev/` de otro repo) sin `version_ciclo` con `skills_requeridas` en etapa 6: se exige en la 5, no se pierde. → test en Tarea 3.
3. RQ multi-repo: el repo secundario hereda la clasificación confirmada y la ejecución elegida; no vuelve a bloquear la edición. → test en Tarea 5 y Tarea 7.
4. Sesión en una carpeta padre que no es repo (caso PowerFy): `arranque` lista los repos de debajo y no falla. → test en Tarea 10.
5. `abrir` sobre rama protegida sin upstream o en detached HEAD: mensaje claro, el RQ igual se abre, nada de excepción. → test en Tarea 8.

---

### Task 1: Tests y commit de M5 y M7 ya escritos

Ya existen sin commitear: `plugin/scripts/lib/arbol.mjs`, `plugin/scripts/lib/ramas.mjs` y los cambios de `compuerta-bash.mjs` (árbol testeado, commit en rama protegida, frase de `clasificacion`). Esta tarea sólo los cubre con tests.

**Files:**
- Test: `tests/arbol.test.mjs` (nuevo), `tests/ramas.test.mjs` (nuevo), `tests/compuerta-bash.test.mjs`
- Commit: `plugin/scripts/lib/arbol.mjs`, `plugin/scripts/lib/ramas.mjs`, `plugin/scripts/lib/compuerta-bash.mjs`

**Interfaces:**
- Produces (ya escritos): `arbolTesteado(dir): string`, `arbolCompleto(dir): string`, `testsValenParaStage(tests, dir): boolean`, `esPropioDeLaCli(rel): boolean`, `PROPIOS_DE_LA_CLI: string[]`; `ramaActual(raiz): string|null`, `ramasProtegidas(proyecto, raiz): string[]`, `enRamaProtegida(raiz, proyecto): string|null`, `ramaDelRq(codigo): string`, `pasarARamaDelRq(raiz, codigo): {rama, desde, creada}|{error}`.

- [ ] **Step 1: Tests de `arbol.mjs`** en `tests/arbol.test.mjs` con un repo de `crearRepoTemporal`:
  - `arbolTesteado ignora estado.yml`: con `src/a.js` en stage, el hash es igual antes y después de `git add docs/rq/R-1/estado.yml`; `arbolCompleto` cambia.
  - `arbolTesteado no toca el índice real`: `git diff --cached --name-only` es idéntico antes y después.
  - `testsValenParaStage acepta el árbol completo viejo`: `{ok:true, arbol: arbolCompleto(dir)}` → `true`; `{ok:false, …}` → `false`.
  - `esPropioDeLaCli`: `true` para `docs/rq/X/estado.yml`, `docs/rq/ACTIVO`, `sub/docs/backlog.md`; `false` para `docs/rq/X/spec.md`.
- [ ] **Step 2: Tests de `ramas.mjs`** en `tests/ramas.test.mjs`, con un remoto bare local como `origin`:
  - `pasarARamaDelRq crea desde el upstream si HEAD sólo está atrás` → `{rama:'rq/R-1', creada:true, desde:'origin/18.0-dev'}`.
  - `pasarARamaDelRq crea desde HEAD si hay commits propios` → `desde:'HEAD'` y el commit local está en `rq/R-1`.
  - `pasarARamaDelRq toma la rama existente` → `creada:false`.
  - `enRamaProtegida` con `ramas_solo_pr: ["18.0-dev"]` → `'18.0-dev'`; en `rq/R-1` → `null`; en detached HEAD → `null`.
- [ ] **Step 3: Casos en `tests/compuerta-bash.test.mjs`**:
  - `commit en rama sólo-PR se niega` (mensaje contiene `sólo recibe cambios por PR` y `rq/R-1`); con `saltar rama` registrado → permitido.
  - `commit con estado.yml en stage tras registrar-tests pasa` (tests registrados con `arbolTesteado`).
  - `clasificacion cambiar sin frase literal se niega`; con la frase presente en los mensajes del usuario → permitido.
- [ ] **Step 4: Correr** `node --import ./tests/setup-env.mjs --test tests/arbol.test.mjs tests/ramas.test.mjs tests/compuerta-bash.test.mjs`. Expected: todo PASS. Si algo falla, el bug está en el código ya escrito: corregirlo ahí.
- [ ] **Step 5: Commit** de los tres archivos de `lib/` y los tres de tests: `feat(4.0): árbol testeado sin archivos de la CLI y commits fuera de ramas sólo-PR (M5, M7)`.

### Task 2: Verificación local (M1)

`requisitos.mjs` ya tiene `tocaUi`, `verificacionLocalOk` y `FALTA_VERIFICACION_LOCAL`. Falta el comando y los tests.

**Files:**
- Modify: `plugin/scripts/rq.mjs` (`verificar`, `COMPUERTAS`, `imprimirEstado`, `entregar`, `usoDe`)
- Test: `tests/rq-cli.test.mjs`, `tests/requisitos.test.mjs` (nuevo)

**Interfaces:**
- Consumes: `tocaUi(estado, raiz, proyecto, rutasRq)`, `verificacionLocalOk(estado)`, `FALTA_VERIFICACION_LOCAL`.
- Produces: `estado.verificacion_local = { que: string, capturas: string[], fecha: string }` (rutas relativas a la raíz, bajo `docs/rq/<código>/qa/`). Compuerta nueva `verificacion-local` en `COMPUERTAS`.

- [ ] **Step 1: Tests** en `tests/requisitos.test.mjs`:
  - `toca UI por spec`: `spec.md` con `## Toca: UI [x] · sensible [ ]` → `tocaUi` true; con `UI [ ]` y sin archivos de UI → false.
  - `faltaParaEtapa pide la verificación local antes que la revisión` en un RQ que toca UI, etapa objetivo 3 (v4).
  - `saltar verificacion-local la cubre`.
- [ ] **Step 2: Tests** en `tests/rq-cli.test.mjs`:
  - `verificar --local registra qué y capturas`: `['verificar','--local','Recorrí X como gerente','docs/rq/R-1/qa/a.png']` → `code 0`, `estado.verificacion_local.capturas` = `['docs/rq/R-1/qa/a.png']`.
  - `verificar --local sin capturas falla` (code ≠ 0, stderr nombra "al menos una captura").
  - `verificar --local con captura fuera de qa/ falla` (stderr nombra `docs/rq/R-1/qa/`).
  - `estado muestra "Verificación local: sin registrar"` en un RQ que toca UI sin registro.
- [ ] **Step 3: Correr** ambos archivos. Expected: FAIL (subcomando inexistente).
- [ ] **Step 4: Implementar** en `rq.mjs`: rama `--local` de `verificar` (las capturas deben existir y estar bajo `docs/rq/<código>/qa/`); `'verificacion-local'` en `COMPUERTAS`; línea en `imprimirEstado` y en `entregar` sólo cuando `tocaUi` y no `verificacionLocalOk`; uso en `usoDe('verificar')`.
- [ ] **Step 5: Correr** de nuevo. Expected: PASS.
- [ ] **Step 6: Commit** `rq.mjs`, `requisitos.mjs` y tests: `feat(4.0): verificación local con el rol real para RQ que tocan UI (M1)`.

### Task 3: Numeración v4 y conversión de estados v3

**Files:**
- Create: `plugin/scripts/lib/etapas.mjs`
- Modify: `plugin/scripts/lib/estado.mjs` (`cargarEstado`, `guardarEstado`, `etapaDerivada`, `calcularEtapa`, constantes `ETAPAS_AUTONOMAS`, `AUTONOMIA_POR_DEFECTO`), `plugin/scripts/lib/requisitos.mjs` (`exigencias`, `exigenciasDelProyecto`)
- Test: `tests/etapas.test.mjs` (nuevo), `tests/estado.test.mjs`

**Interfaces:**
- Produces:
  - `ETAPA = Object.freeze({ ARRANQUE:0, DISENO:1, DESARROLLO:2, VERIFICACION:3, DEV:4, PROD:5, CIERRE:6 })`
  - `NOMBRE_ETAPA: Record<number,string>` con los nombres de Global Constraints.
  - `VERSION_CICLO = 4`
  - `aV4(estado): estado` — devuelve una copia convertida si `version_ciclo !== 4` (no muta). Mapa de etapa v3→v4: 0→0, 1→1, 2→1, 3→2, 4→3, 5→4, 6→5, 7→6; aplica a `etapa`, `aprobaciones[].etapa` (dos aprobaciones que caen en 1 quedan las dos), `autonomia.hasta`; pone `version_ciclo: 4`.
  - `etapaV3aV4(n): number`
  - `etapaProyectoAV4(proyecto, n): number` — identidad si `proyecto.version_ciclo === 4`, si no `etapaV3aV4`.
- `cargarEstado` devuelve siempre v4; `guardarEstado` escribe `version_ciclo: 4`.

- [ ] **Step 1: Tests** en `tests/etapas.test.mjs`:
  - `aV4 convierte etapa 5 con aprobar 6` → `etapa 4`, `aprobaciones[0].etapa 5`, `version_ciclo 4`, objeto original intacto.
  - `aV4 es identidad en v4`.
  - `etapaProyectoAV4` sin `version_ciclo`: 3→2, 4→3, 6→5; con `version_ciclo: 4`: identidad.
- [ ] **Step 2: Tests** en `tests/estado.test.mjs` (adaptar los existentes a la numeración nueva y sumar):
  - `etapaDerivada v4`: spec.md sin aprobación → 0; spec.md + `aprobar 1` → 1; tests registrados → 2; tests ok + revisión ok → 3; + E2E ok → 4; aprobación 5 → 5; registrada 6 → 6. `plan.md` solo no cambia la etapa.
  - `cargarEstado convierte un estado.yml v3 sin reescribirlo` (el archivo en disco sigue sin `version_ciclo`).
  - `etapaCumplida(estado, 5)` exige la frase en `ctx.textosUsuario` (como hoy la 6).
  - `etapaCumplida(estado, 3)` es sólo evidencia (como hoy la 4).
- [ ] **Step 3: Correr** ambos. Expected: FAIL.
- [ ] **Step 4: Implementar** `etapas.mjs`; en `estado.mjs`, `cargarEstado` pasa por `aV4`, `calcularEtapa` con la numeración nueva (PROD = 5 con frase de sesión; verificación = 3 sólo evidencia; `ETAPAS_AUTONOMAS = [2, 4]`; la autonomía por defecto de spike/bounded llega hasta 4 pero **no** cubre la 1: el diseño se aprueba siempre); `etapaDerivada` según el Step 2. En `requisitos.mjs`, `exigencias` en v4 (lo que hoy es etapa 3 pasa a 2, 4→3, 6→5) y `exigenciasDelProyecto` filtra `[2,3,5]` tras `etapaProyectoAV4`.
- [ ] **Step 5: Test de proyecto externo**: `proyecto.yml` sin `version_ciclo` con `{ etapa: 6, skill: X }` → `faltaParaEtapa(estado, 5)` incluye `X`. Correr. Expected: PASS.
- [ ] **Step 6: Commit** `feat(4.0): etapas 0–6 y conversión de RQ abiertos con 3.x`.

### Task 4: Consumidores de la numeración

**Files:**
- Modify: `plugin/scripts/rq.mjs` (todas las literales de etapa: `aprobar`, `etapa`, `autonomia`, `exigirEtapa3`→`exigirDesarrollo`, `entregar`, `desplegar`, `cerrar`, `imprimirEstado`, `usoDe`), `plugin/scripts/lib/compuerta-bash.mjs` (literales de etapa en push/commit/e2e), `plugin/scripts/lib/compuerta-edicion.mjs`, `plugin/scripts/lib/hooks/session-start.mjs`, `plugin/scripts/lib/agents.mjs`, `plugin/scripts/lib/circuito.mjs` si nombra etapas
- Test: `tests/rq-cli.test.mjs`, `tests/rq-0-7.test.mjs` (renombrar a `tests/rq-etapas.test.mjs`), `tests/compuerta-bash.test.mjs`, `tests/hooks.test.mjs`, `tests/stack-0-8.test.mjs`, `tests/circuito-backlog.test.mjs`

**Interfaces:**
- Consumes: `ETAPA`, `NOMBRE_ETAPA`, `etapaV3aV4` de Tarea 3.
- Produces: `aprobar <n>` con `n` en 0–6. Si el RQ cargado venía de v3 (`estado._v3 === true`, marca que deja `aV4` y que `guardarEstado` no escribe) y `n === 6`, registra 5 e imprime `Etapa 6 de la numeración vieja: registrada como 5 (PROD y entrega).`

- [ ] **Step 1: Inventario**: `grep -nE "etapa[^a-zA-Z]*(===|>=|<=|<|>|:)\s*[0-9]|\b(aprobar|etapa) [0-9]" plugin/scripts -r`. Cada literal se reemplaza por `ETAPA.*`; anotar en el commit los que no son etapas.
- [ ] **Step 2: Adaptar los tests existentes** a la numeración nueva (cambio mecánico: 2 desaparece, 3→2, 4→3, 5→4, 6→5, 7→6) y sumar `aprobar 6 sobre RQ v3 se registra como 5 con aviso`.
- [ ] **Step 3: Correr** los archivos de tests de esta tarea. Expected: FAIL donde el código aún usa literales viejas.
- [ ] **Step 4: Reemplazar** las literales en el código.
- [ ] **Step 5: Correr** de nuevo. Expected: PASS.
- [ ] **Step 6: Commit** `refactor(4.0): CLI, compuertas y hooks con la numeración v4`.

### Task 5: Clasificación confirmada con nombres nuevos (M2)

**Files:**
- Create: `plugin/scripts/lib/clasificacion.mjs`
- Modify: `plugin/scripts/rq.mjs` (`abrir`, `main`: `SUBS` y `aridad` con `clasificacion: 2`, `usoDe`), `plugin/scripts/lib/multi-repo.mjs` (`heredar` copia `clasificacion` y `clasificacion_pendiente`)
- Test: `tests/clasificacion.test.mjs` (nuevo), `tests/rq-cli.test.mjs`, `tests/compuerta-edicion.test.mjs`, `tests/multi-repo.test.mjs`

**Interfaces:**
- Produces:
  - `NOMBRES = { spike:'Exploración', bounded:'Acotado', arquitectonico:'Arquitectónico' }`
  - `clasificacionDe(texto): 'spike'|'bounded'|'arquitectonico'|null` — acepta valor interno o nombre nuevo, sin tildes ni mayúsculas (`exploracion`, `acotado`).
  - `implicancias(c, tipo): string[]` — las líneas de la tabla de la sección 5 de la spec para esa clasificación y tipo.
  - `MAS_PESADA(a, b)` — orden spike < bounded < arquitectonico (lo usa el Plan 2).
  - CLI: `clasificacion confirmar "<frase>"` → `clasificacion_pendiente: false`, `clasificacion_confirmada: { frase, fecha }`; `clasificacion cambiar <c> "<frase>"` → cambia y confirma. Ambas con frase literal.
- Consumes: `clasificacionPendiente(estado)` ya escrita en `compuerta-edicion.mjs`.

- [ ] **Step 1: Tests** en `tests/clasificacion.test.mjs`: `clasificacionDe('Acotado') === 'bounded'`, `clasificacionDe('exploracion') === 'spike'`, `clasificacionDe('x') === null`; `implicancias('arquitectonico','rq')` incluye `decision-arq` y `plan.md`; `implicancias('bounded','bug')` incluye `systematic-debugging`.
- [ ] **Step 2: Tests CLI**: `abrir --clasificacion acotado` guarda `bounded` con `clasificacion_pendiente: true` e imprime "Acotado" y sus implicancias; `clasificacion confirmar "Sí, acotado"` la libera; `clasificacion cambiar arquitectonico "mejor arquitectónico"` cambia y libera; `estado` muestra "Clasificación: Acotado (pendiente de confirmar)".
- [ ] **Step 3: Tests de compuerta de edición**: con pendiente, editar `src/x.js` → deny que nombra `clasificacion confirmar`; editar `docs/rq/R-1/spec.md` → allow; RQ sin el campo (v3) → no bloquea.
- [ ] **Step 4: Test multi-repo**: RQ confirmado en el principal, abierto en el secundario → el secundario sale confirmado.
- [ ] **Step 5: Correr.** Expected: FAIL. **Implementar.** **Correr.** Expected: PASS. (Si la compuerta de edición hoy bloquea también `docs/rq/<código>/`, agregar esa excepción en `evaluarEdicion` antes del chequeo de pendiente.)
- [ ] **Step 6: Commit** `feat(4.0): clasificación confirmada por el usuario, con Exploración/Acotado/Arquitectónico (M2)`.

### Task 6: Etapa 1 unificada

**Files:**
- Modify: `plugin/scripts/lib/requisitos.mjs` (`exigencias`, helper nuevo `tareasEnSpec`), `plugin/scripts/lib/compuerta-bash.mjs` (commit en Exploración), `plugin/scripts/rq.mjs` (mensaje de `abrir`/`estado` sobre qué falta en la 1)
- Test: `tests/requisitos.test.mjs`, `tests/compuerta-bash.test.mjs`

**Interfaces:**
- Produces:
  - `exigencias(estado)` v4, para la etapa 2 (primer commit de código): `superpowers:brainstorming` siempre; BUG además `superpowers:systematic-debugging` y `causa`; bounded además `tareas` (`## Tareas` en `spec.md`); arquitectonico además `superpowers:writing-plans` y `plan` (`docs/rq/<código>/plan.md` existe). Resto sin cambio de contenido: TDD en 3, verification-before-completion (RQ) y revisión en 5.
  - `tareasEnSpec(raiz, codigo): boolean` — `## Tareas` con al menos un ítem de lista.
  - Aprobación de la 1 obligatoria en las tres clasificaciones (ya resuelto en Tarea 3).
  - Exploración: la compuerta de commit niega rutas fuera de `docs/rq/<código>/` con el mensaje `Exploración: el código de la sonda va a docs/rq/<código>/sonda/; construirlo es un RQ nuevo.`

- [ ] **Step 1: Tests**: `faltaParaEtapa` de un bounded sin `## Tareas` lista "las tareas en docs/rq/R-1/spec.md (## Tareas)"; arquitectónico sin `plan.md` lista `plan.md`; BUG sin brainstorming lista `superpowers:brainstorming`; spike sin brainstorming lo lista y no pide tareas ni plan.
- [ ] **Step 2: Test compuerta**: spike con commit de `src/a.js` → deny con el mensaje de arriba; de `docs/rq/R-1/sonda/a.js` → allow.
- [ ] **Step 3: Correr** → FAIL. **Implementar.** **Correr** → PASS.
- [ ] **Step 4: Commit** `feat(4.0): diseño y plan en una etapa, brainstorming para todo RQ y BUG`.

### Task 7: Ejecución elegida

**Files:**
- Modify: `plugin/scripts/rq.mjs` (subcomando `ejecucion`, `SUBS`, `aridad: { ejecucion: 2 }`), `plugin/scripts/lib/compuerta-bash.mjs` (`SUBS_CON_FRASE` + `'ejecucion'`; `RE_SUB_FRASE`; exigencia en el primer commit de código), `plugin/scripts/lib/multi-repo.mjs` (`heredar` copia `ejecucion`)
- Test: `tests/rq-cli.test.mjs`, `tests/compuerta-bash.test.mjs`, `tests/multi-repo.test.mjs`

**Interfaces:**
- Produces: `estado.ejecucion = { modo: 'inline'|'subagentes', frase, fecha }`. `ejecucion` acepta también `executing-plans` (→ inline) y `subagent-driven-development` (→ subagentes). La compuerta de commit, en la etapa 2, niega el primer commit de código sin `estado.ejecucion` salvo en spike, con: `Antes del primer commit, preguntale al usuario cómo ejecutar el plan (executing-plans en línea o subagent-driven-development) y registralo: $RQ ejecucion inline|subagentes "<su frase>".`

- [ ] **Step 1: Tests**: `ejecucion subagentes "con subagentes"` guarda `modo:'subagentes'`; valor inválido falla; frase ausente de los mensajes del usuario → deny de la compuerta de frases; primer commit sin ejecución en bounded → deny; en spike → allow; secundario multi-repo hereda.
- [ ] **Step 2: Correr** → FAIL. **Implementar.** **Correr** → PASS.
- [ ] **Step 3: Commit** `feat(4.0): el usuario elige executing-plans o subagentes antes del primer commit`.

### Task 8: `commit`, `registrar-tests`, `abrir` y `entregar` (M4, M5, M7)

**Files:**
- Modify: `plugin/scripts/rq.mjs` (`abrir`, `commit`, `registrarTests`, `correrTests`, `hayCambiosSinStage`, `entregar`, `imprimirEstado`, `COMPUERTAS` + `'rama'`)
- Test: `tests/rq-cli.test.mjs`

**Interfaces:**
- Consumes: `pasarARamaDelRq`, `enRamaProtegida`, `ramaDelRq` (Tarea 1); `arbolTesteado`, `esPropioDeLaCli`, `PROPIOS_DE_LA_CLI` (Tarea 1).
- Produces:
  - `abrir` en rama protegida llama a `pasarARamaDelRq` e imprime `Rama del RQ: rq/<código> (desde <desde>).`; si devuelve `{error}`, el RQ se abre igual e imprime el error y el comando para hacerlo a mano.
  - `correrTests` registra `tests.arbol = arbolTesteado(raiz)`.
  - `registrarTests` deja en stage `estado.yml`, `docs/rq/ACTIVO` y `docs/backlog.md` si existen y están modificados.
  - `hayCambiosSinStage` ignora rutas con `esPropioDeLaCli`.
  - `commit`: si `git add -A -- <rutas>` falla por rutas ignoradas, reintenta las trackeadas con `git add -u -- <ruta>`; las no trackeadas e ignoradas → error `<ruta> está en .gitignore y no está trackeada: sacala de las rutas o forzala a mano con git add -f.` En rama protegida → error con `git switch -c rq/<código>`.
  - `entregar` e `imprimirEstado`: `Rama equivocada: <rama> sólo recibe cambios por PR.` cuando `enRamaProtegida`.

- [ ] **Step 1: Tests**: abrir en `18.0-dev` con upstream → queda en `rq/R-1`; abrir en detached HEAD con `ramas_solo_pr` → RQ abierto, sin excepción, mensaje con el comando manual; `commit` de un archivo trackeado bajo `.gitignore` → commiteado; de uno no trackeado e ignorado → error con el texto de arriba; `registrar-tests` y luego `commit` sin tocar nada más → el commit incluye `estado.yml` y pasa la compuerta; `entregar` en `18.0-dev` → "Rama equivocada".
- [ ] **Step 2: Correr** → FAIL. **Implementar.** **Correr** → PASS.
- [ ] **Step 3: Commit** `feat(4.0): rama por RQ, estado.yml en el mismo commit y archivos ignorados (M4, M5, M7)`.

### Task 9: Odoo condicional (M6 incluido)

**Files:**
- Modify: `plugin/scripts/lib/odoo-skills.mjs` (`usaOdoo`), `plugin/scripts/lib/stack.mjs` (`motorDatos` sin default `odoo`), `plugin/scripts/lib/alta.mjs` (pedir skills de Odoo sólo si algún proyecto las usa), `plugin/scripts/lib/compuerta-edicion.mjs` (pasar `raiz` a `usaOdoo`)
- Test: `tests/odoo-skills.test.mjs`, `tests/compuerta-edicion.test.mjs`, `tests/alta.test.mjs`, `tests/stack-0-8.test.mjs`

**Interfaces:**
- Produces: `usaOdoo(proyecto, raiz?): boolean` — `odoo_skills === false` → false; `datos.motor` declarado → `=== 'odoo'`; sin declarar → `hayManifiestoOdoo(raiz)`. `hayManifiestoOdoo(raiz): boolean` — busca `__manifest__.py` a profundidad ≤ 3 saltando `node_modules` y `.git`; caché `Map` por raíz. `motorDatos(proyecto)` devuelve `null` si no está declarado (los llamadores que asumían `odoo` pasan por `usaOdoo`).
- Consumes: `skillOdooDeRuta` (ya escrita) para M6.

- [ ] **Step 1: Tests**: proyecto sin `datos` en repo sin manifiesto → `usaOdoo` false y `faltaParaEtapa` sin nada de Odoo; mismo proyecto con `addons/x/__manifest__.py` → true; `datos.motor: supabase` con manifiesto → false; editar `addons/x/models/a.py` sin `odoo-guidelines` → deny (M6); con `saltar skills` → allow; `addons/x/static/src/a.js` pide `odoo-web-guidelines`; `alta` sin proyectos Odoo no ofrece `odoo-skills`.
- [ ] **Step 2: Correr** → FAIL. **Implementar.** **Correr** → PASS. Revisar los tests de `stack-0-8` que asumían `odoo` por defecto y ajustarlos a la regla nueva.
- [ ] **Step 3: Commit** `feat(4.0): Odoo sólo si el proyecto lo declara o tiene addons; skill de Odoo al editar (M6)`.

### Task 10: Arranque inicio / reanudación

**Files:**
- Create: `plugin/scripts/lib/arranque.mjs`
- Modify: `plugin/scripts/rq.mjs` (subcomando `arranque`, `aridad: { arranque: 0 }`), `plugin/scripts/lib/hooks/session-start.mjs` (usa `textoArranque`)
- Test: `tests/arranque.test.mjs` (nuevo), `tests/hooks.test.mjs`

**Interfaces:**
- Produces:
  - `modoArranque(raiz): { modo: 'inicio'|'reanudacion', codigo?: string }` — reanudación si `rqActivo(raiz)` existe con etapa < 6.
  - `estadoRepo(dir): { nombre, rama, adelante, atras, sinCommitear: number, clonado: boolean }`
  - `ultimoTrabajado(raiz, proyecto): { backlog: Array<{codigo, estado, fecha}>, changelog: string[] }` — 5 filas del backlog por fecha de cambio más reciente, 3 primeras entradas de `CHANGELOG.md`.
  - `textoArranque({ raiz, proyecto, dirLin }): string` — sin escribir nada. Inicio: proyecto, si usa Odoo (sólo si `usaOdoo`), repo local, externos de `proyecto.repos`, lo último trabajado y otros RQ abiertos. Reanudación: una línea por repo y, en detalle, RQ, tipo, clasificación con nombre nuevo, etapa con `NOMBRE_ETAPA`, `faltaParaEtapa` de la siguiente, rama y último commit, cambios sin commitear.
  - Raíz que no es repo (carpeta padre): usa `reposDebajo` y arma una línea por repo encontrado.

- [ ] **Step 1: Tests**: repo sin RQ → `modo 'inicio'` y el texto nombra el proyecto y "Lo último"; con `ACTIVO` en etapa 2 → `'reanudacion'` y el texto contiene "Dónde nos quedamos", "Desarrollo" y lo que falta; carpeta padre con dos repos → dos líneas, sin excepción; proyecto sin Odoo → el texto no contiene "Odoo"; `arranque` dos veces seguidas no cambia `git status`.
- [ ] **Step 2: Test del hook**: la salida de SessionStart incluye el texto de `textoArranque`.
- [ ] **Step 3: Correr** → FAIL. **Implementar.** **Correr** → PASS.
- [ ] **Step 4: Commit** `feat(4.0): arranque que distingue inicio de reanudación`.

### Task 11: Skill, comandos, plantilla y generalidad

**Files:**
- Modify: `plugin/skills/ciclo-rq/SKILL.md`, `plugin/commands/bacg-rq.md`, `plugin/commands/bacg-estado.md`, `plugin/general/proceso.md`, `proyectos/_plantilla/proyecto.yml` (`version_ciclo: 4`, etapas de `skills_requeridas` en v4, `datos.motor` comentado con la detección), `plugin/scripts/lib/agents.mjs` (texto de `AGENTS.md` con etapas v4), `proyectos/powerfy/proyecto.yml` (`version_ciclo: 4` y etapas convertidas si tiene `skills_requeridas`)
- Test: `tests/skills.test.mjs`, `tests/lineamientos.test.mjs`, `tests/manifiestos.test.mjs`

**Interfaces:**
- Consumes: nombres de subcomandos de las tareas 2, 5, 7, 8, 10.

- [ ] **Step 1: Reescribir `ciclo-rq/SKILL.md`** con: sección 1 = etapa 0 (arranque, tipo, clasificación propuesta → confirmada por el usuario, rama); tabla de etapas v4 de la spec §3; tabla de la etapa 1 de la spec §5 (con Exploración/Acotado/Arquitectónico); §2.1 sin la regla fija de ejecución, con la pregunta de la Tarea 7; Odoo en una subsección "Si el proyecto usa Odoo"; verificación local en §4; subcomandos nuevos (`arranque`, `clasificacion`, `ejecucion`, `verificar --local`) y compuertas `verificacion-local` y `rama` en §6. Sin `PowerFy`, `18.0-dev`, `8069`/`8070` salvo como ejemplo marcado.
- [ ] **Step 2: Test de generalidad** en `tests/skills.test.mjs`: `SKILL.md`, `proceso.md` y los comandos no contienen `/PowerFy|18\.0-dev|8069|8070/` fuera de líneas que empiezan con `Ejemplo`; `SKILL.md` nombra los cuatro subcomandos nuevos y las 7 etapas v4.
- [ ] **Step 3: Actualizar** comandos, `proceso.md`, plantilla, `agents.mjs` y `proyectos/powerfy/proyecto.yml`.
- [ ] **Step 4: Correr** los tres archivos de tests → PASS.
- [ ] **Step 5: Commit** `docs(4.0): ciclo-rq v4, plantilla y textos sin supuestos de un proyecto`.

### Task 12: Versión 4.0.0 y verificación completa

**Files:**
- Modify: `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (si declara versión), `CHANGELOG.md`

- [ ] **Step 1: Subir la versión** a 4.0.0 y escribir la entrada del CHANGELOG: qué cambia para quien usa el plugin (etapas 0–6, nombres, `aprobar 1` siempre, elección de ejecución, Odoo detectado, verificación local, rama por RQ), la conversión automática de RQ y `proyecto.yml` viejos, y "el circuito autómata llega en 4.1".
- [ ] **Step 2: Correr la suite completa en segundo plano**: `npm test`. Expected: 0 fallas. Si falla algo, arreglar en la tarea dueña y volver a correr sólo ese archivo.
- [ ] **Step 3: Prueba manual en PowerFy** sin instalar: con `node <repo>/plugin/scripts/rq.mjs arranque` desde `C:\MiCarpeta\Odoo DEVs\PowerFy\powerfy-bi`, ver que reconoce PF-UI-REP-GERENTE como reanudación con la etapa convertida.
- [ ] **Step 4: Revisión de seguridad** de la compuerta de frases con los subcomandos nuevos (`claude-security` sobre el diff de la rama).
- [ ] **Step 5: Commit** `release: plugin 4.0.0`.

---

## Plan 2 (después de mergear este)

Circuito autómata (spec §9): `lib/autonomo.mjs`, `$RQ autonomo`, modo por `BACG_AUTONOMO`, reglas de decisión con `decisiones.md`, paradas duras, `reanudar`, columna `Autómata` y estado `Estacionado` en el backlog. Se escribe cuando el Plan 1 esté en `main`, sobre las interfaces de las tareas 3, 5 y 7 (`MAS_PESADA`, `estado.ejecucion`, aprobaciones con `por`).
