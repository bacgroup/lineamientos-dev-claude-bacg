# Handoff · ciclo-rq: verificación en el entorno local, clasificación y fricciones de la etapa 3

Fecha: 2026-11-05 · Versión instalada: **3.2.0** · Origen: prueba del plugin con PF-UI-REP-GERENTE (Powerfy, repo `powerfy-bi`, RQ bounded de UI)

## Contexto

Se abrió PF-UI-REP-GERENTE (Panel Gerente de `powerfy_reports` con el sistema de diseño de PF-UI) con `/bacg-rq` y se recorrieron las etapas 0 a 3: encuadre, diseño con el refuerzo de UI, TDD con un E2E de Playwright (rojo → verde, 6/6) y commit en `18.0-dev` (`1c83b9c`, `1988eb4`). Al revisar el recorrido, el usuario marcó dos brechas: (1) nunca se probó en el entorno local de trabajo ni a través del frontend como en los RQ anteriores, y (2) casi no se ejecutaron skills de Superpowers. El análisis confirmó las dos y encontró tres fricciones de la CLI.

Comparación con los RQ anteriores de Powerfy (skills de Superpowers en `estado.yml`):

| RQ | Clasificación | Superpowers |
|---|---|---|
| PF-UI | arquitectonico | brainstorming, writing-plans, executing-plans, test-driven-development, verification-before-completion |
| PF-UI-GUARDADO | bounded | test-driven-development, verification-before-completion |
| PF-UI-SIDEBAR | bug | systematic-debugging, test-driven-development, verification-before-completion |
| PF-UI-REP-GERENTE | bounded | test-driven-development (hasta la etapa 3) |

## M1 · Verificación en el entorno local con el rol real (brecha)

**Qué pasó:** la compuerta da por cumplida la verificación con el E2E de `tests.e2e`. En Powerfy ese E2E corre contra un Odoo aislado (`powerfy-e2e`, 8070, base de demo recreada en cada corrida). El agente nunca abrió `entornos.local.app` (8069, base `powerfy`), no recorrió la pantalla en el navegador y no entró con el rol de destino: el spec forzaba el rol interceptando `/powerfy/reports/api/user/role` y 5 de 6 tests usaban datos simulados. La detección de rol, el selector de paneles y lo que ve un usuario que sólo tiene ese grupo quedaron sin probar. La evidencia fue más débil que en los RQ anteriores.

**Cambio propuesto:**
- Nueva evidencia en la etapa 4, `verificacion_local`. La exige todo RQ y BUG con `Toca: UI [x]` y la registra `$RQ verificar --local "<qué se recorrió>" <capturas>`. Significa recorrer el cambio en `entornos.local.app` (o la preview de `entornos.dev`) con el navegador del agente, con un usuario del rol o perfil que el criterio de aceptación nombra, y dejar capturas en escritorio y móvil en `docs/rq/<código>/qa/`.
- En `ciclo-rq`, sección 4 ("E2E live"): aclarar que los mocks de rol, permisos o datos sirven para estados (error, vacío, extremos), pero que al menos un flujo tiene que pasar por el camino real de autorización con un usuario del rol, sin interceptar la API de ese rol.
- `$RQ entregar` y `$RQ estado` muestran "Verificación local: sin registrar" cuando falta.
- Escape: `$RQ saltar verificacion-local "<frase>" "<motivo>"`, sólo con palabras del usuario.

**Evidencia (misma sesión, después del handoff):** la pasada en el 8069 con un usuario Gerente encontró lo que el E2E en verde (6/6) no veía: "Caja disponible: Lfalse" (el endpoint devuelve `False` sin movimientos de caja); el acceso "Aprobaciones" abre "Missing Action" si `powerfy_treasury` no está instalado; con sólo el grupo y sin el rol, el endpoint falla por permisos; el mes llega en el idioma del usuario. Además mostró que el 8069 necesita `-u` y reiniciar el contenedor para servir el bundle nuevo. El primero se corrigió con TDD dentro del RQ (`36933f6`) y el resto quedó en `spec.md`.

**Tests:** RQ con UI sin `verificacion_local` → la etapa 4 no se cumple; con la evidencia → se cumple; RQ sin UI → no se exige; el salto exige la frase literal.

## M2 · Clasificación confirmada por el usuario al abrir (brecha)

**Qué pasó:** el agente eligió `--clasificacion bounded` por su cuenta. Esa sola decisión apagó `brainstorming` y `writing-plans` (en `ciclo-rq` van "sólo en arquitectónico"), sin que el usuario lo supiera.

**Cambio propuesto:**
- `$RQ abrir` muestra la clasificación elegida y lo que implica ("bounded: sin brainstorming ni plan; diseño en spec.md; ejecución en línea"), y la deja en `pendiente de confirmar`.
- `$RQ clasificacion confirmar "<frase>"` (o `cambiar <spike|bounded|arquitectonico> "<frase>"`) con texto literal del usuario, como `aprobar`. La compuerta de edición no abre hasta que esté confirmada.
- En `ciclo-rq`, sección 1, paso 2: "Proponé la clasificación con su motivo y pedí la confirmación antes de escribir el encuadre."

## M3 · Plan y `executing-plans` en bounded: contradicción en la skill

**Qué pasó:** la sección 2.1 de `ciclo-rq` dice "Ejecución: spike y bounded, `superpowers:executing-plans` en línea (o sin plan, en BUG)", pero la tabla de etapas dice que `writing-plans` va "sólo en arquitectónico". Un bounded no tiene plan y aun así se le pide `executing-plans`. El agente la salteó.

