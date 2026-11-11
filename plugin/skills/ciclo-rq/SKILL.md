---
name: ciclo-rq
description: Usar antes de cualquier cambio de código o base de datos en un repo con .bacg-lineamientos o .bacg-dev/ (o cuando el usuario pide un RQ, un BUG, /bacg-rq o /bacg-estado). Arranca o retoma la sesión, distingue RQ de BUG y confirma la clasificación con el usuario, hace el encuadre y la fila del backlog, delega diseño, plan y desarrollo en Superpowers sin duplicarlo, exige refuerzo de UI, E2E live y verificación local, lleva la entrega hasta PROD y cierra con changelog y log.
---

# Ciclo de un RQ o BUG

El plugin pone el marco de entrada (arranque, clasificación, encuadre y backlog) y de salida (entrega, changelog y log). Lo del medio lo hace Superpowers. **Un artefacto por fase, una pasada por artefacto:** lo aprobado no se vuelve a revisar salvo que el usuario lo pida. Al usuario se le pide: confirmar la clasificación, aprobar el diseño y plan, elegir cómo se ejecuta el plan y el OK de PROD (y el de DEV en Arquitectónico).

`$RQ` es la línea `CLI del RQ: node "<ruta>"` que inyecta `SessionStart`; si falta, `node "${CLAUDE_PLUGIN_ROOT}/scripts/rq.mjs"`. En Bash escribilo con la ruta literal (`node "<ruta>/rq.mjs" <subcomando> …`) o asigná la variable en el mismo comando (`RQ="node <ruta>/rq.mjs"; $RQ <subcomando> …`); `$RQ` no existe en el shell por sí sola. Se corre desde la raíz del repo y es la única vía para escribir `docs/rq/<código>/estado.yml` y `docs/rq/ACTIVO`. `$RQ estado` dice dónde está el RQ; corrélo al retomar o cuando una compuerta bloquee. La configuración del proyecto está en `.bacg-dev/` del repo (o, en proyectos viejos, en la copia de lineamientos); `proyecto.yml` se lee con Read.

## 0. Alta de la PC (una vez)

Si el arranque dice "Alta incompleta" o `$RQ abrir` lo frena, primero el alta: `$RQ alta` (o `/bacg-alta`) lista los pasos (Node, gh, lineamientos, repo del proyecto, tests en esta PC…) y el próximo que falta. Guiá al usuario de a un paso hasta "Todo listo". `--sin-alta` en `abrir` sólo si el usuario lo pide con sus palabras.

## 1. Etapa 0: arranque y clasificación (una pasada)

**Arranque.** `SessionStart` inyecta la salida de `$RQ arranque` (también se corre a mano; sólo lee). Dice si la sesión es un **inicio** (proyecto y repo detectados, si el proyecto usa Odoo, repos locales y externos con su rama y estado, últimas filas del backlog y del changelog, otros RQ abiertos) o una **reanudación** (RQ activo, tipo, clasificación, etapa, lo que falta para la siguiente, rama y último commit, cambios sin commitear). Las dos dicen si el entorno del E2E está listo (`tests.e2e_requisitos` y `tests.e2e_url`: Docker, contenedores, app) y una reanudación avisa si la rama del RQ ya está mergeada (entonces el RQ se avanza a la etapa 5 o se cierra; el hook no le anota skills). En una reanudación, contale al usuario en dos o tres líneas dónde quedaron y seguí desde ahí.

| Tipo | Qué es | Abrir |
|---|---|---|
| RQ | Funcionalidad nueva o cambio de comportamiento | `--tipo rq` |
| BUG | Algo que anda mal respecto de lo acordado | `--tipo bug` |
| Consulta u operativa | Preguntas, lecturas, SELECTs, docs, tests | Sin ciclo |

Sin ciclo también: `docs/**`, `**/*.md`, `tests/**`, `e2e/**`, `*.test.*`, `*.spec.*`, `.bacg-lineamientos`, `.lovable/**`, `.agents/**`. Nunca libres: `.claude/` y `.bacg-dev/`.

