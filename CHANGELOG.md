# Changelog

## 4.2.0: menos contexto gastado en salidas de comandos (2026-11-10)

Lo útil de un proxy de compresión como Headroom, hecho dentro del plugin con hooks (Headroom no sirve en la app de escritorio: no respeta `ANTHROPIC_BASE_URL`).
- Compactador de salidas (hook `PostToolUse`, `updatedToolOutput`): en los repos del plugin, una salida de Bash o PowerShell de más de 4.000 caracteres llega compactada. En texto: líneas repetidas colapsadas, errores con su contexto, principio y final; en JSON (`gh api`): sin campos de ruido y con listas y textos largos recortados. No toca lectura de código (`cat`, `sed`, `Get-Content`…), diffs (`git diff/show/log`, también con `git -C`), búsquedas (`grep`, `rg`…) ni `rq.mjs`. El original queda en `~/.claude/bacg-dev/salidas/` (7 días) y la salida dice la ruta. Sin poder guardar el original, o con menos de 25 % de ahorro, no compacta. Se apaga con `"compactar": false` en `~/.claude/bacg-dev.json` o `BACG_DEV_SIN_COMPACTAR=1`. Medido sobre 640 sesiones guardadas: donde actúa ahorra 71 % y no perdió ninguna de 75 líneas de error; es el 0,3 % de toda la salida de Bash, porque casi todo lo largo es lectura de código.
- Tests y E2E que fallan en `rq.mjs`: además de la cola, cada línea de error de antes con su contexto (el FAIL de Odoo que sale en el medio, seguido del teardown, ya no se pierde), y la ruta de la salida completa.
- Hook `PreCompact`: al compactar la conversación pide conservar el estado de cada RQ abierto (código, clasificación, etapa, aprobaciones registradas, tests y E2E, lo que falta), las frases del usuario sin registrar, los rojos y las rutas de salidas compactadas.
- Nuevos: `lib/compactar.mjs`, `lib/hooks/compactador.mjs`, `lib/hooks/pre-compact.mjs` y sus tests.

## 4.1.0: convivencia con dev-fullflow y menos frases en Acotado (2026-11-10)

Incorpora los seis pedidos del handoff de dev-fullflow (`nkick25/dev-fullflow`, `docs/handoff/mantenimiento-desde-bacg.md`), el plugin derivado de la 4.0.2 que convive en la misma PC. Con esto, los parches propios de dev-fullflow para los pedidos 1, 2, 3, 4 y 6 dejan de hacer falta en su próxima derivación.
- Seguridad: con la configuración en `.bacg-dev/` del repo, las compuertas de MCP reconocen el `project_id` de PROD (SQL de escritura, `apply_migration`, `deploy_edge_function`, deploy de Lovable) también desde una sesión abierta fuera del repo: se buscan los repos con `.bacg-dev/` debajo de la carpeta de trabajo (dos niveles) y en `proyectos.<id>.raiz` de `~/.claude/bacg-dev.json`. Antes pasaban sin RQ. Las ramas de Supabase sin `project_id` sólo miran lo de debajo de la carpeta (pedido 3).
- La compuerta de Lovable (`deploy_project`, `respond_to_approval`) actúa sólo en proyectos reconocidos que declaran `lovable`; ya no frena el deploy en un repo ajeno (pedido 1).
- `gh pr merge -R <owner>/<repo>` desde una carpeta que el plugin no reconoce se niega sólo si el destino es un repo de un proyecto propio (por nombre en `repos` y, si el proyecto declara `cuenta_github`, por dueño); si no es propio, la compuerta no actúa (pedido 5).
- Aprobaciones en lista: una frase repetida en oraciones de un mismo mensaje ("1. OK / 2. OK / 3. OK") vale una vez por oración (pedido 4).
- Acotado: si `spec.md` ya trae `## Diseño` y `## Tareas`, la frase con que el usuario confirma la clasificación aprueba también el diseño (aprobación con `via: clasificacion`), y la ejecución va en línea por defecto como en Exploración (subagentes, si el usuario los pide). El OK de PROD sigue siendo aparte; Arquitectónico no cambia (pedido 6).
- Tests: `multi-repo` (PLG-NUBE) ya no falla en Windows por el separador de rutas (pedido 2). Nuevos: `lovable-ajeno`, `proyectos-locales`, `frases-repetidas`, `acotado-flexible` y los de merge con `-R` en `compuerta-bash`.

