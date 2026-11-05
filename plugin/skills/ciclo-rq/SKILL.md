---
name: ciclo-rq
description: Usar antes de cualquier cambio de código o base de datos en un repo con .bacg-lineamientos o .bacg-dev/ (o cuando el usuario pide un RQ, un BUG, /bacg-rq o /bacg-estado). Distingue RQ de BUG, hace el encuadre y la fila del backlog, delega diseño y desarrollo en Superpowers sin duplicarlo, exige refuerzo de UI y E2E live, lleva la entrega hasta PROD y cierra con changelog y log.
---

# Ciclo de un RQ o BUG

El plugin pone el marco de entrada (encuadre + backlog) y de salida (entrega + changelog + log). Lo del medio lo hace Superpowers. **Un artefacto por fase, una pasada por artefacto:** lo aprobado no se vuelve a revisar salvo que el usuario lo pida. Al usuario se le pide sólo el OK de PROD (y el de diseño y plan cuando hay ARQ).

`$RQ` es la línea `CLI del RQ: node "<ruta>"` que inyecta `SessionStart`; si falta, `node "${CLAUDE_PLUGIN_ROOT}/scripts/rq.mjs"`. Se corre desde la raíz del repo y es la única vía para escribir `docs/rq/<código>/estado.yml` y `docs/rq/ACTIVO`. `$RQ estado` dice dónde está el RQ; corrélo al retomar o cuando una compuerta bloquee. La configuración del proyecto está en `.bacg-dev/` del repo (o, en proyectos viejos, en la copia de lineamientos); `proyecto.yml` se lee con Read.

## 0. Alta de la PC (una vez)

Si el arranque dice "Alta incompleta" o `$RQ abrir` lo frena, primero el alta: `$RQ alta` (o `/bacg-alta`) lista los pasos (Node, gh, lineamientos, repo del proyecto, tests en esta PC…) y el próximo que falta. Guiá al usuario de a un paso hasta "Todo listo". `--sin-alta` en `abrir` sólo si el usuario lo pide con sus palabras.

## 1. Tipo y encuadre (una pasada)

| Tipo | Qué es | Abrir |
|---|---|---|
| RQ | Funcionalidad nueva o cambio de comportamiento | `--tipo rq` |
| BUG | Algo que anda mal respecto de lo acordado | `--tipo bug` |
| Consulta u operativa | Preguntas, lecturas, SELECTs, docs, tests | Sin ciclo |

Sin ciclo también: `docs/**`, `**/*.md`, `tests/**`, `e2e/**`, `*.test.*`, `*.spec.*`, `.bacg-lineamientos`, `.lovable/**`, `.agents/**`. Nunca libres: `.claude/` y `.bacg-dev/`.

0. **Proyecto y repo.** El plugin deduce el proyecto del repo de la sesión (marcador o remoto origin); no lo pregunta. Si el arranque dice que la carpeta no es un repo, o el pedido no coincide con el proyecto detectado, preguntale al usuario en qué proyecto y repo va a trabajar antes de seguir, y trabajá desde la raíz de ese repo. Si coincide, nombralo en una línea ("Proyecto powerfy, repo powerfy-addons") y seguí.
1. Buscá el código en el backlog con Grep (`docs/backlog.md`). Si no existe, proponé el siguiente con la convención del backlog y seguí. `$RQ previa [<código>]` muestra dónde está parado el trabajo sin abrir nada.
2. `$RQ abrir <código> --tipo rq|bug --clasificacion spike|bounded|arquitectonico --tarea "<texto>"` corre primero la **validación previa**: trae origin de los repos del proyecto, dice cuántos commits está atrás cada uno de la rama de DEV, lista ramas y PR abiertos de otros (con los módulos que tocan) y las filas "En curso" del backlog remoto. Mostrale al usuario el atraso y el trabajo en paralelo que se cruce con el RQ; si hay atraso, actualizá la rama antes de editar. Un RQ nuevo no se abre si el código ya figura En curso o Hecho en el backlog remoto, o si lo nombra una rama o un PR: si es del usuario (otra PC), traé esa rama y volvé a abrir; si no, elegí otro código. `--sin-previa` sólo si el usuario lo pide con sus palabras. Después crea o retoma el RQ y escribe la fila del backlog. `arquitectonico` si se cumple algún criterio ARQ (sección 3); si no, `bounded` (`spike` para exploración).
3. Escribí el encuadre como cabecera de `docs/rq/<código>/spec.md` (≤ 25 líneas; con él ya se puede editar en spike y bounded):