1. **Proyecto y repo.** El plugin deduce el proyecto del repo de la sesión (marcador o remoto origin); no lo pregunta. Si el arranque dice que la carpeta no es un repo, o el pedido no coincide con el proyecto detectado, preguntale al usuario en qué proyecto y repo va a trabajar antes de seguir, y trabajá desde la raíz de ese repo. Si coincide, nombralo en una línea y seguí.
2. **Backlog.** Buscá el código con Grep en `docs/backlog.md`. Si no existe, proponé el siguiente con la convención del backlog. `$RQ previa [<código>]` muestra dónde está parado el trabajo sin abrir nada.
3. **Abrir.** `$RQ abrir <código> --tipo rq|bug --clasificacion exploracion|acotado|arquitectonico --tarea "<texto>"`. Primero corre la **validación previa**: trae origin de los repos del proyecto, dice cuánto está atrás cada uno de la rama de DEV, lista ramas y PR abiertos de otros (con lo que tocan) y las filas "En curso" del backlog remoto. Mostrale al usuario el atraso y el trabajo en paralelo que se cruce; si hay atraso, actualizá la rama antes de editar. Un código que ya figura En curso o Hecho en el backlog remoto, o que nombra una rama o un PR, no se abre: si es del usuario (otra PC), traé esa rama y volvé a abrir; si no, elegí otro código. `--sin-previa` sólo si el usuario lo pide con sus palabras. Después crea o retoma el RQ, escribe la fila del backlog e imprime qué implica la clasificación.
4. **Rama.** Si la rama actual sólo recibe PR (`ramas_solo_pr`) o es de PROD (`ramas_prod`), `abrir` pasa a `rq/<código>`: la toma si existe; si no, la crea. Si no puede, lo dice y lo hacés a mano con `git switch`. La compuerta de commit niega código en esas ramas.
5. **Clasificación.** `abrir` deja la clasificación **propuesta, no confirmada**: hasta que el usuario la confirme no se edita código (el encuadre en `docs/rq/<código>/` sí). Proponésela con su motivo y lo que implica (tabla de la sección 2.1): **Arquitectónico** si se cumple algún criterio ARQ (sección 3); **Exploración** si la pregunta es si algo se puede o conviene hacer; si no, **Acotado**. Con su respuesta literal: `$RQ clasificacion confirmar "<su frase>"` o `$RQ clasificacion cambiar exploracion|acotado|arquitectonico "<su frase>"`. Si después aparece complejidad oculta, se sube con `clasificacion cambiar` (también con su frase). En `estado.yml` los valores siguen siendo `spike`, `bounded` y `arquitectonico`.
6. **Encuadre.** Escribilo como cabecera de `docs/rq/<código>/spec.md` (≤ 25 líneas):

```markdown
# <código> · <título>
Tipo: RQ | BUG · Clasificación: Exploración | Acotado | Arquitectónico · Repos: <…>
## Qué / Síntoma
## Por qué / Esperado vs. actual
## Alcance (dentro / fuera)
## Cómo reproducir (BUG)
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: amerita [ ] / no aplica — motivo
## Criterio de aceptación → flujo E2E que lo prueba
```

Un RQ por conversación: después de `$RQ cerrar` y su push, `/clear`. Si hay varios activos (uno por línea en `ACTIVO`), `--rq <código>` elige y lo deja como el RQ en curso (ahí se registran las skills).

### 1.1 Varios RQ a la vez (sólo si el usuario lo pide)

Si el usuario pide trabajar varios RQ en la misma sesión:
- **Aprobaciones de una vez.** Si dio una aprobación general para avanzar solo ("dejo mi aprobación para avanzar con los planes de manera autónoma"), registrala una vez: `$RQ autonomia sesion "<su frase>"`. Se aplica a los RQ activos y a los que abras o retomes en la sesión: confirma la clasificación propuesta, aprueba diseño y tareas de Exploración y Acotado cuando `## Diseño` y `## Tareas` ya están en `spec.md`, y cubre desarrollo y DEV. Si los escribiste después de abrir el RQ: `$RQ autonomia aplicar --rq <código>`. No le vuelvas a pedir una frase por RQ. Si en cambio aprobó varios diseños en un mensaje ("apruebo VENTAS y STOCK", "apruebo todos"): `$RQ lote aprobar "<su frase>" <código>…`; la frase tiene que nombrar los RQ (el código o su último tramo) o decir que son todos. El diseño de un Arquitectónico (con la autonomía de sesión) y el OK de PROD (siempre) siguen siendo por RQ.
- **Skills.** Las de proceso se cargan una vez por sesión: al abrir o retomar un RQ, las skills ya cargadas en la sesión se anotan solas en él; si cambiaste de RQ con `--rq`, `$RQ skills importar --rq <código>`. No vuelvas a invocar `brainstorming`, `diseno-frontend` ni las de Odoo para el segundo RQ: el diseño de cada RQ sí va en su `spec.md`.
- **Ramas.** Cada RQ en su rama `rq/<código>`. Antes de pasar a otro: commiteá los docs del que dejás (`$RQ commit … --rq <código>`), volvé a la rama de DEV (`git switch <DEV>`) y recién ahí `$RQ abrir` el siguiente, así no arrastra docs ajenos. Usá `--rq <código>` en cada comando. La lista de un lote puede nombrar RQ que viven en otra rama: `lote aprobar` aprueba los que están en el checkout y dice cuáles correr desde su rama (con la misma frase).
- **Una sola app local.** Si los RQ comparten la app local o el E2E, no se desarrollan en paralelo de verdad: alterná y esperá cada `verificar`. Al cambiar de rama, reiniciá la app local si carga código o manifiestos al arrancar (en Odoo, un manifest de la otra rama da "Style error" por un asset que no existe). Si los dos PR tocan un artefacto compilado (un bundle), el segundo se recompila después de mergear el primero.
- **`ACTIVO` después de un merge.** Si al traer la rama de DEV `docs/rq/ACTIVO` queda en conflicto o lista RQ cerrados (`$RQ estado` lo avisa), `$RQ activo reparar`: lo rehace con los RQ abiertos del árbol y marca el conflicto como resuelto. Nunca lo edites a mano. El commit del merge pasa aunque traiga código de la rama de DEV: la compuerta sólo cuenta lo que difiere de la rama mergeada (conflictos resueltos, cambios propios).

