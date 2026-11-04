# lineamientos-dev-claude-bacg

Cómo trabajamos en BACG, hecho plugin de Claude Code. Repo central de lineamientos y backlog de todos los proyectos; cada proyecto tiene su entorno y siempre carga este plugin (ver [docs/ENTORNOS.md](docs/ENTORNOS.md)).

Este repo es dos cosas a la vez:

- **El marketplace `lineamientos-dev-claude-bacg`** con el plugin **`lineamientos-dev-claude-bacg`** (carpeta `plugin/`): skills del ciclo de RQ y hooks que funcionan como compuertas. Sin RQ abierto y aprobado no se edita código de producto; sin tests en verde y revisión no hay push ni merge; sin el OK del usuario en la sesión no se toca PROD (push o merge a las ramas de PROD, escrituras por conectores MCP de PROD como n8n u Odoo, y el stack heredado Supabase/Lovable si un proyecto lo declara).
- **La copia de trabajo de los lineamientos** (`plugin/general/` viaja con el plugin; `proyectos/<id>/` o `.bacg-dev/` del repo), que los hooks leen en cada sesión para inyectar el contexto del proyecto.

## Primer uso: `/bacg-alta`

Después de instalar el plugin, abrí Claude Code en un repo del proyecto y corré **`/bacg-alta`**. Es un paso a paso que verifica y te guía, en orden:

| # | Paso | ¿Obligatorio? |
|---|---|---|
| 1 | Node 22 o más | Sí |
| 2 | GitHub CLI autenticado (`gh auth login`) | Sí |
| 3 | Copia de los lineamientos en esta PC | Sí |
| 4 | Lineamientos al día | Recomendado |
| 5 | Plugins complementarios | Recomendado |
| 6 | Sesión abierta en un repo de un proyecto registrado | Sí |
| 7 | Repos del proyecto clonados uno junto al otro | Recomendado |
| 8 | Tests del proyecto en esta PC (`~/.claude/bacg-dev.json`) | Sí |
| 9 | El comando de tests encuentra su script | Sí |
| 10 | E2E en esta PC | Recomendado |
| 11 | Ajustes de esta PC | Recomendado |

Mientras falte un paso obligatorio, el arranque de sesión lo avisa y `rq.mjs abrir` no abre RQ. El agente te guía de a un paso hasta "Todo listo".

## Instalación en otra cuenta

1. Acceso al repo privado: la cuenta tiene que poder leer `bacgroup/lineamientos-dev-claude-bacg` en GitHub, con `gh auth login` hecho en esa máquina.
2. En Claude Code:

   ```
   /plugin marketplace add bacgroup/lineamientos-dev-claude-bacg
   /plugin install lineamientos-dev-claude-bacg@lineamientos-dev-claude-bacg
   ```

3. Clonar la copia de trabajo de los lineamientos:

   ```
   gh repo clone bacgroup/lineamientos-dev-claude-bacg <ruta>
   ```

   Lo más simple es clonarla en la ruta por defecto de tu sistema:
   - Windows: `C:\MiCarpeta\lineamientos-dev-claude-bacg`;
   - macOS y Linux: `~/lineamientos-dev-claude-bacg`.

   Si la clonás en otro lado, el plugin la busca en este orden:
   1. la variable de entorno `BACG_LINEAMIENTOS_DIR`;
   2. `~/.claude/bacg-dev.json` con `{"lineamientosDir": "<ruta>"}`;
   3. la ruta por defecto de arriba.

4. Instalar los plugins requeridos:

   ```
   /plugin marketplace add obra/superpowers-marketplace
   /plugin install superpowers@superpowers-marketplace
   /plugin install frontend-design@claude-plugins-official
   /plugin install security-guidance@claude-plugins-official
   /plugin install claude-security@claude-plugins-official
   /plugin install pr-review-toolkit@claude-plugins-official
   /plugin install feature-dev@claude-plugins-official
   /plugin install typescript-lsp@claude-plugins-official
   /plugin install claude-md-management@claude-plugins-official
   ```

   Si falta alguno, el hook `SessionStart` lo avisa al arrancar la sesión en un repo registrado y te da el comando para instalarlo.

Requisitos: Node 22 o más. El plugin no tiene dependencias npm: `js-yaml` va vendorizado.

## Convive con el plugin de origen

Este plugin es independiente de `como-trabajo` (`nkick25/lineamientos-dev`) y puede estar instalado en la misma PC sin cruzarse: cada uno tiene su propio nombre, comandos, marcador de repo, carpeta de configuración, variable de entorno y archivo de configuración.

| | BACG | Origen |
|---|---|---|
| Plugin y marketplace | `lineamientos-dev-claude-bacg@lineamientos-dev-claude-bacg` | `como-trabajo@lineamientos-dev` |
| Comandos | `/bacg-rq`, `/bacg-estado` | `/rq`, `/estado` |
| Skills | `lineamientos-dev-claude-bacg:<skill>` | `como-trabajo:<skill>` |
| Marcador del repo | `.bacg-lineamientos` | `.lineamientos` |
| Configuración en el repo | `.bacg-dev/` | `.como-trabajo/` |
| Copia de lineamientos | `BACG_LINEAMIENTOS_DIR`, `~/.claude/bacg-dev.json`, `~/lineamientos-dev-claude-bacg` | `LINEAMIENTOS_DIR`, `~/.claude/como-trabajo.json`, `~/lineamientos-dev` |

Un repo se activa con uno solo de los marcadores: no pongas los dos en el mismo repo.

## Dar de alta un proyecto

1. Copiar `proyectos/_plantilla/` a `proyectos/<id>/` y completar `proyecto.yml` (con `cuenta_github` y `repos`: así el plugin reconoce los repos por su remoto, sin archivos en ellos), `resumen.md`, `reglas.md` y `backlog.md`.
2. Sumarlo a `proyectos/registro.yml`.
3. Crear su entorno en la nube con `scripts/setup-entorno.sh` (ver [docs/ENTORNOS.md](docs/ENTORNOS.md)).

Opcional: `.bacg-lineamientos` en un repo (`proyecto: <id>`) manda sobre el remoto.

## Flujo diario

1. Abrís Claude Code en el repo: el arranque inyecta los lineamientos, el RQ activo y la ruta del CLI `rq.mjs`.
2. Pedís el cambio (o `/bacg-rq <código>`): el agente lo clasifica y abre o retoma el RQ con la skill `ciclo-rq`.
3. Diseño (y plan, si no es bounded): aprobás con tus palabras en la sesión y el agente las registra.
4. Desarrollo con TDD: cada commit registra la suite en verde sobre lo que está en stage.
5. Verificación: tests y revisión registrados destraban push y merge; DEV/Preview antes de PROD.
6. PROD: tu OK en la sesión y los pasos de `circuito_prod` en orden; al cierre, `rq.mjs cerrar --resumen` deja changelog, log y backlog. `/bacg-estado` muestra dónde está el RQ.

## Tests

```
npm test
```

Corre `node --test` sobre `tests/**/*.test.mjs`, sin `npm install`. La prueba de humo dentro de Claude Code está en `tests/humo/RESULTADO.md`.

## Límites conocidos

Las compuertas frenan olvidos y apuros del agente, no a alguien que las esquiva a propósito. Lo que no detectan (aliases de git, pushes desde scripts, SQL indirecto, edición manual de `estado.yml`, etc.) está en [plugin/general/seguridad.md](plugin/general/seguridad.md#límites-conocidos-de-las-compuertas).
