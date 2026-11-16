# Changelog

## 4.6.0: fuente única del backlog (2026-11-16)

**Origen:** hallazgo 8 del handoff de PowerFy en la nube. En los proyectos con la configuración en el repo central, `abrir` y `cerrar` copiaban entero el backlog central sobre `docs/backlog.md` del repo. Si la copia local estaba atrasada, o alguien agregó o actualizó filas en el repo, esas filas se perdían. En PowerFy aparecieron paneles hechos que figuraban como Pendiente y desapareció una fila agregada en un commit.

**Cambios:**
- `backlog: repo` en `proyecto.yml` hace que `docs/backlog.md` del repo sea la única fuente; la copia central ya no se toca. Con la configuración en el repo (`.bacg-dev/`) ya era así.
- Con la fuente central, `abrir` y `cerrar` **fusionan** las dos copias en lugar de pisar la del repo:
  - la fusión es quirúrgica: sólo agrega las filas que faltan o sube la celda Estado; columnas extra, filas sin código, `\|` escapados y el texto antes y después de la tabla quedan igual;
  - por código, gana el estado más avanzado (Hecho, Descartado o Cerrado; después En curso o un Hecho parcial con "falta"; después el resto);
  - la fila del RQ que escribe la CLI manda en las dos copias: un RQ reabierto queda En curso aunque una copia lo tuviera Hecho.
- La validación previa avisa si las dos copias difieren y lista los códigos.
- `rq.mjs backlog migrar` fusiona la copia central en `docs/backlog.md`, marca la central como obsoleta y declara `backlog: repo` en `proyectos/<id>/proyecto.yml`; una segunda corrida responde "ya está migrado" y no vuelve a fusionar. Pasar un proyecto a la fuente única lo decide el usuario, en una sesión de ese proyecto.
- **Límite conocido de la fuente central:** `docs/backlog.md` vive en cada rama. Un RQ reabierto (En curso) puede volver a Hecho en la central si después se abre o cierra otro RQ desde una rama cuya copia todavía lo tiene Hecho. La salida es `backlog migrar` (una sola fuente).

## 4.5.0: el plugin en Claude Code en la nube (2026-11-16)

**Origen.** La sesión cloud autónoma de PowerFy del 16/11: alta, 7 RQ de UI y el diseño de PF-MARCA. El handoff está en `docs/handoff/2026-11-16-powerfy-cloud.md`. El ciclo funcionó, pero el plugin dio "todo OK" falsos ("ningún PR abierto" con 7 abiertos, "lineamientos al día" con 5 commits de atraso), bloqueó por falsos negativos y dejó escribir código por Bash antes del diseño aprobado. Criterio: el plugin nunca afirma "nada" o "al día" sin haberlo verificado.

**GitHub por REST** (`lib/github.mjs`, hallazgos 1, 2 y 4). Todo lo que se lee de GitHub va por `gh api`:
- en la validación previa, los PR abiertos contra DEV y sus archivos;
- en `entregar`, el PR de la rama y sus checks (check-runs y statuses);
- el PR ya mergeado de `rq/<código>`;
- los PR de sync del circuito;
- en las compuertas de merge, la base, la cabeza y los archivos del PR.

Antes iba por `gh pr list/view` (GraphQL), que da 403 en la nube. Cada consulta devuelve datos o error, y un error se informa: "no pude listar los PR (HTTP 403)" o "PR: no consultados", nunca "ninguno".
- La previa trae todas las ramas de origin (`+refs/heads/*`, con `--depth=50` en clones superficiales). En la nube los clones traen sólo la rama por defecto y las ramas de otros no se veían nunca.
- `entregar` da los comandos REST para crear el PR y seguir la CI. `ciclo-rq` documenta los equivalentes REST de crear, checks y merge.