## 2. Etapas y skills

La etapa sale sola de la evidencia (`$RQ estado` la muestra); `$RQ etapa <n>` es opcional. **Las skills de proceso son las de esta tabla, una vez por RQ**: el hook las registra en el RQ en curso y la CLI las exige al avanzar. En este repo no rige la regla de `using-superpowers` de invocar toda skill con un 1 % de chance; el resto es opcional.

| # | Etapa | RQ | BUG | Se cumple con · lo exige |
|---|---|---|---|---|
| 0 | Arranque y clasificación | esta skill | esta skill | RQ abierto, fila en backlog, encuadre en `spec.md`, clasificación confirmada |
| 1 | Diseño y plan | `superpowers:brainstorming` (sección 2.1); ARQ si amerita (sección 3) | `superpowers:systematic-debugging` (causa raíz en `spec.md`, `## Causa`) y después `superpowers:brainstorming` | diseño y tareas o plan según la clasificación; `$RQ aprobar 1 "<frase>"` en toda clasificación · editar código lo exige |
| 2 | Desarrollo | `superpowers:test-driven-development`; ejecución elegida por el usuario (sección 2.2) | `superpowers:test-driven-development`: primero el test que reproduce el bug, en rojo | `$RQ commit "<mensaje>" <rutas>` por tarea; refuerzo de UI (sección 4) · el primer commit de código exige `brainstorming` (en BUG, además `systematic-debugging` y `## Causa`; en Acotado, `## Tareas`; en Arquitectónico, `writing-plans` y `plan.md`) y, en Arquitectónico, la ejecución elegida |
| 3 | Verificación | una revisión (sección 5) | una revisión (sección 5) | `$RQ verificar` (E2E live), `$RQ verificar --local` si toca UI (sección 4) y `$RQ revision ok\|bloqueante "<nota>"` · la revisión ok exige `test-driven-development`, la verificación local si toca UI y, si el RQ toca rutas `sensible`, `claude-security` |
| 4 | DEV / Preview | | | sola en Exploración y Acotado; en Arquitectónico, `$RQ aprobar 4 "<frase>"` |
| 5 | PROD y entrega | `superpowers:verification-before-completion` antes de pedir el OK | | `$RQ aprobar 5 "<frase>"` y circuito completo (sección 6) · publicar exige las skills de arriba, la revisión y el E2E completo |
| 6 | Cierre | sección 7 | sección 7 | `$RQ cerrar` |

Si el usuario decide saltear una skill exigida: `$RQ saltar skills "<frase>" "<motivo>"`; la de seguridad: `$RQ saltar seguridad "<frase>" "<motivo>"`.

**RQ abiertos con 3.x** (etapas 0–7): se convierten solos al leerlos (etapas y aprobaciones de la 2 en adelante bajan una). Un Exploración o Acotado con `spec.md` conserva su diseño como aprobado. `$RQ aprobar 6` o `$RQ etapa 6` sobre uno de ellos se registra como 5 (PROD), con aviso.

### 2.0 Skills de BACG por etapa

Además de las de la tabla, las de BACG según lo que toca el RQ. El proyecto puede volverlas obligatorias con `skills_requeridas` en `proyecto.yml` (etapa 2, 3 o 5, tipo y rutas; un `proyecto.yml` sin `version_ciclo: 4` se lee en la numeración 3.x); entonces la CLI las exige como las de arriba.

| Etapa | Si el RQ… | Skill |
|---|---|---|
| 1 Diseño y plan | diseña o revisa un agente de IA, o decide agente vs. workflow | `anthropic-skills:bacg-agent-architecture` |
| 2 Desarrollo | crea o edita un workflow de n8n | `anthropic-skills:bacg-n8n-guidelines` |
| 2 Desarrollo | replica un stack de n8n a otro cliente | `anthropic-skills:bacg-n8n-clonado-clientes` |
| 5 PROD y entrega | promueve workflows de n8n de DEV a PROD | `anthropic-skills:bacg-n8n-pasaje-prod` |

