# Changelog

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