```markdown
# <código> · <título>
Tipo: RQ | BUG · Repos: <…>
## Qué / Síntoma
## Por qué / Esperado vs. actual
## Alcance (dentro / fuera)
## Cómo reproducir (BUG)
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: amerita [ ] / no aplica — motivo
## Criterio de aceptación → flujo E2E que lo prueba
```

Un RQ por conversación: después de `$RQ cerrar` y su push, `/clear`; el siguiente RQ arranca de su encuadre, `estado.yml` y `$RQ entregar`. Si hay varios activos (uno por línea en `ACTIVO`), `--rq <código>` elige y lo deja como el RQ en curso (ahí se registran las skills).

## 2. Etapas y skills

La etapa sale sola de la evidencia (`$RQ estado` la muestra); `$RQ etapa <n>` es opcional. **Las skills de proceso son las de esta tabla, una vez por RQ**: el hook las registra en el RQ en curso y la CLI las exige al avanzar. En este repo no rige la regla de `using-superpowers` de invocar toda skill con un 1 % de chance; el resto es opcional.

| # | Etapa | RQ | BUG | Se cumple con · lo exige |
|---|---|---|---|---|
| 0 | Encuadre | esta skill | esta skill | RQ abierto, fila en backlog, encuadre en `spec.md` |
| 1 | Diseño | ARQ si amerita (sección 3); `superpowers:brainstorming` sólo en arquitectónico | `superpowers:systematic-debugging`; la causa raíz va a `spec.md` (`## Causa`) | diseño o causa en `spec.md`; con ARQ, `$RQ aprobar 1 "<frase>"` |
| 2 | Plan | `superpowers:writing-plans` sólo en arquitectónico → `docs/rq/<código>/plan.md` | no aplica | con ARQ, `$RQ aprobar 2 "<frase>"` · el primer commit de código exige `writing-plans` (arquitectónico) o `systematic-debugging` + causa (BUG) |
| 3 | Desarrollo | `superpowers:test-driven-development`; ejecución según la sección 2.1 | `superpowers:test-driven-development`: primero el test que reproduce el bug, en rojo | `$RQ commit "<mensaje>" <rutas>` por tarea; refuerzo de UI (sección 4) |
| 4 | Verificación | una revisión (sección 5) | una revisión (sección 5) | `$RQ verificar` (E2E live, sección 4) y `$RQ revision ok\|bloqueante "<nota>"` · la revisión ok exige `test-driven-development` y, si el RQ toca rutas `sensible`, `claude-security` |
| 5 | DEV / Preview | | | sola en spike y bounded; con ARQ, `$RQ aprobar 5 "<frase>"` |
| 6 | PROD y entrega | `superpowers:verification-before-completion` antes de pedir el OK | | `$RQ aprobar 6 "<frase>"` y circuito completo (sección 6) · publicar exige las skills de arriba, la revisión y el E2E completo |
| 7 | Cierre | sección 7 | sección 7 | `$RQ cerrar` |

Si el usuario decide saltear una skill exigida: `$RQ saltar skills "<frase>" "<motivo>"`; la de seguridad: `$RQ saltar seguridad "<frase>" "<motivo>"`.

### 2.0 Skills de BACG por etapa

Además de las de la tabla, las de BACG según lo que toca el RQ. El proyecto puede volverlas obligatorias con `skills_requeridas` en `proyecto.yml` (por etapa, tipo y rutas); entonces la CLI las exige como las de arriba.

| Etapa | Si el RQ… | Skill |
|---|---|---|
| 1 Diseño | diseña o revisa un agente de IA, o decide agente vs. workflow | `anthropic-skills:bacg-agent-architecture` |
| 1 Diseño | toca multicompañía, localización o contabilidad de Odoo | `anthropic-skills:odoo-multicompany-consultant` |
| 1 Diseño · BUG | diagnostica un error de n8n + Odoo (mails [ERROR], ejecuciones fallidas, rechazos del conector) | `anthropic-skills:bacg-diagnostico-bugs` |
| 3 Desarrollo | crea o edita un workflow de n8n | `anthropic-skills:bacg-n8n-guidelines` |
| 3 Desarrollo | toca el conector MCP Odoo–Claude | `anthropic-skills:bacg-conector-mcp-odoo` |
| 3 Desarrollo | replica un stack de n8n a otro cliente | `anthropic-skills:bacg-n8n-clonado-clientes` |
| 6 PROD | promueve workflows de n8n de DEV a PROD | `anthropic-skills:bacg-n8n-pasaje-prod` |

### 2.0.1 Skills oficiales de Odoo (proyectos Odoo)