### 2.0.1 Si el proyecto usa Odoo

El proyecto usa Odoo si lo declara (`datos.motor: odoo`) o, sin `datos.motor`, si el repo tiene algún `__manifest__.py` a tres niveles o menos de la raíz; `odoo_skills: false` en `proyecto.yml` lo apaga. El arranque lo dice. Si no lo usa, nada de esta sección aplica.

| Etapa | Si el RQ… | Skill |
|---|---|---|
| 1 Diseño y plan | toca multicompañía, localización o contabilidad de Odoo | `anthropic-skills:odoo-multicompany-consultant` |
| 1 Diseño y plan · BUG | diagnostica un error de n8n + Odoo (mails [ERROR], ejecuciones fallidas, rechazos del conector) | `anthropic-skills:bacg-diagnostico-bugs` |
| 2 Desarrollo | toca el conector MCP Odoo–Claude | `anthropic-skills:bacg-conector-mcp-odoo` |
| 2 Desarrollo | edita Python, XML, datos o seguridad de un addon (carpeta con `__manifest__.py`, fuera de `static/`) | `odoo-guidelines` |
| 2 Desarrollo | edita `static/` de un addon (JS, Owl, SCSS) | `odoo-web-guidelines` |
| 3 Verificación | cualquier archivo de un addon | `odoo-review` (como pasada de la revisión de la sección 5) |
| 3 Verificación | rutas `sensible` o `controllers/` de un addon | `odoo-security` (además de `claude-security`) |

Las cuatro últimas son las oficiales de `github.com/odoo/odoo/tree/20.0/skills`: la compuerta de edición pide la de desarrollo al tocar el archivo y la CLI exige las de verificación. Se instalan en `~/.claude/skills` con `$RQ odoo-skills` (el alta lo pide). Son de Odoo 20.0: si el proyecto corre otra versión, donde una regla choque con la API de esa versión mandan el código del repo y la documentación de su versión. `odoo-git` no se exige: commits, ramas y PR siguen las convenciones del proyecto (rama por RQ, `feat(<código>): …`), no las de odoo/odoo.

### 2.1 Etapa 1: diseño y plan

`superpowers:brainstorming` siempre, en RQ y en BUG (en BUG, después de `systematic-debugging`). Arranca desde el encuadre, sin rehacer contexto del repo, backlog ni tipo; todas las dudas en un mensaje. Toma el camino de la clasificación confirmada (spike, bounded o architectural) y no reclasifica: si aparece complejidad oculta, `$RQ clasificacion cambiar … "<frase del usuario>"`.

| | Exploración | Acotado | Arquitectónico |
|---|---|---|---|
| BUG antes | `systematic-debugging`, `## Causa` en `spec.md` | igual | igual |
| Diseño | pregunta y sonda (2–3 frases) en `spec.md` | diseño corto en `spec.md` | spec completa en `spec.md` |
| ARQ | no | no | sección 3; `lineamientos-dev-claude-bacg:decision-arq` + ADR |
| Plan | no | `## Tareas` en `spec.md` | `superpowers:writing-plans` → `docs/rq/<código>/plan.md` |
| `/prototype` | no | proponerlo al usuario si toca UI | proponerlo al usuario si toca UI |
| Aprobación | `$RQ aprobar 1 "<frase>"` | `$RQ aprobar 1 "<frase>"`, o la misma frase de `clasificacion confirmar` si `## Diseño` y `## Tareas` ya están en `spec.md`: escribilos antes de pedir la confirmación y una respuesta cubre las dos | `$RQ aprobar 1 "<frase>"` (diseño y plan juntos) |
| Varios RQ (sección 1.1) | autonomía de sesión o `lote aprobar` | autonomía de sesión o `lote aprobar` | sólo `lote aprobar` (con `plan.md`) |

**Exploración termina al final de la sonda:** el resultado es una recomendación en `spec.md`. Sólo se commitea bajo `docs/rq/<código>/` (el código de la sonda, en `docs/rq/<código>/sonda/`), además de lo que escribe la CLI; construirlo es un RQ nuevo.

### 2.2 Reglas con Superpowers (mandan sobre las de cada skill)