**El alta y el arranque en la nube** (hallazgos 3, 6, 7 y 11)
- GitHub se verifica con `gh api user`, no con `gh auth status`, y el alta muestra la cuenta.
- El aviso de cuenta de gh lee `hosts.yml` directo (`gh config get` falla sin keyring), con `gh api user` como respaldo.
- "Lineamientos al día" trae origin (timeout de 20 s) antes de comparar. Sin red o sin clon dice "no verificado".
- Los plugins sincronizados desde claude.ai (`plugins/synced/`) cuentan como instalados (`lib/plugins-instalados.mjs`).
- El paso del merge en modo automático dice que la regla la agrega el usuario o el entorno (el agente no puede ampliarse los permisos) y reconoce también la regla REST.

**`rq.mjs odoo-skills`** (hallazgo 5). Si la API no deja leer odoo/odoo, baja `skills/` con un clon anónimo y sparse-checkout. `.odoo-skills.json` registra la vía.

**Compuertas** (hallazgos 15 y 16)
- Con reglas 4.4, lo que un comando de Bash escribe en un repo pasa por la compuerta de edición. Cubre redirección y heredoc, `sed -i`, `tee`, `cp`, `mv`, y `python -c` / `node -e` con `open(…,'w')`, `Path().write_text` o `writeFileSync`. El motivo de la negación es el mismo que con Edit/Write. El hook le pasa a Bash las skills del contexto.
- Crear o mergear un PR por la API REST tiene las mismas compuertas que `gh pr create` y `gh pr merge`. Cubre `gh api …/pulls` con campos o `--input`, `-X PUT …/pulls/<n>/merge`, flags pegados, URL absoluta y `{owner}/{repo}`. Las rutas que publican sin PR (`…/merges`, `git/refs`) y las mutaciones de merge por `graphql` se evalúan contra el RQ como PROD.
- Las consultas a GitHub dentro de un hook tienen un tope de 4 s: si tarda, la compuerta niega, en lugar de que el hook se corte y deje pasar.
- Las redirecciones a descriptores (`2>&1`, `>&2`), `/dev/*` y las salidas tipo log (`.log`, `.out`, `.tmp`, `.pid`) no cuentan como escrituras.
- `abrir --sin-previa` y `--sin-alta` exigen `--frase "<frase del usuario>"`.
- Fijar `BACG_DEV_SIN_PREVIA`, `SIN_ALTA` o `SIN_GH` en un comando que corre `rq.mjs` se niega.

**Otros**
- Los rojos conocidos reconocen la salida de Odoo (hallazgo 12).
- `entregar` avisa si otra rama `rq/*` toca el mismo artefacto compilado (`compilados` en `proyecto.yml`; por defecto `*.bundle.js`, `*.min.js` y `dist/**`) (hallazgo 18).
- `abrir` dice primero qué frena a un Arquitectónico (hallazgo 19).
- "No tests found" con el spec en `docs/rq/<código>/qa/` explica dónde va (hallazgo 13).
- En el criterio ARQ, el tamaño sólo cuenta junto con un eje: contrato, datos, seguridad o despliegue (hallazgo 14).
- Registrar y pushear van en comandos separados (hallazgo 9). Con el Stop hook de la nube, commit local y push después de la revisión (hallazgo 10).
- `docs/ENTORNOS.md` suma una sección de la nube.

**Tests.** La suite queda sin rojos conocidos. Los dos que fallaban en la nube eran bugs:
- la previa (hallazgo 1);
- el test del aviso de cuenta, que heredaba el `BACG_DEV_SIN_GH=1` del entorno (PLG-GH).

**Sin construir.**
- La fuente única del backlog (hallazgo 8) queda como propuesta en PLG-BACKLOG.
- El 17 (falso positivo al commitear docs) no se reprodujo con un script común: queda en PLG-BASH.

## 4.4.0: compuertas de cumplimiento, OK flexibles y Superpowers como eje (2026-11-15)

