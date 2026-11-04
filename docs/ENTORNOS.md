# Entornos de desarrollo de BACG

Principio: **un repo central** (`bacgroup/lineamientos-dev-claude-bacg`) con el plugin, los lineamientos y el backlog de
cada proyecto, y **un entorno en la nube por proyecto** que siempre lo carga. **Los repos del producto no se tocan**:
el plugin los reconoce por su dirección en GitHub, declarada en `proyectos/<id>/proyecto.yml`.

| Pieza | Dónde vive | ¿Toca el repo del producto? |
|---|---|---|
| Plugin `bacg-dev` (compuertas, ciclo de RQ, skills) | `plugin/` de este repo | No |
| Lineamientos generales | `plugin/general/` | No |
| Contrato, reglas y backlog del proyecto | `proyectos/<id>/` | No |
| Qué repos son del proyecto | `cuenta_github` + `repos[].nombre` (o `repos[].github: owner/repo`) en `proyecto.yml` | No |
| Instalar el plugin y traer los lineamientos | `scripts/setup-entorno.sh`, en el setup del entorno | No |

## Entorno en la nube de un proyecto (p. ej. PowerFy)

1. En claude.ai/code, crear un entorno "PowerFy" con:
   - **Repos:** los del proyecto (`powerfy-docker`, `powerfy-addons`, `powerfy-ai`, `powerfy-bi`, `powerfy-l10n`) **y**
     `bacgroup/lineamientos-dev-claude-bacg`.
   - **Setup script:** el contenido de `scripts/setup-entorno.sh` (clona los lineamientos y habilita `bacg-dev` para
     todas las sesiones del entorno).
   - **Red:** acceso a GitHub y a lo que el proyecto necesite.
2. Compartir el entorno con el equipo. Cada sesión arranca con las reglas, el backlog y las compuertas del proyecto.
3. Mejoras de lineamientos o del plugin: PR a este repo; la próxima sesión las toma sola.

## Entorno y sesiones

- El **entorno** es la plantilla (repos, setup, red): uno por proyecto, se configura una vez.
- Cada **sesión** es una máquina nueva creada desde el entorno: una por tarea o RQ. Es descartable; sólo queda lo que se
  pushea a GitHub (código en los repos del producto; backlog, ADR y reglas en este repo).
- En la sesión, los lineamientos que usa el plugin son los de `/home/user/lineamientos-dev-claude-bacg` (el repo del
  entorno): lo que el ciclo de RQ escribe ahí se commitea y pushea desde ese repo al cerrar.

## PC local

Correr una vez `scripts/setup-entorno.sh` (Git Bash en Windows) con `gh auth login` hecho con una cuenta que vea
`bacgroup`. Hace lo mismo que en la nube: copia de lineamientos en `~/lineamientos-bacg` y plugin habilitado.

## Proyecto nuevo (p. ej. Migración Odoo 20)

1. Copiar `proyectos/_plantilla/` a `proyectos/<id>/` y completar `proyecto.yml` (con `cuenta_github` y `repos`),
   `resumen.md`, `reglas.md` y `backlog.md`.
2. Sumarlo a `proyectos/registro.yml`.
3. Crear su entorno en la nube (pasos de arriba).

Opcional: un repo que prefiera declararse a sí mismo puede llevar `.bacg-lineamientos` (`proyecto: <id>`); el marcador
manda sobre el remoto. Para BACG no hace falta.

## Cómo colabora el equipo

- Cambios a lineamientos o al plugin: rama + PR a `main` de este repo; `npm test` en verde. Al subir la versión del
  plugin, el arranque de sesión avisa que hay que actualizar (`/plugin marketplace update lineamientos-bacg`).
- Backlog: lo escribe `rq.mjs` al cerrar cada RQ en `proyectos/<id>/backlog.md`; se commitea acá.
- Accesos: equipo técnico de BACG con escritura (team de GitHub); externos como colaboradores puntuales.