- Spec y plan van a `docs/rq/<código>/spec.md` y `plan.md`, nunca a `docs/superpowers/…`. Una pasada, sin self-review extra; una aprobación del usuario (`aprobar 1`).
- **Ejecución:** antes del primer commit de código, preguntale al usuario en el chat, con texto, cómo ejecutar el plan: `superpowers:executing-plans` en línea o `superpowers:subagent-driven-development`. Registrá su respuesta literal con `$RQ ejecucion inline|subagentes "<su frase>"`; sin eso, `$RQ commit` no commitea código. Exploración y Acotado no preguntan: van en línea (en Acotado, si el usuario pide subagentes, `$RQ ejecucion subagentes "<su frase>"`). `writing-plans` nombra en la cabecera del plan la ejecución elegida, no `subagent-driven-development` por defecto. Con subagentes, sin reviewer por tarea: la revisión es una sola, en la etapa 3.
- `superpowers:requesting-code-review` no se usa: la revisión es la de la sección 5.
- `superpowers:finishing-a-development-branch` no se usa: la entrega es la sección 6 (`$RQ entregar` y `$RQ desplegar`).
- `superpowers:using-git-worktrees`: sólo si `reglas.md` del proyecto lo pide. Si el E2E corre contra la app del checkout principal, no.
- No armes un TO DO aparte con la checklist de cada skill: el plan es la lista.

Cómo se invoca lo que no es una skill con `plugin:skill`:
- `feature-dev:code-architect`: herramienta Agent con `subagent_type "feature-dev:code-architect"`.
- `pr-review-toolkit`: `/pr-review-toolkit:review-pr` o la herramienta Agent con `subagent_type "pr-review-toolkit:code-reviewer"` (o `"pr-review-toolkit:silent-failure-hunter"`).
- `security-guidance`: no se invoca, actúa sola por hooks; atendé sus avisos.
- `claude-security`: Skill "claude-security:claude-security".
- `claude-md-management`: Skill "claude-md-management:claude-md-improver" o `/revise-claude-md`, sólo si el RQ dejó algo que valga subir a CLAUDE.md.

### 2.3 Leer sin llenar el contexto

En las sesiones medidas, la mayor parte de lo que entra al contexto es código y diffs volcados enteros por Bash. Cada lectura queda en la conversación hasta compactarla, así que:
- **Código:** ubicá el tramo con Grep (o `search_graph` si está codebase-memory) y leelo con Read y `offset`/`limit`. Nada de `cat` ni `sed -n` de archivos enteros o de cientos de líneas por Bash. No releas lo que ya leíste o editaste en la sesión.
- **Contenedores:** el código del proyecto está en el repo local: leelo ahí, no con `docker exec … cat`. Para código que sólo está dentro del contenedor (el de la plataforma base), primero `docker exec … grep -n`, después el tramo (≤ 80 líneas).
- **Diffs:** `git diff --stat` primero y después `git diff -- <archivo>` de lo que importa. El diff entero del RQ lo lee el subagente de la revisión (sección 5), no la sesión principal.
- **Logs:** `docker logs --tail 200` o `--since 10m`, y `grep -n -iE "error|traceback|fail"` antes que el log completo. `gh run view --log-failed` en lugar de `--log`; `gh … --json <campos>` con lo justo.
- **Barridos amplios** (muchos archivos para responder una pregunta): subagente `Explore`, que vuelve con la conclusión y no con los archivos.

Las salidas largas de logs, Docker, `gh` y tests llegan compactadas (errores con contexto, principio y final) con la ruta del original en `~/.claude/bacg-dev/salidas/`: si falta algo, leé esa ruta con Read o Grep en lugar de volver a correr el comando.

## 3. ARQ: el "deber ser" antes de diseñar

Amerita si el cambio toca contratos (API, RPC, edge functions, formatos entre repos), datos (esquema, fuente de verdad, migraciones duraderas), seguridad (RLS, roles, auth, secretos, datos personales), despliegue, suma una plataforma o integración, o se estima en más de ~10 archivos o más de un repo. Si amerita, la clasificación es Arquitectónico; si no, anotá "ARQ: no aplica — motivo" y seguí.

En orden, cada una sólo si aporta:
1. ADR vigentes (`adr/` de la carpeta del proyecto) y `reglas.md`: lo ya decidido no se rediscute.
2. `engineering:system-design`: componentes, datos, APIs y requerimientos no funcionales.
3. `engineering:architecture`: alternativas con trade-offs, si hay más de una razonable. **Stack:** el del proyecto es el que declara `proyecto.yml` (el arranque lo resume en "Stack del proyecto"); no supongas ninguno. Si el RQ elige o suma una plataforma, poné en la tabla de opciones la arquitectura de referencia histórica (Supabase + Lovable + n8n) junto a las alternativas que el caso justifique (backend o base propios, un ERP, otro servicio gestionado) y ponderá costo, lock-in, operación, seguridad y quién lo mantiene. La referencia es un punto de partida, no la respuesta por defecto.
4. La skill de la base del stack (`datos.motor`), si toca base de datos: `supabase-postgres-best-practices` en Supabase o Postgres; en otro motor, su documentación vía `context7` y las reglas del proyecto.
5. Skill "claude-security:claude-security": si toca seguridad o rutas de `sensible`.
6. `feature-dev:code-architect`: si atraviesa varios módulos.
7. `lineamientos-dev-claude-bacg:decision-arq`: si sale una decisión duradera (ADR).