**Cambio propuesto (elegir uno y reflejarlo en la tabla y en 2.1):**
- (a) Bounded sin plan: "spike, bounded y BUG: sin plan ni `executing-plans`; las tareas salen del criterio de aceptación del encuadre". Opción recomendada: es lo que ya pasa en la práctica (PF-UI-GUARDADO).
- (b) Bounded con plan corto: `writing-plans` también en bounded, con un tope (≤ 5 tareas, una pasada, sin aprobación) y `executing-plans` en línea.

## M4 · `$RQ commit` no puede dejar en stage archivos trackeados bajo un `.gitignore`

**Qué pasó:** `powerfy-bi` versiona el bundle compilado `powerfy_reports/static/dist/reports.bundle.js` aunque `dist/` está en `.gitignore` (se agregó con `-f`). `$RQ commit "<msg>" … powerfy_reports/static/dist/reports.bundle.js …` corta con "git add falló: The following paths are ignored…". git sí deja el archivo en stage (es un archivo trackeado), pero devuelve código 1 por el aviso. Hubo que armar el stage a mano y usar `registrar-tests`.

**Cambio propuesto:** en `rq.mjs › commit`, si `git add` falla sólo por "paths are ignored", reintentar las rutas que `git ls-files --error-unmatch` reporta como trackeadas, sin `-f` para las no trackeadas, y seguir. Alternativa: `git add --ignore-errors` y validar después con `git diff --cached --name-only` que estén todas las rutas pedidas.

**Tests:** ruta trackeada dentro de un directorio ignorado → entra al commit; ruta ignorada y sin trackear → error claro con la sugerencia de `-f` o de sacarla del `.gitignore`.

## M5 · `estado.yml` queda fuera del commit que lo modifica

**Qué pasó:** `registrar-tests` (y antes el registro de skills del hook) reescribe `docs/rq/<código>/estado.yml` después de que el stage está armado. El commit del código sale sin el `estado.yml` final, y hace falta un segundo commit `docs(<código>): estado del RQ`. Además, `registrar-tests` se niega a correr mientras `estado.yml` tenga cambios sin stagear, lo que obliga a un `git add` intermedio.

**Cambio propuesto:**
- `registrar-tests` y `commit` agregan `docs/rq/<código>/estado.yml` (y `docs/rq/ACTIVO`, `docs/backlog.md` si los tocó la CLI) al stage después de escribirlos, para que entren en el mismo commit.
- El chequeo de "cambios sin stagear en archivos trackeados" ignora los archivos que escribe la propia CLI.

Se repitió en el segundo commit (`36933f6`) con un agravante: si se agrega `estado.yml` al stage después de `registrar-tests`, el hook de commit lo frena ("Corré los tests sobre lo que está en stage"), porque cambió el árbol testeado; y `git add … && git commit` en un solo comando está bloqueado cuando hay código. El único camino es `registrar-tests` → `git commit` (sin `estado.yml`) → commit `docs(<código>): estado del RQ`. Cada commit de código deja un commit de docs atrás. Propuesta concreta: el árbol que se compara excluye `docs/rq/<código>/estado.yml`.

## M6 · `odoo-guidelines` se exige recién al commitear

**Qué pasó:** las skills oficiales de Odoo (sección 2.0.1) se exigen según las rutas del addon que el RQ toca, pero la compuerta de edición no avisó al editar `__manifest__.py`. El bloqueo apareció en `registrar-tests`, después de terminar el trabajo.

**Cambio propuesto:** que la compuerta de edición (`PreToolUse` de Edit/Write) exija o avise la skill de Odoo que corresponde a la ruta en el momento de editarla (`odoo-guidelines` fuera de `static/`, `odoo-web-guidelines` dentro), igual que el refuerzo de UI. Si se decide no bloquear la edición, que al menos inyecte un aviso.

## M7 · `$RQ abrir` no crea la rama `rq/<código>` aunque el proyecto la exige

**Qué pasó:** Powerfy declara `ramas_solo_pr: ["18.0-dev"]`, y `reglas.md` dice que cada dev trabaja en `rq/<código>`. Pero `$RQ abrir` dejó el RQ en `18.0-dev`, ninguna compuerta de commit avisó y los 9 commits del RQ se hicieron ahí. El problema apareció recién en el push ("18.0-dev sólo recibe cambios por PR"). Hubo que mover los commits a `rq/PF-UI-REP-GERENTE`, devolver `18.0-dev` a `origin` y abrir el PR (bacgroup/powerfy-bi#2). `$RQ entregar` tampoco lo marcó: decía "Rama: 18.0-dev, 9 commits sin pushear".

**Cambio propuesto:**
- `$RQ abrir`, si la rama actual está en `ramas_solo_pr` (o en `ramas_prod`), crea y cambia a `rq/<código>` desde el upstream actualizado, o lo propone y frena.
- La compuerta de commit avisa (o bloquea) si se commitea código de un RQ sobre una rama de `ramas_solo_pr`.
- `$RQ entregar` marca "rama equivocada: crear rq/<código> y PR a <rama>" en lugar de "N commits sin pushear".

## Prioridad sugerida

M1 y M2 (cambian la calidad de la evidencia y quién decide el alcance del proceso) → M3 (contradicción en la skill) → M5, M4 y M6 (fricciones de la CLI).
