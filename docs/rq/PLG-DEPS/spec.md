# PLG-DEPS · Los plugins requeridos se instalan solos y sin ellos no se trabaja
Tipo: RQ · Clasificación: Arquitectónico · Repos: lineamientos-dev-claude-bacg
## Qué / Síntoma
Los 8 plugins requeridos (`session-start.mjs:77-86`) sólo se avisan al arrancar; el paso `plugins` del alta es opcional y sólo da el texto de `/plugin install` (`alta.mjs:142-152`). La plantilla del repo habilita sólo lineamientos y superpowers. Cada cuenta los instala a mano y se trabaja igual si faltan.
## Por qué / Esperado vs. actual
Pedido del usuario (18/11): en toda cuenta que use el plugin, las skills tienen que estar instaladas sí o sí. Opción elegida: 1 (declarar + red propia); la 3 (exigir desde la organización) queda en PLG-DEPS-ORG.
## Alcance (dentro / fuera)
Dentro: `dependencies` en el manifiesto y permiso de marketplaces cruzados; alta con paso obligatorio que instala; compuerta de edición que niega código si falta uno; aviso de MCP; plantilla de settings con todos los requeridos.
Fuera: exigirlos desde la configuración de la organización (PLG-DEPS-ORG); instalar los MCP solos (sólo aviso, ver Diseño).
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: amerita — cambia cómo se instala y despliega el plugin y suma dependencias de otros marketplaces (arq.md)
## Criterio de aceptación → flujo E2E que lo prueba
1. `plugin.json` declara las dependencias núcleo y `marketplace.json` permite los dos marketplaces; `claude plugin validate` pasa → tests/manifiestos.test.mjs.
2. El alta marca `plugins` como obligatorio en falta si falta uno y su remedio son los comandos `claude plugin install …` exactos; `abrir` se frena (patrón existente) → tests/alta.test.mjs.
3. Con un plugin requerido faltante, la compuerta de edición niega editar código y nombra qué instalar; docs y `.md` siguen libres; si no se puede leer qué hay instalado, avisa y no bloquea → tests/compuerta-edicion.test.mjs.
4. Cargado desde claude.ai (synced), cuenta los plugins sincronizados como instalados (ya lo hace `plugins-instalados.mjs`) → tests/alta-nube.test.mjs.

## Diseño
### Criterios centrales
1. Nunca se edita código de un RQ con un plugin núcleo faltante, salvo salto con frase del usuario.
2. Si falta una dependencia, el usuario ve qué falta y el comando para instalarla; nunca un plugin apagado sin explicación.

- **Dos niveles de requeridos** (decisión a confirmar con el usuario):
  - **Núcleo** (en `dependencies` del manifiesto, se instalan solos): `superpowers@superpowers-marketplace`, `pr-review-toolkit`, `security-guidance`, `claude-security`, `feature-dev`, `claude-md-management` (`@claude-plugins-official`).
  - **Por stack** (alta + compuerta, no en el manifiesto): `frontend-design` y `typescript-lsp` sólo si el proyecto tiene UI web o TypeScript (`ui.patrones` / stack de `proyecto.yml`). Resuelve PLG-REQ (PowerFy es Python/Odoo).
  - Motivo: Claude Code desactiva el plugin entero si falta una dependencia del manifiesto, y con él las compuertas de PROD. Por eso el manifiesto lleva sólo lo que todos los proyectos necesitan.
- **Manifiesto:** `dependencies` con los 6 del núcleo; `allowCrossMarketplaceDependenciesOn: ["superpowers-marketplace", "claude-plugins-official"]` en `.claude-plugin/marketplace.json`. Sin `version` (siguen al marketplace).
- **Alta:** el paso `plugins` pasa a obligatorio. Su remedio son los comandos `claude plugin marketplace add …` y `claude plugin install <id>` por faltante; el agente los corre con OK del usuario y vuelve a correr el alta. En la nube o con plugins de claude.ai: el remedio dice activarlos en claude.ai (no se instalan solos ahí).
- **Compuerta de edición:** después de la regla de archivos libres, si `pluginsInstalados` dice que falta un núcleo o uno del stack del proyecto, niega con el mismo texto del alta. Si no puede leer lo instalado: avisa en el arranque y no bloquea (no frenar por un error de lectura). Salto: `$RQ saltar plugins "<frase>" "<motivo>"`.
- **MCP** (`codebase-memory-mcp`, `context7`) y `odoo-skills`: odoo-skills ya es obligatorio en el alta. Los MCP quedan como paso recomendado del alta con su comando de alta; no bloquean (son ahorro de tokens, no calidad).
- **Plantilla** `plantillas/repo-proyecto/.claude/settings.json`: `enabledPlugins` con los núcleo.
- **Organización (opción 3):** fuera, en PLG-DEPS-ORG.
- Versión 4.7.0 con la tanda.
