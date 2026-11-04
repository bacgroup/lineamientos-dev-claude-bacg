# lineamientos-bacg

Cómo trabajamos en BACG, hecho plugin de Claude Code. Repo central de lineamientos y backlog de todos los proyectos; cada proyecto tiene su entorno y siempre carga este plugin (ver [docs/ENTORNOS.md](docs/ENTORNOS.md)).

Este repo es dos cosas a la vez:

- **El marketplace `lineamientos-bacg`** con el plugin **`como-trabajo-bacg`** (carpeta `plugin/`): skills del ciclo de RQ y hooks que funcionan como compuertas. Sin RQ abierto y aprobado no se edita código de producto; sin tests en verde y revisión no hay push ni merge; sin el OK del usuario en la sesión no se toca PROD (push a repos que publican, SQL de escritura a Supabase de PROD, deploy de Lovable).
- **La copia de trabajo de los lineamientos** (`plugin/general/` viaja con el plugin; `proyectos/<id>/` o `.como-trabajo/` del repo), que los hooks leen en cada sesión para inyectar el contexto del proyecto.

## Instalación en otra cuenta

1. Acceso al repo privado: la cuenta tiene que poder leer `bacgroup/lineamientos-dev-claude-bacg` en GitHub, con `gh auth login` hecho en esa máquina.
2. En Claude Code:

   ```
   /plugin marketplace add bacgroup/lineamientos-dev-claude-bacg
   /plugin install como-trabajo-bacg@lineamientos-bacg
   ```

3. Clonar la copia de trabajo de los lineamientos:

   ```
   gh repo clone bacgroup/lineamientos-dev-claude-bacg <ruta>
   ```

   Lo más simple es clonarla en la ruta por defecto de tu sistema:
   - Windows: `C:\MiCarpeta\lineamientos-bacg`;
   - macOS y Linux: `~/lineamientos-bacg`.

   Si la clonás en otro lado, el plugin la busca en este orden:
   1. la variable de entorno `LINEAMIENTOS_DIR`;
   2. `~/.claude/como-trabajo-bacg.json` con `{"lineamientosDir": "<ruta>"}`;
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

## Dar de alta un proyecto

1. Copiar `proyectos/_plantilla/` a `proyectos/<id>/` y completar `proyecto.yml` (repos y cuáles publican a PROD, entornos y refs de Supabase de PROD, proyectos de Lovable, patrones de UI, circuito de PROD, comandos de tests), `resumen.md`, `reglas.md` y `backlog.md`.
2. Sumarlo a `proyectos/registro.yml`.
3. En la raíz de cada repo del proyecto, los archivos de `plantillas/repo-proyecto/`: `.claude/settings.json` (instala el plugin a quien abra el repo) y `.lineamientos` con una línea:

   ```
   proyecto: <id>
   ```

Un repo sin `.lineamientos` no tiene compuertas.

## Flujo diario

1. Abrís Claude Code en el repo: el arranque inyecta los lineamientos, el RQ activo y la ruta del CLI `rq.mjs`.
2. Pedís el cambio (o `/rq <código>`): el agente lo clasifica y abre o retoma el RQ con la skill `ciclo-rq`.
3. Diseño (y plan, si no es bounded): aprobás con tus palabras en la sesión y el agente las registra.
4. Desarrollo con TDD: cada commit registra la suite en verde sobre lo que está en stage.
5. Verificación: tests y revisión registrados destraban push y merge; DEV/Preview antes de PROD.
6. PROD: tu OK en la sesión y los pasos de `circuito_prod` en orden; al cierre, `rq.mjs cerrar --resumen` deja changelog, log y backlog. `/estado` muestra dónde está el RQ.

## Tests

```
npm test
```

Corre `node --test` sobre `tests/**/*.test.mjs`, sin `npm install`. La prueba de humo dentro de Claude Code está en `tests/humo/RESULTADO.md`.

## Límites conocidos

Las compuertas frenan olvidos y apuros del agente, no a alguien que las esquiva a propósito. Lo que no detectan (aliases de git, pushes desde scripts, SQL indirecto, edición manual de `estado.yml`, etc.) está en [plugin/general/seguridad.md](plugin/general/seguridad.md#límites-conocidos-de-las-compuertas).