En un proyecto Odoo (`datos.motor: odoo`, el valor por defecto; `odoo_skills: false` en `proyecto.yml` lo apaga), la CLI exige las skills de `github.com/odoo/odoo/tree/20.0/skills` según lo que el RQ toca dentro de un addon (carpeta con `__manifest__.py`). Se instalan en `~/.claude/skills` con `$RQ odoo-skills` (el alta lo pide).

| Etapa | Si el RQ toca, dentro de un addon… | Skill |
|---|---|---|
| 3 Desarrollo | Python, XML, datos, seguridad (fuera de `static/`) | `odoo-guidelines` |
| 3 Desarrollo | `static/` (JS, Owl, SCSS) | `odoo-web-guidelines` |
| 4 Verificación | cualquier archivo del addon | `odoo-review` (como pasada de la revisión de la sección 5) |
| 4 Verificación | rutas `sensible` o `controllers/` | `odoo-security` (además de `claude-security`) |

Son de Odoo 20.0: si el proyecto corre otra versión (PowerFy: 18.0), donde una regla choque con la API de esa versión mandan el código del repo y la documentación de su versión. `odoo-git` no se exige: commits, ramas y PR siguen las convenciones del proyecto (rama por RQ, `feat(<código>): …`), no las de odoo/odoo.

### 2.1 Reglas con Superpowers (mandan sobre las de cada skill)

- `brainstorming`: arranca desde el encuadre, sin rehacer contexto del repo, backlog ni tipo; todas las dudas en un mensaje. Su HARD-GATE (diseño aprobado antes de seguir) aplica sólo en arquitectónico; en spike y bounded no se usa.
- Spec y plan van a `docs/rq/<código>/spec.md` y `plan.md`, nunca a `docs/superpowers/…`. Una pasada, sin self-review extra; con ARQ, una aprobación del usuario.
- `writing-plans`: la cabecera del plan nombra la ejecución que dice esta sección, no `subagent-driven-development` por defecto.
- Ejecución: spike y bounded, `superpowers:executing-plans` en línea (o sin plan, en BUG). Arquitectónico: `superpowers:subagent-driven-development` sólo si el plan tiene más de 5 tareas independientes; si no, `executing-plans`. Con SDD, sin reviewer por tarea: la revisión es una sola, en la etapa 4.
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

## 3. ARQ: el "deber ser" antes de diseñar

Amerita si el cambio toca contratos (API, RPC, edge functions, formatos entre repos), datos (esquema, fuente de verdad, migraciones duraderas), seguridad (RLS, roles, auth, secretos, datos personales), despliegue, suma una plataforma o integración, o se estima en más de ~10 archivos o más de un repo. Si no, anotá "ARQ: no aplica — motivo" y seguí.

En orden, cada una sólo si aporta:
1. ADR vigentes (`adr/` de la carpeta del proyecto) y `reglas.md`: lo ya decidido no se rediscute.
2. `engineering:system-design`: componentes, datos, APIs y requerimientos no funcionales.
3. `engineering:architecture`: alternativas con trade-offs, si hay más de una razonable. **Stack:** el del proyecto es el que declara `proyecto.yml` (el arranque lo resume en "Stack del proyecto"); no supongas Supabase + Lovable donde no está. Si el RQ elige o suma una plataforma, poné en la tabla de opciones la arquitectura de referencia histórica (Supabase + Lovable + n8n) junto a las alternativas que el caso justifique (backend o base propios, un ERP, otro servicio gestionado) y ponderá costo, lock-in, operación, seguridad y quién lo mantiene. La referencia es un punto de partida, no la respuesta por defecto.
4. La skill de la base del stack (`datos.motor`), si toca base de datos: `supabase-postgres-best-practices` en Supabase o Postgres; en otro motor, su documentación vía `context7` y las reglas del proyecto.
5. Skill "claude-security:claude-security": si toca seguridad o rutas de `sensible`.
6. `feature-dev:code-architect`: si atraviesa varios módulos.
7. `lineamientos-dev-claude-bacg:decision-arq`: si sale una decisión duradera (ADR).

Resultado: `docs/rq/<código>/arq.md` de una página (contexto, opciones y trade-offs, decisión, atributos de calidad afectados, riesgos, ADR). Entra a `brainstorming` como dato.

## 4. Refuerzos obligatorios