## 4.0.2: autonomía de punta a punta sin paradas ni registros perdidos (2026-11-09)

Arreglos de lo que frenó la prueba de desarrollo autónomo del 2026-11-09 (RQ PF-UI-REP-COMPRADOR). Las frases de aprobaciones, clasificación, ejecución y saltos siguen siendo texto literal del usuario, y cada vez que lo escribió vale para un solo registro.
- `estado.yml` ya no pierde registros por escrituras en paralelo: cada escritura toma un lock (en la carpeta temporal, fuera del repo), relee el archivo y aplica sólo lo que cambió desde que lo leyó. Antes, un `verificar` de 11 minutos volcaba al terminar la copia que leyó al arrancar y borraba el `verificar --local` y las skills registradas mientras tanto. En las listas (aprobaciones, saltos, skills, circuito) se suman las entradas nuevas de cada lado.
- Una sola corrida E2E a la vez por proyecto en la PC: `verificar` toma un lock y no arranca si hay otra; mientras corre, la compuerta de Bash niega lanzar el mismo script E2E a mano (leerlo sí). El comando recibe la ruta del lock en `BACG_E2E_LOCK` por si el script del proyecto quiere respetarlo. Una corrida lanzada a mano antes de `verificar` no se detecta.
- Varias decisiones en un mensaje: ` + ` separa oraciones (como `.`, `;` o el salto de línea; la coma no). Con "Acotado + Aprobar diseño + Ejecutar en línea" se registra cada decisión con su tramo, y la compuerta de Bash acepta un tramo corto que es una oración entera. Si una frase ya se usó, el error explica cómo registrar cada decisión con su tramo.
- `RQ="node …/rq.mjs"; $RQ <subcomando> "<frase>"` ya no se niega cuando la frase trae palabras como "Aprobar": las palabras de una frase que el parser leyó no cuentan como subcomandos ocultos. El mensaje de forma ilegible da las dos formas que se aceptan (ruta literal, o `RQ=` en el mismo comando) y la skill lo explica.
- RQ con el PR mergeado: `estado` y el arranque avisan que la rama `rq/<código>` ya entró en otra rama de origin (`estado` también mira `gh pr list --state merged`, para los squash) y proponen seguir con la etapa 5 o cerrar. El hook anota cada skill en el RQ de la rama actual (`rq/<código>`); en otra rama no se la anota a un RQ que tiene la suya, ni a uno ya mergeado.
- `abrir` no pasa a la rama nueva con cambios sin commitear de otro RQ (`docs/rq/<otro>/`): los lista y dice cómo dejarlos en su RQ (commit en su rama o `git stash push -- docs/rq/<otro>`). `--llevar-cambios` si el usuario decide que van con el nuevo.
- `verificar` con `{specs}` en `tests.e2e` y sin specs del RQ en su diff ya no corre la suite completa sin avisar: lo dice y pide la ruta del spec (también fuera del repo, como `qa/e2e/` del workspace; rutas de Windows incluidas) o `--completo`.
- El arranque dice en una línea si el entorno del E2E está listo: `tests.e2e_requisitos` (`{ nombre, comando, con_salida? }`, p. ej. Docker y el contenedor) y que responda `tests.e2e_url` (salvo `e2e_chequear_url: false`, cuando el comando E2E levanta la app). PowerFy declara Docker y `powerfy-local-odoo-1`.
- Verificación local: la skill, la pista de lo que falta y el uso aceptan el recorrido con Playwright desde la PC contra el entorno local, con el usuario del rol real y sin mocks, además del navegador del agente; si el panel del navegador está oculto, Playwright.

## 4.0.1: otra cuenta de Claude en la misma PC (2026-11-07)