Resultado: `docs/rq/<código>/arq.md` de una página (contexto, opciones y trade-offs, decisión, atributos de calidad afectados, riesgos, ADR). Entra a `brainstorming` como dato.

## 4. Refuerzos obligatorios

**UI** (archivos de `ui.patrones`), en todo RQ y BUG, también los Acotados: "acotado" no habilita un diseño exprés. La compuerta de edición pide:
- `lineamientos-dev-claude-bacg:diseno-frontend` siempre, y seguí su orden (canon primero);
- `lineamientos-dev-claude-bacg:redesign-existing-projects` si el archivo ya existe (pantalla existente: se audita antes de cambiarla);
- además, las de `ui.skills` / `ui.reglas` de `proyecto.yml`, que se suman a estas;
- la sección `## Diseño` en `docs/rq/<código>/spec.md` con el entregable de `diseno-frontend`: canon que aplica, dirección, auditoría, estados, revisión en móvil y alineación con los componentes vecinos.

**Cambio menor** (un texto, un ícono, un tooltip o un espaciado puntual; sin componentes nuevos, sin cambiar el layout ni lo que se ve en móvil, sin tocar un estilo compartido): antes de cargar nada, preguntale al usuario en el chat, con texto, si omite el refuerzo. No uses botones: la compuerta sólo acepta sus palabras. Si acepta: `$RQ saltar ui "<su frase>" "<motivo>"`, y se sigue pidiendo sólo el canon del proyecto. Ante la duda, no lo propongas.

`lineamientos-dev-claude-bacg:design-taste-frontend` (~22 k tokens) va sólo donde el proyecto lo declara (landing, marca). La base de todo cambio de UI que no sea menor es `emil-design-eng` (componentes e interacción), `mobile-native` (móvil) y, si hay pantalla o componente nuevo o más de una dirección, proponerle al usuario `/prototype` (el agente no puede invocarla). El detalle y las skills de apoyo por caso (`break-ui`, `pick-ui-library`) están en `diseno-frontend`. Una skill cargada queda en el RQ y vale para subagentes y otras sesiones. Lo que el usuario pide explícitamente sobre la UI (por ejemplo, "color acorde al sentido de la acción") es criterio de aceptación: anotalo en el spec y verificalo en la captura.

**E2E live** (todo RQ y BUG): al menos un flujo de Playwright Test que recorre el cambio en la app levantada (`entornos.local` o la preview de `entornos.dev`), no en jsdom. En un BUG, el flujo reproduce el síntoma: rojo antes del arreglo, verde después. Traza y capturas a `docs/rq/<código>/qa/`. `$RQ verificar` corre `tests.e2e` de `proyecto.yml` (con `E2E_URL`/`BASE_URL` = `tests.e2e_url`) y lo registra. Si el comando trae `{specs}`, corre sólo los specs del RQ (los de su diff o los que le pases por ruta, también fuera del repo: una ruta absoluta dentro de la carpeta del script de `tests.e2e` se pasa relativa a esa carpeta, como la espera Playwright; si el runner dice "No tests found", no se registra un E2E fallido) mientras desarrollás; si no encuentra ninguno no corre la suite entera: lo dice y pide la ruta o `--completo`; antes de PROD, `$RQ verificar --completo`; sin E2E en verde la compuerta no deja publicar código. Nunca dos E2E a la vez: `verificar` toma un lock por proyecto y, mientras corre, la compuerta niega lanzar el mismo script E2E a mano (esperá a que termine). Las capturas que los specs de regresión escriben en `docs/rq/<otro RQ>/qa/` vuelven solas a como estaban al terminar. Sólo se omite si el usuario lo dice con sus palabras y el cambio no tiene superficie de app: `$RQ saltar e2e "<frase>" "<motivo>"`.

**Verificación local** (RQ o BUG que toca UI: `Toca: UI [x]` en el encuadre o archivos de UI en el diff): el E2E aislado no alcanza. Recorré el cambio en el entorno local (o la preview de DEV) con un usuario del rol real, guardá al menos una captura en `docs/rq/<código>/qa/` y registralo con `$RQ verificar --local "<qué se recorrió y con qué rol>" docs/rq/<código>/qa/<captura>.png …`. Vale con el navegador del agente o con un script de Playwright corrido desde la PC contra el mismo entorno local, con el usuario del rol real y sin mocks; si el panel del navegador está oculto (viewport 0×0), usá Playwright. Nombrá en el texto con qué se recorrió. Sin eso no hay revisión ok. Sólo se omite si el usuario lo dice con sus palabras: `$RQ saltar verificacion-local "<frase>" "<motivo>"`.

