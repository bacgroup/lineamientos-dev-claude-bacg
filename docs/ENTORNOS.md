# Entornos de desarrollo de BACG

Principio: **un repo central** (`bacgroup/lineamientos-dev-claude-bacg`) con el plugin, los lineamientos y el backlog de cada
proyecto; **un entorno por proyecto** que siempre lo carga. Nadie copia lineamientos a mano: se actualizan acá y
llegan a todos.

| Pieza | Dónde vive | Quién la mantiene |
|---|---|---|
| Plugin `como-trabajo-bacg` (compuertas, ciclo de RQ, skills) | `plugin/` de este repo | Responsable técnico, vía PR |
| Lineamientos generales | `plugin/general/` | Todo el equipo, vía PR |
| Contrato, reglas y backlog de cada proyecto | `proyectos/<id>/` (o `.como-trabajo/` del repo del proyecto) | Equipo del proyecto |
| Activación del plugin en cada repo | `.claude/settings.json` + `.lineamientos` en el repo del proyecto | Equipo del proyecto |

## Un entorno por proyecto

Cada proyecto (PowerFy, Migración Odoo 20, …) tiene:

1. **En sus repos**, dos archivos de `plantillas/repo-proyecto/`:
   - `.claude/settings.json`: registra el marketplace `lineamientos-bacg` y habilita el plugin. Quien abra el repo con
     Claude Code recibe el pedido de instalarlo; no hace falta que nadie se acuerde.
   - `.lineamientos` con `proyecto: <id>`: activa las compuertas para ese proyecto. Sin este archivo, no hay compuertas.
2. **Entorno en la nube (claude.ai/code)**, uno por proyecto, con:
   - Repos: los del proyecto **y** `bacgroup/lineamientos-dev-claude-bacg` (sin este último el plugin no encuentra backlog ni reglas).
   - Setup script: el contenido de `scripts/setup-entorno.sh`.
   - Red: acceso a GitHub (y a lo que el proyecto necesite).
3. **Máquina local**: `gh auth login` con una cuenta que vea la org `bacgroup`, clonar este repo en
   `C:\MiCarpeta\lineamientos-bacg` (Windows) o `~/lineamientos-bacg`, y abrir Claude Code en el repo del proyecto.

## Proyecto nuevo

1. Copiar `proyectos/_plantilla/` a `proyectos/<id>/` y completar `proyecto.yml`, `resumen.md`, `reglas.md` y `backlog.md`.
2. Sumarlo a `proyectos/registro.yml`.
3. Poner `.claude/settings.json` y `.lineamientos` en cada repo del proyecto.
4. Crear su entorno en la nube (paso 2 de arriba).

## Cómo colabora el equipo

- Cambios a lineamientos o al plugin: rama + PR a `main` de este repo; `npm test` en verde. Al subir la versión del
  plugin, el arranque de sesión avisa a cada uno que actualice (`/plugin marketplace update lineamientos-bacg`).
- Backlog: lo escribe `rq.mjs` al cerrar cada RQ; se commitea acá, así todos ven el mismo estado.
- Accesos: equipo técnico de BACG con permiso de escritura (team de GitHub); externos como colaboradores puntuales.