- Funciona con una segunda cuenta de Claude Code que corre con `CLAUDE_CONFIG_DIR` en el mismo usuario de Windows. El hook `PreToolUse` anota dónde está la transcripción de cada sesión en `~/.claude/bacg-dev/sesiones/`, y `rq.mjs` la busca ahí cuando no está en `~/.claude/projects`. Así verifica las frases del usuario sin confiar en variables de entorno que un agente puede cambiar.
- Plugins instalados y skills de Odoo se buscan en la carpeta de configuración de la cuenta en uso (`CLAUDE_CONFIG_DIR` o `~/.claude`). `~/.claude/bacg-dev.json` sigue siendo uno por PC, compartido entre cuentas.
- El registro de sesiones y las transcripciones de `CLAUDE_CONFIG_DIR` no se pueden editar con las herramientas de edición, igual que las de `~/.claude/projects`.

## 4.0.0: ciclo RQ v4, el ciclo humano (2026-11-06)

Cambia la numeración de etapas: los RQ y `proyecto.yml` viejos se convierten solos (ver más abajo). El circuito autómata llega en 4.1.
- Etapas 0 a 6: Arranque y clasificación, Diseño y plan (antes dos etapas), Desarrollo, Verificación, DEV / Preview, PROD y entrega, Cierre. `aprobar 1` aprueba siempre el diseño y plan; un `aprobar 6` sobre un RQ de versión 3 se traduce a 5 con aviso.
- Arranque que distingue inicio de reanudación: `rq.mjs arranque` dice si hay un RQ abierto en el repo (y su etapa) o si hay que empezar uno, también desde la carpeta padre de los repos y sin escribir nada en ellos.
- Clasificación confirmada por el usuario, con los nombres Exploración / Acotado / Arquitectónico; el diseño y el plan (brainstorming) valen para todo RQ y BUG. La exploración sólo commitea su carpeta.
- Elección de ejecución: antes del primer commit el usuario elige entre `executing-plans` y subagentes, y queda en `estado.yml`.
- Odoo detectado, no supuesto: las skills y reglas de Odoo aplican sólo si el proyecto lo declara o tiene addons.
- Verificación local con el rol real en los RQ que tocan UI (etapa 3).
- Una rama por RQ: se abre sin necesidad de upstream, `estado.yml` y los demás archivos de la CLI van en el mismo commit, pero quedan fuera del árbol testeado: escribirlos después de `registrar-tests` no invalida los tests.
- Conversión automática: un `estado.yml` sin `version_ciclo` se lee como v3 (etapas registradas y aprobaciones ≥ 2 se corren una) y no se reescribe hasta el próximo comando que escriba; los RQ abiertos con 3.x conservan su diseño. `proyecto.yml` viejos siguen valiendo sin cambios.
- RQ Arquitectónico abiertos con 3.x que tenían el diseño aprobado (`aprobar 1`) pueden editar código sin la aprobación del plan, porque en v4 diseño y plan son una sola etapa; el commit de código sigue exigiendo `writing-plans` y `plan.md`.
- Textos, plantilla y `AGENTS.md` sin supuestos de un proyecto, con la numeración nueva.
- Seguridad: `rq.mjs` mismo verifica que la frase de `aprobar`, `autonomia`, `saltar`, `clasificacion` y `ejecucion` la escribió el usuario en la sesión de Claude Code (su transcripción), sin importar cómo se haya escrito el comando; la frase tiene que ser un mensaje o una oración enteros y cada vez que el usuario la escribió vale para un solo registro; se busca en el home real del usuario (no el de HOME/USERPROFILE) y los eventos del sistema (CI, otras sesiones, agentes) no cuentan como texto del usuario; sin sesión sólo se acepta desde una terminal interactiva, volviendo a tipear la frase. Las terminales de MCP (`run_in_terminal`, `start_process`, `interact_with_process`, `execute_command`) pasan por la compuerta de Bash.
- Tests: cada proceso usa su propia carpeta temporal y la borra; la búsqueda de repos hermanos descarta sin lanzar git las carpetas vecinas sin `.git` (la suite bajó de ~1 h a minutos).


## 3.2.0: validación previa, proyecto explícito y skills de Odoo (2026-11-04)