## 5. Revisión (una sola, RQ y BUG)

`pr-review-toolkit:code-reviewer` sobre el diff del RQ, una vez, al final del desarrollo (también con subagentes). Además, sólo si corresponde: `pr-review-toolkit:silent-failure-hunter` si el cambio toca manejo de errores o fallbacks (en un BUG que venía de un error tragado, siempre); `claude-security` si toca `sensible` (la revisión ok lo exige); en un proyecto con Odoo, `odoo-review` y `odoo-security` (sección 2.0.1); `engineering:debug` si un BUG cuesta reproducirlo. El resultado va a `$RQ revision ok|bloqueante "<nota>"`; con bloqueantes, se corrigen y se revisa sólo lo corregido.

## 6. Aprobaciones, commits y entrega

- Llevan texto literal del usuario, y la compuerta lo verifica: `$RQ clasificacion …`, `$RQ aprobar <etapa> "<frase>"` (1 diseño y plan, 4 DEV en Arquitectónico, 5 PROD), `$RQ ejecucion …`, `$RQ autonomia <hasta> "<frase>"` (1 a 4: cubre desarrollo y DEV, nunca el diseño ni PROD; Exploración y Acotado la tienen hasta DEV por defecto), `$RQ autonomia sesion "<frase>"` y `$RQ lote aprobar "<frase>" <código>…` (varios RQ, sección 1.1) y `$RQ saltar <compuerta> "<frase>" "<motivo>"` (compuerta `edicion`, `commit`, `push`, `e2e`, `skills`, `seguridad`, `ui`, `verificacion-local` o `rama`). Un "Dale" vale si fue el mensaje entero. Si el pedido ya dice qué hacer en PROD, registrá esa oración como OK de la etapa 5. Saltos sólo con palabras del usuario, nunca propuestos por el agente; los tests rojos de `main` van en `tests.rojos_conocidos`. `saltar commit` exime al commit de los tests, de las skills exigidas y de la elección de ejecución; `saltar rama` deja commitear código en una rama protegida y publicar en PROD sin pasar por la rama de DEV (hotfix).
- La CLI verifica la frase contra lo que escribió el usuario en la sesión: tiene que ser un mensaje suyo entero o una oración entera (no un tramo), y cada vez que la escribió vale para un solo registro. Las oraciones se separan con `.` `!` `?` `;` salto de línea o ` + ` (no con coma): si el usuario contestó varias decisiones en un mensaje ("Acotado + Aprobar diseño + Ejecutar en línea"), registrá cada una con su tramo (`clasificacion confirmar "Acotado"`, `aprobar 1 "Aprobar diseño"`, `ejecucion inline "Ejecutar en línea"`), sin volver a preguntarle. Sin sesión de Claude Code, sólo se registra desde una terminal interactiva volviendo a tipearla.
- Commits: uno por tarea del plan con `$RQ commit "<tipo>: <qué>" <rutas>`: hace el `git add` (lo ya trackeado bajo `.gitignore` entra con `git add -u`; lo ignorado y sin trackear es un error), corre los tests relacionados (deja aparte lo que no va en el commit), registra y commitea con el código en el mensaje, junto con `estado.yml` y `ACTIVO`. Docs y tests solos también pueden ir con `git add <rutas> && git commit`. `$RQ registrar-tests` queda para cuando ya armaste el stage a mano: deja en stage `estado.yml`, `ACTIVO` y el backlog. Nunca `git commit -a` ni con pathspecs.
- Un repo es PROD salvo `push_prod: false` explícito en `repos` de `proyecto.yml`. Si el proyecto o el repo declaran `ramas_prod`, sólo es PROD un push o un merge a esas ramas: el push diario a la rama de DEV pide la etapa 3 y el E2E, no el OK de PROD ni el circuito. **Orden de ramas:** si además hay rama de DEV (`rama_dev`, `entornos.dev.rama` o la de `ramas_solo_pr`), a PROD sólo llega lo que ya está en `origin/<DEV>`: el PR del RQ va a DEV (`gh pr create --base <DEV>`; sin `--base`, gh usa la rama por defecto, que puede ser PROD) y PROD es la promoción DEV → PROD (`gh pr create --base <PROD> --head <DEV>` o `git push origin origin/<DEV>:<PROD>`). La compuerta niega el push, el merge o el PR a PROD que no venga de DEV; un hotfix directo, sólo con `$RQ saltar rama "<frase>" "<motivo>"` del usuario. Escribir en PROD exige OK de la etapa 5; `apply_migration` a PROD lo exige siempre, aunque sólo lea; `execute_sql` de lectura pasa.

