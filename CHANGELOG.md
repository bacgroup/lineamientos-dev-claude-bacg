# Changelog

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