**Origen.** El retrabajo de R-MOD-V2 en dev-fullflow (`nkick25/dev-fullflow` → `docs/rq/PLG-DFF2/`): 22 devoluciones, unos 82 puntos y 6 casos de producto que encontró el usuario, todo con las compuertas en verde. A eso se suman cuatro premisas del usuario: los OK eran rígidos y la autonomía los volvía a pedir; Superpowers había quedado como optativo; la revisión miraba poco la calidad; y los mockups eran optativos. El plugin controlaba que una skill se cargó, no que se cumplió.

Las reglas nuevas valen para los RQ abiertos desde la 4.4 (`reglas: 44` en `estado.yml`). Un RQ en curso las toma con `rq.mjs reglas actualizar`, y un proyecto que todavía no las adopta declara `reglas: 43` en `proyecto.yml`.

**OK flexibles (premisa 1)**
- `rq.mjs ok "<frase>"`: una respuesta del usuario registra todo lo pendiente del RQ hasta DEV (clasificación, diseño y plan escritos, ejecución y autonomía) y cuenta como un solo uso de la frase.
- `rq.mjs autonomia total "<frase>" [--ejecucion subagentes]`: lo mismo para todos los RQ de la sesión, Arquitectónico incluido. Antes, la autonomía de sesión no aprobaba el diseño de un Arquitectónico ni la ejecución, y la misma frase no se podía reusar.
- La frase puede ser el tramo inicial de una oración cortado en una coma ("Sí, dale" de "Sí, dale, el diseño está bien"), si trae un verbo de aprobación y nada que la niegue, la frene o la postergue. "OK, pero mañana" sigue sin valer.
- PROD y los saltos siguen pidiendo su frase propia.

**Superpowers como eje (premisa 2)**
- Antes del primer commit de código se exigen `brainstorming`, `writing-plans` (también en Acotado), `test-driven-development` (antes recién en la verificación) y la skill de la ejecución elegida.
- En la verificación se exigen `requesting-code-review` (antes prohibida), `verification-before-completion` y, después de una revisión bloqueante, `receiving-code-review`.
- `ciclo-rq` ya no dice "el resto es opcional" y nombra los únicos reemplazos deliberados.

**Revisión de calidad (premisa 3)**
- Tres pasadas exigidas para `revision ok`: `pr-review-toolkit:code-reviewer`, `pr-review-toolkit:pr-test-analyzer` y el agente nuevo del plugin `revisor-rq` (`plugin/agents/revisor-rq.md`). Este último revisa el diff contra el spec: traza, criterios centrales, paridad, duplicados, dominio, canon y devoluciones.
- El hook `PostToolUse` anota los subagentes de un plugin (herramienta Agent) como skills del RQ.
- La revisión guarda el commit revisado y vence si después entra código.

**Journey y mockups (premisa 4, cambios 1 y 2, P-4)**
- Para editar UI, `## Diseño` tiene que traer:
  - `### Journey` (3 pasos o más);
  - `### Mockups` (archivo en `docs/rq/<código>/mockups/` o link de Figma);
  - `### Referencias leídas`;
  - `### Paridad`.
- Las skills de UI valen por contexto: una compactación las vence.
- `verificar --local` pide capturas a 390, 768 y 1280 y la `ref-*.png` de la referencia.
- `diseno-frontend` se reescribió como checklist con evidencia: el mockup y `/prototype` definen layout, nunca estilos.

**Lista cerrada y traza (P-11, P-14, P-16, P-17)**
- `rq.mjs devolucion`: puntos numerados con su evidencia. Al segundo punto sobre el mismo elemento corta la iteración con un protocolo.
- `rq.mjs trazar`: arma `traza.yml` desde el criterio de aceptación. La revisión exige un estado por ítem y un test en cada "hecho".
- El diseño de un Arquitectónico exige `### Criterios centrales`.

**El plugin como proyecto propio**
- `.bacg-dev/proyecto.yml` (PROD = `main`). El backlog del plugin pasa a `docs/backlog.md`.
- `npm test` muestra sólo los fallos (`tests/reporter-fallos.mjs`, el formato que reconoce `tests.rojos_conocidos`) y `npm run test:e2e` corre el ciclo de la CLI.

