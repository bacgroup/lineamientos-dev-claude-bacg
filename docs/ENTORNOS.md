# Cómo trabaja el equipo de BACG

Principio: **cada desarrollador trabaja en local** con el plugin `bacg-dev`, y el equipo **converge en Git**: ramas y
PR hacia la rama de DEV de cada proyecto, que despliega al entorno de DEV; de ahí, a PROD según el circuito del
proyecto. Los lineamientos, reglas y backlog viven en un solo repo central (`bacgroup/lineamientos-dev-claude-bacg`).

| Pieza | Dónde vive | ¿Toca el repo del producto? |
|---|---|---|
| Plugin `bacg-dev` (compuertas, ciclo de RQ, skills) | `plugin/` de este repo | No |
| Contrato, reglas y backlog de cada proyecto | `proyectos/<id>/` | No |
| Qué repos son de cada proyecto | `cuenta_github` + `repos[].nombre` en `proyecto.yml` (el plugin los reconoce por su remoto) | No |
| Dónde convergen los cambios | La rama de DEV del proyecto (PowerFy: `18.0-dev` → dev.powerfy.cloud) | Es el flujo normal de Git |

## Alta de un desarrollador (una vez por PC)

1. `gh auth login` con una cuenta que vea la org `bacgroup`.
2. Claude Code y Node 22 o más.
3. Correr `scripts/setup-entorno.sh` de este repo (en Windows, con Git Bash). Clona los lineamientos en
   `~/lineamientos-bacg` (o `C:\MiCarpeta\lineamientos-bacg`) y habilita `bacg-dev` y `superpowers` en
   `~/.claude/settings.json`.
4. Clonar los repos del proyecto **uno junto al otro**, en la misma carpeta (así el plugin vincula los RQ que tocan
   varios repos). Para PowerFy, además, levantar el entorno local de Odoo del proyecto.

## Flujo diario

1. Abrir Claude Code en el repo del proyecto: el arranque muestra el proyecto, el RQ activo y el stack.
2. `/bacg-rq <código>` o pedir el cambio: el ciclo de RQ guía diseño, desarrollo con tests y revisión.
3. Converger: push a una rama propia y PR a la rama de DEV (o push a la rama de DEV, según `reglas.md` del proyecto).
   El plugin exige tests y revisión antes; PROD pide además el OK explícito.
4. Al cerrar el RQ, el backlog se actualiza en la copia local de este repo: **commitear y pushear este repo** para
   que el resto del equipo lo vea (`git pull --rebase` antes, por si otro cerró un RQ al mismo tiempo).

## Proyecto nuevo (p. ej. Migración Odoo 20)

1. Copiar `proyectos/_plantilla/` a `proyectos/<id>/` y completar `proyecto.yml` (con `cuenta_github`, `repos`,
   `ramas_prod` y la rama de DEV), `resumen.md`, `reglas.md` y `backlog.md`.
2. Sumarlo a `proyectos/registro.yml` y pushear. Cada dev hace `git pull` de este repo y ya lo tiene.

## Cambios a lineamientos o al plugin

- Rama + PR a `main` de este repo, con `npm test` en verde. Mejoras del plugin: `proyectos/plugin/backlog.md`.
- Al subir la versión del plugin, el arranque de sesión avisa a cada uno: `/plugin marketplace update lineamientos-bacg`.

## Sesiones en la nube (opcional, no es el camino principal)

Sirven para tareas puntuales, no para el trabajo del día a día. En la nube los repos se eligen en cada sesión y los
plugins sólo llegan si están publicados en la biblioteca de plugins de la organización en claude.ai.