**UI** (archivos de `ui.patrones`), en todo RQ y BUG, también los bounded: "bounded" no habilita un diseño exprés. La compuerta de edición pide:
- `lineamientos-dev-claude-bacg:diseno-frontend` siempre, y seguí su orden (canon primero);
- `lineamientos-dev-claude-bacg:redesign-existing-projects` si el archivo ya existe (pantalla existente: se audita antes de cambiarla);
- además, las de `ui.skills` / `ui.reglas` de `proyecto.yml`, que se suman a estas;
- la sección `## Diseño` en `docs/rq/<código>/spec.md` con el entregable de `diseno-frontend`: canon que aplica, dirección, auditoría, estados, revisión en móvil y alineación con los componentes vecinos.

**Cambio menor** (un texto, un ícono, un tooltip o un espaciado puntual; sin componentes nuevos, sin cambiar el layout ni lo que se ve en móvil, sin tocar un estilo compartido): antes de cargar nada, preguntale al usuario en el chat, con texto, si omite el refuerzo. No uses botones: la compuerta sólo acepta sus palabras. Si acepta: `$RQ saltar ui "<su frase>" "<motivo>"`, y se sigue pidiendo sólo el canon del proyecto. Ante la duda, no lo propongas.

`lineamientos-dev-claude-bacg:design-taste-frontend` (~22 k tokens) va sólo donde el proyecto lo declara (landing, marca). La base de todo cambio de UI que no sea menor es `emil-design-eng` (componentes e interacción), `mobile-native` (móvil) y, si hay pantalla o componente nuevo o más de una dirección, proponerle al usuario `/prototype` (el agente no puede invocarla). El detalle y las skills de apoyo por caso (`break-ui`, `pick-ui-library`) están en `diseno-frontend`. Una skill cargada queda en el RQ y vale para subagentes y otras sesiones. Lo que el usuario pide explícitamente sobre la UI (por ejemplo, "color acorde al sentido de la acción") es criterio de aceptación: anotalo en el spec y verificalo en la captura.

**E2E live** (todo RQ y BUG): al menos un flujo de Playwright Test que recorre el cambio en la app levantada (`entornos.local` o la preview de `entornos.dev`), no en jsdom. En un BUG, el flujo reproduce el síntoma: rojo antes del arreglo, verde después. Traza y capturas a `docs/rq/<código>/qa/`. `$RQ verificar` corre `tests.e2e` de `proyecto.yml` (con `E2E_URL`/`BASE_URL` = `tests.e2e_url`) y lo registra. Si el comando trae `{specs}`, corre sólo los specs del RQ (o los que le pases) mientras desarrollás; antes de PROD, `$RQ verificar --completo`; sin E2E en verde la compuerta no deja publicar código. Sólo se omite si el usuario lo dice con sus palabras y el cambio no tiene superficie de app: `$RQ saltar e2e "<frase>" "<motivo>"`.

## 5. Revisión (una sola, RQ y BUG)

`pr-review-toolkit:code-reviewer` sobre el diff del RQ, una vez, al final del desarrollo. Además, sólo si corresponde: `pr-review-toolkit:silent-failure-hunter` si el cambio toca manejo de errores o fallbacks (en un BUG que venía de un error tragado, siempre); `claude-security` si toca `sensible` (la revisión ok lo exige); `engineering:debug` si un BUG cuesta reproducirlo. El resultado va a `$RQ revision ok|bloqueante "<nota>"`; con bloqueantes, se corrigen y se revisa sólo lo corregido.

## 6. Aprobaciones, commits y entrega

- `$RQ aprobar <etapa> "<frase>"`, `$RQ autonomia <hasta> "<frase>"` y `$RQ saltar <compuerta> "<frase>" "<motivo>"` (compuerta `edicion`, `commit`, `push`, `e2e`, `skills`, `seguridad` o `ui`) llevan texto literal del usuario; la compuerta lo verifica. Un "Dale" vale si fue el mensaje entero. Si el pedido ya dice qué hacer en PROD, registrá ese tramo como OK de la etapa 6. Saltos sólo con palabras del usuario; los tests rojos de `main` van en `tests.rojos_conocidos`.
- Commits: uno por tarea del plan con `$RQ commit "<tipo>: <qué>" <rutas>`: hace el `git add`, corre los tests relacionados (deja aparte lo que no va en el commit), registra y commitea con el código en el mensaje, en una línea. Docs y tests solos también pueden ir con `git add <rutas> && git commit`. `$RQ registrar-tests` queda para cuando ya armaste el stage a mano. Nunca `git commit -a` ni con pathspecs.
- Un repo es PROD salvo `push_prod: false` explícito en `repos` de `proyecto.yml`. Si el proyecto o el repo declaran `ramas_prod`, sólo es PROD un push o un merge a esas ramas: el push diario a la rama de DEV pide la etapa 4 y el E2E, no el OK de PROD ni el circuito. Escribir en PROD exige OK de la etapa 6; `apply_migration` a PROD lo exige siempre, aunque sólo lea; `execute_sql` de lectura pasa.