**Otros cambios**
- `decision-arq` tiene una sola ruta de ADR y ya no trae una ruta fija de Windows.
- Las descripciones de `design-taste-frontend` y `redesign-existing-projects` quedan acotadas a su uso dentro del ciclo.
- `tokens.md` declara el piso de calidad que no se recorta por tokens.

**Quedó en el backlog**
- Paridad ejecutable automática (P-1 y P-2), `cotejar` (P-3), lint del canon (P-5), performance (P-7), `asesor-gestion` (P-9), kits de dominio (P-10), costo por resultado (P-12), estándar de avisos (P-18), paridad con uso real (P-19), los cambios 3, 9 y 10 de la propuesta, y los falsos positivos de la compuerta de Bash con textos que nombran `rq.mjs`.

## 4.3.1: el plugin se instala en Cowork (2026-11-15)

- `decision-arq`: la description decía `proyectos/<id>/adr/` y Cowork rechazaba el paquete ("SKILL.md description cannot contain XML tags"). Ahora dice `proyectos/{id}/adr/`; el cuerpo de la skill no cambia.
- Test nuevo en `manifiestos.test.mjs`: ninguna description de skills, comandos, `plugin.json` o `marketplace.json` puede traer algo con forma de etiqueta (`<x>`).

## 4.3.0: aprobaciones de una vez y varios RQ en una sesión (2026-11-11)

Lo que frenó la sesión del 2026-11-11 (dos RQ de UI a la vez, "de manera automatizada" por pedido del usuario): la aprobación general del usuario no cubría ningún RQ y hubo que dictarle una frase por RQ, las skills se cargaron dos veces y el cambio de ramas dejó trabas.
- **Autonomía de sesión:** `rq.mjs autonomia sesion "<frase>"` registra una vez la aprobación general del usuario. Vale para los RQ activos y los que se abran o retomen en esa sesión de Claude Code: confirma la clasificación propuesta, aprueba diseño y tareas de Exploración y Acotado cuando `## Diseño` y `## Tareas` ya están en `spec.md` (`autonomia aplicar` si se escribieron después) y da autonomía hasta DEV. El diseño de un Arquitectónico y PROD siguen siendo por RQ, otra sesión no la hereda y la frase se vuelve a verificar contra la transcripción cada vez que se aplica. Una frase ya registrada en un RQ abierto para otra decisión no se acepta como autonomía de sesión. Los registros quedan con `via: sesion`.
- **Aprobación de lote:** `rq.mjs lote aprobar "<frase>" <código>…`: con una frase que nombra los RQ (el código o su último tramo: "VENTAS" por APP-UI-VENTAS) o dice que son todos, confirma la clasificación y aprueba el diseño de cada uno que tenga `## Diseño` y `## Tareas` (y `plan.md` en Arquitectónico). Todo o nada en el checkout; los RQ que viven en otra rama se aprueban corriendo lo mismo ahí. Registros con `via: lote`.
- **Skills de la sesión:** al abrir o retomar un RQ, las skills ya cargadas en la sesión (según su transcripción) se anotan en él; `rq.mjs skills importar` lo hace a pedido. Ya no hay que invocar dos veces `brainstorming`, `diseno-frontend` o las de Odoo.
- **`ACTIVO` después de un merge:** `rq.mjs activo reparar` lo rehace con los RQ abiertos del árbol y resuelve el conflicto en el índice; `estado` avisa si tiene marcas de conflicto o RQ cerrados. Las marcas de conflicto ya no se leen como códigos.
- Compuerta de Bash: `RQ='node …/rq.mjs'; $RQ abrir … --clasificacion acotado` ya no se niega como "forma ilegible": se descuenta sólo la opción `--clasificacion <valor>`; cualquier otra mención de las palabras sigue contando. Un comando que fija o borra `CLAUDE_CODE_SESSION_ID` se niega: con el id de otra sesión, rq.mjs habría tomado frases, autonomía o skills de esa sesión. El commit de un merge en curso (`git add <docs> && git commit --no-edit`) no cuenta lo que entra igual que en la rama mergeada si esa rama está publicada (p. ej. `origin/<DEV>`); lo que difiere sí, y un merge de una rama local sin publicar se evalúa entero.
- `verificar`: un spec con ruta absoluta dentro de la carpeta del script de `tests.e2e` se pasa relativo a ella (Playwright respondía "No tests found"), y un "No tests found" ya no queda registrado como E2E fallido. Las capturas que los specs de regresión escriben en `docs/rq/<otro RQ>/qa/` vuelven a como estaban al terminar.
- Alta: paso recomendado "Merge del PR a <DEV> en modo automático": sin una regla `Bash(gh pr merge:*)` en los settings, el modo automático de Claude Code niega el merge y la autonomía hasta DEV se corta ahí. El merge a PROD lo sigue frenando la compuerta.
- `ciclo-rq`: sección 1.1 "Varios RQ a la vez" (aprobaciones, skills, orden de ramas, app local compartida, bundles compilados, `ACTIVO`) y el merge a DEV en modo automático.