**Merge a DEV en modo automático.** La autonomía hasta DEV incluye mergear el PR del RQ a la rama de DEV, pero el modo automático de Claude Code niega `gh pr merge` sin una regla de permisos. Si lo niega, decíselo al usuario y proponele sumar `"Bash(gh pr merge:*)"` a `permissions.allow` de `.claude/settings.local.json` (el alta lo marca); el merge a PROD lo sigue frenando la compuerta del plugin hasta el OK de la etapa 5. No lo intentes por otra vía.

La entrega es del agente, hasta el final. `$RQ entregar` dice qué falta (rama y upstream, rama equivocada, PR, CI, tests, E2E, verificación local, revisión y plan de PROD); corrélo al empezar la entrega y después de cada paso. Los push y merge los hacés vos con Bash (ahí actúan las compuertas), nunca la CLI. Si el arranque avisó que la cuenta de `gh` no es la del proyecto, `gh auth switch -u <cuenta>` antes de pushear.
1. **Base** (si el RQ toca datos): migración donde dice `datos.migraciones` (por defecto, `supabase/migrations/`), aplicada y probada en local (en Supabase, RLS por rol; en otro motor, los permisos que use). Con sedes, el handoff `docs/planes/SEDE_DB_<código>.md`.
2. **PR:** push de la rama del RQ y PR con el encuadre, el E2E y las migraciones en el cuerpo.
3. **CI:** seguí los checks en segundo plano (`gh pr checks --watch` con `run_in_background`, sin polling en el chat). Si fallan: `superpowers:systematic-debugging`, corregí y volvé a pushear; tras 3 intentos, escalá con el diagnóstico.
4. **PROD:** con el OK, `$RQ desplegar` da el plan (migraciones por base, push o merge a la rama de PROD, PR de sync por sede con su SQL y su CI); ejecutalo entero. En Supabase, el SQL a PROD va con `execute_sql` del conector, un bloque del handoff por llamada (la CLI de Supabase la bloquea el modo automático); en otro motor, con lo que declara `datos.aplicar`. Lo hecho por fuera: `$RQ paso hecho <paso> "<evidencia>"`; lo que no corresponde: `$RQ paso no-aplica <paso> "<motivo>"` (`$RQ paso reabrir <paso>` lo deshace); los manuales confirmados: `$RQ paso <paso>`. Los pasos de PROD los ejecuta la sesión principal.

## 7. Cierre (un comando y un push)

`$RQ cerrar --resumen "<1-2 frases en lenguaje del usuario>" [--alcance "<Solo HQ | Replicar en sedes | …>"]` pasa el backlog a Hecho con los pendientes, agrega la entrada de 4 líneas al changelog `docs/log/changelog/AAAA-MM.md`, una línea a `docs/log/rq.jsonl` (log del proyecto) y hace un único commit `docs(<código>): cierre` sólo con esos docs. Si el changelog ya tiene una entrada del código, no agrega otra; `--sin-changelog` escribe sólo el log. Los commits del log son los que nombran el código. Después, `git push` (sólo docs: no necesita RQ). No hay relevo: para retomar alcanzan el arranque, el encuadre, `estado.yml` y `$RQ entregar`. Después del push, `/clear` antes del siguiente RQ.

Si quedaron pasos manuales (publicar en Lovable, un sync a mano), el RQ se cierra igual y `$RQ estado` y el arranque lo recuerdan. Cuando se hacen: `$RQ paso <paso> --rq <código>` (o `paso hecho`); recalcula los pendientes, la fila del backlog y el log.

Si `$RQ estado` o `$RQ entregar` avisan que la rama está atrasada o que el RQ ya figura cerrado en `origin/main`, actualizá la rama antes de seguir: lo que se lee en el checkout puede estar viejo.

## 8. Agentes sin el plugin (Lovable u otros)

Lovable y otros agentes (los de `agentes_externos` en `proyecto.yml`) no pasan por las compuertas: pushean directo a la rama principal.
- `$RQ agents` escribe en `AGENTS.md` (entre marcas) los lineamientos en una forma que esos agentes siguen a mano: RQ o BUG, backlog, encuadre, tests, E2E, nada de SQL en PROD, changelog y log. Correlo cuando cambie `.bacg-dev/` o la versión del plugin y commitealo (es documentación). En proyectos con sedes, `AGENTS.md` viaja con `sync-lineamientos`.
- `$RQ auditar` lista los commits de esos agentes posteriores a la última revisión, marcando migraciones, rutas sensibles y código sin tests. Si el arranque avisa que hay commits sin revisar: revisá primero los marcados, regularizá lo que haga falta como RQ o BUG y cerrá con `$RQ auditar --cerrar "<qué se revisó y qué se abrió>"` (mueve la marca `docs/log/auditoria-lovable.yml` y deja la línea en `docs/log/rq.jsonl`).