- PLG-PREVIA: `rq.mjs abrir` corre antes una validación previa: `git fetch` de los repos del proyecto en la PC, atraso contra la rama de DEV (`rama_dev` del repo, `entornos.dev.rama` o `ramas_solo_pr`), ramas remotas activas (30 días) y PR abiertos contra DEV con sus módulos, y el backlog remoto (upstream de la copia de lineamientos o `docs/backlog.md` de origin). Un RQ nuevo no se abre si el código ya figura En curso o Hecho en el backlog remoto, o lo nombra una rama o un PR; `--sin-previa` sólo si el usuario lo pide. `rq.mjs previa [<código>]` muestra el informe sin abrir nada.
- PLG-PROY: `abrir` dice qué proyecto y repo detectó y cómo. Un repo declarado en dos proyectos frena hasta desambiguar con `.bacg-lineamientos`. Fuera de un repo, el arranque lista los repos con su proyecto y pide preguntarle al usuario en cuál va a trabajar; `ciclo-rq` confirma el proyecto antes de abrir.
- PLG-ODOO: skills oficiales de Odoo (`github.com/odoo/odoo/tree/20.0/skills`). `rq.mjs odoo-skills` las instala en `~/.claude/skills` (vía `gh api`, al commit de la rama, con registro en `.odoo-skills.json`); el alta lo pide en proyectos Odoo con addons. La CLI exige `odoo-guidelines` / `odoo-web-guidelines` (etapa 3), `odoo-review` y, con rutas sensibles o `controllers/`, `odoo-security` (etapa 4) según lo que el RQ toca dentro de un addon. `odoo_skills: false` lo apaga; `odoo_skills.rama` cambia la rama.

## 3.1.0: stepper de alta (2026-11-04)

- `/bacg-alta` y `rq.mjs alta`: pasos en orden (Node, gh, lineamientos, al día, plugins, repo del proyecto, repos hermanos, tests de la PC, script de los tests, E2E, ajustes locales), con ✅/❌/⚠️ y qué hacer en el próximo. Sale 1 si falta algo obligatorio.
- El arranque de sesión avisa "Alta incompleta" (y, recién instalado sin lineamientos, "alta pendiente") y pide guiar con `/bacg-alta`.
- `rq.mjs abrir` no abre un RQ con un paso obligatorio pendiente; `--sin-alta` sólo si el usuario lo pide.
- Arreglo: la CLI reconoce el repo por su remoto con la copia de lineamientos configurada (antes usaba sólo la del entorno del proceso).

## 3.0.0: el plugin se llama como el repositorio (2026-11-04)

Incompatible con 2.x: hay que reinstalar.
- Plugin y marketplace: `lineamientos-dev-claude-bacg` (antes `bacg-dev` y `lineamientos-bacg`). Instalación: `lineamientos-dev-claude-bacg@lineamientos-dev-claude-bacg`; skills: `lineamientos-dev-claude-bacg:<skill>`.
- Copia de lineamientos por defecto: `~/lineamientos-dev-claude-bacg` o `C:\MiCarpeta\lineamientos-dev-claude-bacg` (la carpeta que crea `gh repo clone`).
- Sin cambios: comandos `/bacg-rq` y `/bacg-estado`, `~/.claude/bacg-dev.json`, `BACG_LINEAMIENTOS_DIR`, `.bacg-lineamientos` y `.bacg-dev/`.

## 2.2.0: trabajo local y convergencia por PR (2026-11-04)

- Tests por PC: `~/.claude/bacg-dev.json` → `proyectos.<id>.tests` manda sobre `proyecto.yml` (cada dev corre los tests con su entorno local). La pista sin tests dice dónde declararlos y el arranque de sesión dice qué tests usa.
- `ramas_solo_pr` (por proyecto o repo): un push directo a esas ramas se niega y se pide un PR; el merge del PR sigue sus compuertas. PowerFy: `18.0-dev`.
- PowerFy: rama propia por RQ y PR obligatorio a `18.0-dev`; sus comandos de tests salen de `proyecto.yml` (van a la PC de cada dev).
- `docs/ENTORNOS.md`: trabajo local como camino principal; la nube queda opcional.