## 4.2.2: merge de un PR de sólo docs sin RQ (2026-11-10)

- `gh pr merge` de un PR que sólo trae docs o tests (según `gh pr view --json files`), a una rama que no es de PROD, pasa sin RQ, igual que el push de sólo docs de la 4.2.1. Antes, el PR que registraba un cierre se podía publicar pero no mergear sin abrir un RQ. A PROD, con código, sin archivos legibles o con 100 o más archivos (la lista de gh puede venir cortada), se sigue verificando contra el RQ.

## 4.2.1: publicar docs sin trabas (2026-11-10)

Lo que frenó el cierre y el registro de RQ ya desplegados en la sesión del 2026-11-10: el push de una rama de docs pedía un RQ y la etapa 3, y las frases dichas a mitad de un turno no contaban.
- El primer push de una rama nueva (`git push -u origin <rama>`, sin upstream) que sólo trae docs o tests pasa sin RQ, como ya pasaba con upstream: se miran los commits que ningún remoto tiene. Si la rama ya está en el remoto pero sin upstream, se compara contra esa rama. Una rama nueva que es de PROD se sigue verificando contra el RQ. Antes, sin upstream, todo push iba contra el RQ: "No hay RQ activo" o, con uno abierto para destrabar, "Falta la etapa 3".
- `git switch -c <rama>` (o `checkout -b`, con o sin `-q`) antes de `git add <docs> && git commit` en el mismo comando ya no se niega: crear una rama en HEAD no cambia el índice. Con punto de partida o a una rama existente sigue siendo en comandos aparte.
- Las frases que el usuario manda mientras el agente trabaja (llegan como mensaje en cola) cuentan como texto suyo para `clasificacion`, `aprobar`, `ejecucion`, `autonomia` y `saltar`. Antes había que pedírselas de nuevo.
- `paso hecho` con un paso de un `circuito_prod` anterior (un pendiente anotado antes de que el proyecto lo renombrara) explica que ya no existe y lista los pasos vigentes; el de un paso desconocido también los lista.
- `entregar --rq <código>` parado en la rama de otro RQ muestra el PR de la rama del RQ pedido (`rq/<código>`), con un aviso, y no el de HEAD.

## 4.2.0: menos contexto gastado en salidas de comandos (2026-11-10)