La entrega es del agente, hasta el final. `$RQ entregar` dice qué falta (rama y upstream, PR, CI, tests, E2E, revisión y plan de PROD); corrélo al empezar la entrega y después de cada paso. Los push y merge los hacés vos con Bash (ahí actúan las compuertas), nunca la CLI. Si el arranque avisó que la cuenta de `gh` no es la del proyecto, `gh auth switch -u <cuenta>` antes de pushear.
1. **Base** (si el RQ toca datos): migración donde dice `datos.migraciones` (por defecto, `supabase/migrations/`), aplicada y probada en local (en Supabase, RLS por rol; en otro motor, los permisos que use). Con sedes, el handoff `docs/planes/SEDE_DB_<código>.md`.
2. **PR:** push de la rama y PR con el encuadre, el E2E y las migraciones en el cuerpo.
3. **CI:** seguí los checks en segundo plano (`gh pr checks --watch` con `run_in_background`, sin polling en el chat). Si fallan: `superpowers:systematic-debugging`, corregí y volvé a pushear; tras 3 intentos, escalá con el diagnóstico.
4. **PROD:** con el OK, `$RQ desplegar` da el plan (migraciones por base, push o merge a la rama de PROD, PR de sync por sede con su SQL y su CI); ejecutalo entero. En Supabase, el SQL a PROD va con `execute_sql` del conector, un bloque del handoff por llamada (la CLI de Supabase la bloquea el modo automático); en otro motor, con lo que declara `datos.aplicar`. Lo hecho por fuera: `$RQ paso hecho <paso> "<evidencia>"`; lo que no corresponde: `$RQ paso no-aplica <paso> "<motivo>"` (`$RQ paso reabrir <paso>` lo deshace); los manuales confirmados: `$RQ paso <paso>`. Los pasos de PROD los ejecuta la sesión principal.

## 7. Cierre (un comando y un push)

`$RQ cerrar --resumen "<1-2 frases en lenguaje del usuario>" [--alcance "<Solo HQ | Replicar en sedes | …>"]` pasa el backlog a Hecho con los pendientes, agrega la entrada de 4 líneas al changelog `docs/log/changelog/AAAA-MM.md`, una línea a `docs/log/rq.jsonl` (log del proyecto) y hace un único commit `docs(<código>): cierre` sólo con esos docs. Si el changelog ya tiene una entrada del código, no agrega otra; `--sin-changelog` escribe sólo el log. Los commits del log son los que nombran el código. Después, `git push` (sólo docs: no necesita RQ). No hay relevo: para retomar alcanzan el encuadre, `estado.yml` y `$RQ entregar`. Después del push, `/clear` antes del siguiente RQ.

Si quedaron pasos manuales (publicar en Lovable, un sync a mano), el RQ se cierra igual y `$RQ estado` y el arranque lo recuerdan. Cuando se hacen: `$RQ paso <paso> --rq <código>` (o `paso hecho`); recalcula los pendientes, la fila del backlog y el log.

Si `$RQ estado` o `$RQ entregar` avisan que la rama está atrasada o que el RQ ya figura cerrado en `origin/main`, actualizá la rama antes de seguir: lo que se lee en el checkout puede estar viejo.

## 8. Agentes sin el plugin (Lovable u otros)

Lovable y otros agentes (los de `agentes_externos` en `proyecto.yml`) no pasan por las compuertas: pushean directo a la rama principal.
- `$RQ agents` escribe en `AGENTS.md` (entre marcas) los lineamientos en una forma que esos agentes siguen a mano: RQ o BUG, backlog, encuadre, tests, E2E, nada de SQL en PROD, changelog y log. Correlo cuando cambie `.bacg-dev/` y commitealo (es documentación). En proyectos con sedes, `AGENTS.md` viaja con `sync-lineamientos`.
- `$RQ auditar` lista los commits de esos agentes posteriores a la última revisión, marcando migraciones, rutas sensibles y código sin tests. Si el arranque avisa que hay commits sin revisar: revisá primero los marcados, regularizá lo que haga falta como RQ o BUG y cerrá con `$RQ auditar --cerrar "<qué se revisó y qué se abrió>"` (mueve la marca `docs/log/auditoria-lovable.yml` y deja la línea en `docs/log/rq.jsonl`).