## 2.1.1: una sola copia de lineamientos en la nube (2026-11-04)

- `~/.claude/bacg-dev.json` acepta `lineamientosDir` como lista (vale la primera que existe). El setup pone primero el repo que el entorno clona junto a los del proyecto (`/home/user/lineamientos-dev-claude-bacg`, el que se commitea) y deja la copia propia de respaldo. Antes el plugin escribía backlog y ADR en una copia que nadie pusheaba.

## 2.1.0: repos del producto sin archivos del plugin (2026-11-04)

- PLG-CT: sin `.bacg-lineamientos`, un repo cuenta como del proyecto si su remoto origin es `<cuenta_github>/<nombre>` (o `repos[].github`) de un `proyecto.yml` registrado. El marcador sigue valiendo y manda. El arranque lista también los repos reconocidos por remoto.
- `scripts/setup-entorno.sh` habilita `bacg-dev` y `superpowers` en `~/.claude/settings.json` (sin pisar lo existente) y apunta `~/.claude/bacg-dev.json` a la copia de lineamientos: un entorno en la nube por proyecto, compartible, sin tocar el producto.
- `docs/ENTORNOS.md` reescrito con ese modelo.

## 2.0.0: plugin propio de BACG (2026-11-04)

Cambio de identidad (incompatible con 1.0.0: reinstalar y renombrar marcadores) y mejoras del backlog `proyectos/plugin/backlog.md`.

Identidad (PLG-ID): convive en la misma PC con el plugin de origen sin cruzarse.
- Plugin `bacg-dev` (skills `bacg-dev:<skill>`), comandos `/bacg-rq` y `/bacg-estado`.
- Marcador del repo `.bacg-lineamientos`, configuración en el repo `.bacg-dev/`, variable `BACG_LINEAMIENTOS_DIR`, archivo `~/.claude/bacg-dev.json`, marcas de AGENTS.md `bacg-dev:`.

Compuertas
- PLG-MCP: `mcp_prod` declara los conectores MCP de PROD (n8n, Odoo, genérico). Lectura pasa; el resto pide RQ activo + OK de PROD (falla cerrada). Odoo con `execute_kw` decide por `method`; `ids_prod` para instancias compartidas DEV/PROD. El hook PreToolUse mira todas las herramientas MCP.
- PLG-MULTI: RQ multi-repo. El mismo código en varios repos declarados del proyecto es un RQ lógico: hereda y replica aprobaciones, autonomía, saltos y skills.
- PLG-SKILLS: `skills_requeridas` por proyecto (etapa, tipo, rutas); tabla de skills de BACG en `ciclo-rq`.

Portabilidad y stack
- PLG-NUBE: `{raiz}` y `{repo:<nombre>}` en los comandos de tests, para correr en la nube y en cualquier PC.
- PLG-STACK: el valor por defecto es Odoo (`**/migrations/**`) sin agentes externos; Supabase/Lovable sólo si el proyecto los declara. Plantilla y `general/` con la referencia BACG; `general/git-lovable.md` pasa a `general/git.md`.
- Backlog del plugin en `proyectos/plugin/backlog.md`.

## 1.0.0: base BACG (2026-11-04)

Repo inicial de BACG a partir de `lineamientos-dev` 0.8.0 (mismo núcleo del plugin: ciclo de RQ, compuertas, hooks y CLI `rq.mjs`). Historia nueva, sin los proyectos ni la documentación de terceros.

- Plugin renombrado a `como-trabajo-bacg` y marketplace a `lineamientos-bacg`, para convivir sin choques con instalaciones del repo personal de origen. Las skills pasan a `como-trabajo-bacg:<skill>`.
- Copia de trabajo por defecto: `C:\MiCarpeta\lineamientos-bacg` (Windows) o `~/lineamientos-bacg`; config en `~/.claude/como-trabajo-bacg.json`.
- Proyectos: sólo `powerfy` (más `_plantilla`).
- `docs/ENTORNOS.md`: cómo armar un entorno de Claude Code por proyecto que cargue siempre este plugin y este repo.