Lo útil de un proxy de compresión como Headroom, hecho dentro del plugin con hooks (Headroom no sirve en la app de escritorio: no respeta `ANTHROPIC_BASE_URL`).
- Compactador de salidas (hook `PostToolUse`, `updatedToolOutput`): en los repos del plugin, una salida de Bash o PowerShell de más de 4.000 caracteres llega compactada. En texto: líneas repetidas colapsadas, errores con su contexto, principio y final; en JSON (`gh api`): sin campos de ruido y con listas y textos largos recortados. No toca lectura de código (`cat`, `sed`, `Get-Content`…), diffs (`git diff/show/log`, también con `git -C`), búsquedas (`grep`, `rg`…) ni `rq.mjs`. El original queda en `~/.claude/bacg-dev/salidas/` (7 días) y la salida dice la ruta. Sin poder guardar el original, o con menos de 25 % de ahorro, no compacta. Se apaga con `"compactar": false` en `~/.claude/bacg-dev.json` o `BACG_DEV_SIN_COMPACTAR=1`. Medido sobre 640 sesiones guardadas: donde actúa ahorra 71 % y no perdió ninguna de 75 líneas de error; es el 0,3 % de toda la salida de Bash, porque casi todo lo largo es lectura de código.
- Tests y E2E que fallan en `rq.mjs`: además de la cola, cada línea de error de antes con su contexto (el FAIL de Odoo que sale en el medio, seguido del teardown, ya no se pierde), y la ruta de la salida completa.
- Hook `PreCompact`: al compactar la conversación pide conservar el estado de cada RQ abierto (código, clasificación, etapa, aprobaciones registradas, tests y E2E, lo que falta), las frases del usuario sin registrar, los rojos y las rutas de salidas compactadas.
- Higiene de plugins: el alta suma el paso "Plugins que sobran en esta carpeta" (recomendado). Propone apagar, sólo en esa carpeta (`enabledPlugins` en `.claude/settings.local.json`), los plugins habilitados que no se usaron en las últimas 30 sesiones de la carpeta (con 5 sesiones o más para juzgar). Nunca este plugin, los requeridos ni un **plugin hermano**: el que comparte dos o más skills con este (dev-fullflow, derivado de este plugin, que convive en la misma PC con otra configuración y a veces otra cuenta de Claude). Con un hermano habilitado, el arranque sólo aclara que en esa carpeta rige este plugin y que el hermano no se apaga ni se toca. El código no nombra a ningún hermano: derivado en dev-fullflow, el aviso es el simétrico.
- `ciclo-rq`, sección 2.3 "Leer sin llenar el contexto": código con Grep y Read por tramos (no `cat`/`sed -n` enteros), addons desde el repo local y no con `docker exec … cat`, `git diff --stat` antes del diff, logs con `--tail` y grep, `gh run view --log-failed`, barridos amplios con el subagente `Explore`, y releer la salida compactada desde su ruta en lugar de repetir el comando.
- Orden de ramas DEV → PROD (`lib/promocion.mjs`): en un repo con `ramas_prod` y una rama de DEV distinta (`rama_dev`, `entornos.dev.rama` o la primera de `ramas_solo_pr`), a PROD sólo llega lo que ya está en `origin/<DEV>`. La compuerta de Bash niega el push a PROD de algo que DEV no tiene, el merge de un PR a PROD que no viene de DEV y `gh pr create` con base en PROD desde otra rama (también sin `--base`, cuando la rama por defecto del repo es PROD, como en PowerFy). La promoción DEV → PROD pasa; un hotfix directo, con el salto `rama` del usuario. `entregar` sugiere `gh pr create --fill --base <DEV>` y `desplegar` describe cada `push:<repo>` como la promoción DEV → PROD. Para que PROD espere la verificación en DEV, el circuito declara un paso del tipo nuevo `dev:<texto>` (`dev:verificado`) antes de los `push:` (los `manual:` nunca frenan a otro paso); se registra con `paso hecho dev:verificado "<evidencia>"` y `desplegar` lo explica. PowerFy y la plantilla quedan así; `manual:verificar-en-dev-y-promover-18.0` sale del circuito de PowerFy (los RQ cerrados que lo tenían pendiente pasan al paso nuevo cuando se registra el próximo paso).
- Nuevos: `lib/compactar.mjs`, `lib/hooks/compactador.mjs`, `lib/hooks/pre-compact.mjs`, `lib/higiene.mjs`, `lib/promocion.mjs` y sus tests.

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
