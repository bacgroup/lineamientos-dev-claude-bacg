# PLG-DEPS · Los plugins requeridos se instalan desde el alta y sin ellos no se edita código
Tipo: RQ · Clasificación: Arquitectónico · Repos: lineamientos-dev-claude-bacg
## Qué / Síntoma
Los 8 plugins requeridos (`session-start.mjs:77-86`) sólo se avisan al arrancar; el paso `plugins` del alta es opcional y sólo da el texto de `/plugin install` (`alta.mjs:142-152`). La plantilla del repo habilita sólo lineamientos y superpowers. Cada cuenta los instala a mano y se trabaja igual si faltan.
## Por qué / Esperado vs. actual
Pedido del usuario (18/11): en toda cuenta que use el plugin, las skills tienen que estar instaladas sí o sí. Opción elegida el 19/11: C (alta con comandos + compuerta; sin `dependencies` en el manifiesto, para que una cuenta con un faltante no pierda el plugin y sus compuertas de PROD); la 3 (exigir desde la organización) queda en PLG-DEPS-ORG.
## Alcance (dentro / fuera)
Dentro: lista única de requeridos (núcleo y por stack); alta con paso obligatorio que instala; compuerta de edición que niega código si falta uno; aviso de MCP; plantilla de settings con todos los requeridos.
Fuera: `dependencies` en `plugin.json` (descartado: Claude Code no carga el plugin si falta una, code.claude.com/docs/en/plugins/dependencies); exigirlos desde la configuración de la organización (PLG-DEPS-ORG); instalar los MCP solos (sólo aviso, ver Diseño).
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: amerita — cambia cómo se instala el plugin y suma una compuerta que bloquea la edición (arq.md)
## Criterio de aceptación → flujo E2E que lo prueba
1. `plugin.json` no declara `dependencies` (el plugin carga aunque falte uno) y la plantilla de settings habilita los núcleo → tests/manifiestos.test.mjs.
2. El alta marca `plugins` como obligatorio en falta si falta uno y su remedio son los comandos `claude plugin install …` exactos; `abrir` se frena (patrón existente) → tests/alta.test.mjs.
3. Con un plugin requerido faltante, la compuerta de edición niega editar código y nombra qué instalar; docs y `.md` siguen libres; si no se puede leer qué hay instalado, avisa y no bloquea → tests/compuerta-edicion.test.mjs.
4. Cargado desde claude.ai (synced), cuenta los plugins sincronizados como instalados (ya lo hace `plugins-instalados.mjs`) → tests/alta-nube.test.mjs.

## Diseño
### Criterios centrales
1. Nunca se edita código de un RQ con un plugin núcleo faltante, salvo salto con frase del usuario.
2. Si falta una dependencia, el usuario ve qué falta y el comando para instalarla; nunca un plugin apagado sin explicación.

- **Dos niveles de requeridos** (opción C, decidida por el usuario el 19/11):
  - **Núcleo** (todo proyecto; alta obligatoria + compuerta): `superpowers@superpowers-marketplace`, `pr-review-toolkit`, `security-guidance`, `claude-security`, `feature-dev`, `claude-md-management` (`@claude-plugins-official`).
  - **Por stack** (alta + compuerta, sólo si el proyecto los usa): `frontend-design` y `typescript-lsp` sólo si el proyecto tiene UI web o TypeScript (`ui.patrones` / stack de `proyecto.yml`). Resuelve PLG-REQ (PowerFy es Python/Odoo).
  - Motivo: Claude Code no carga un plugin al que le falta una dependencia del manifiesto, y con él se irían las compuertas de PROD. Por eso ninguno va al manifiesto: se exige con el alta y la compuerta de edición, que nunca apagan el resto.
- **Manifiesto:** sin `dependencies`; un test lo cuida para que nadie lo agregue sin revisar esta decisión.
- **Alta:** el paso `plugins` pasa a obligatorio. Su remedio son los comandos `claude plugin marketplace add …` y `claude plugin install <id>` por faltante; el agente los corre con OK del usuario y vuelve a correr el alta. En la nube o con plugins de claude.ai: el remedio dice activarlos en claude.ai (no se instalan solos ahí).
- **Compuerta de edición:** después de la regla de archivos libres, si `pluginsInstalados` dice que falta un núcleo o uno del stack del proyecto, niega con el mismo texto del alta. Si no puede leer lo instalado: avisa en el arranque y no bloquea (no frenar por un error de lectura). Salto: `$RQ saltar plugins "<frase>" "<motivo>"`.
- **MCP** (`codebase-memory-mcp`, `context7`) y `odoo-skills`: odoo-skills ya es obligatorio en el alta. Los MCP quedan como paso recomendado del alta con su comando de alta; no bloquean (son ahorro de tokens, no calidad).
- **Plantilla** `plantillas/repo-proyecto/.claude/settings.json`: `enabledPlugins` con los núcleo.
- **Organización (opción 3):** fuera, en PLG-DEPS-ORG.
- Versión 4.7.0 con la tanda.

## Tareas
El plan con sus tareas está en `docs/rq/PLG-DEPS/plan.md` (Arquitectónico).
