# Cómo trabajamos (resumen general)

Esto se inyecta al arrancar cada sesión en un repo con `.bacg-lineamientos` o `.bacg-dev/`. El detalle está en `general/*.md` (dentro del plugin) y en la skill `lineamientos-dev-claude-bacg:ciclo-rq`.

**Principio:** el plugin pone el marco de entrada y de salida; Superpowers hace el trabajo del medio; nada se duplica. Un artefacto por fase, una pasada por artefacto. Al usuario se le pide lo mínimo.

## Dos tipos de ciclo

- **RQ** (funcionalidad nueva o cambio de comportamiento): encuadre → backlog → ARQ si amerita → `brainstorming` → `writing-plans` → desarrollo con TDD → E2E live + revisión → entrega → cierre.
- **BUG** (algo que anda mal respecto de lo acordado): encuadre → backlog → `systematic-debugging` (causa raíz) → test que reproduce el bug en rojo → arreglo → E2E live + revisión reforzada → entrega → cierre.
- Consultas, lecturas y cambios de docs o tests: sin ciclo.

## Lo único que aprueba el usuario

1. PROD (etapa 6). Si el pedido ya lo dice, ese pedido es el OK.
2. Cuando el cambio amerita ARQ (contratos, datos, seguridad, despliegue, integración nueva o cambio grande): el diseño y el plan, una vez cada uno.

Se registra con sus palabras literales; un "Dale" vale si fue la respuesta entera. Nunca inventes ni parafrasees una aprobación.

## Obligatorio en todo RQ y BUG

- **E2E live:** un flujo de Playwright que recorre el cambio en la app levantada; en un BUG, rojo antes y verde después.
- **UI:** si se tocan pantallas (también en un bounded), `diseno-frontend` con el canon del proyecto, `redesign-existing-projects` si la pantalla ya existe y la sección `## Diseño` del spec (estados, móvil, alineación con los vecinos).
- **Entrega completa por el agente:** migraciones (si el stack las tiene), commits, PR, CI en verde, publicación con OK de PROD y, con repos hijos, PR de sincronización con su SQL y su CI.
- **Cierre:** changelog del mes, línea en `docs/log/rq.jsonl`, backlog en Hecho, un solo commit de docs.

## Commits

- Docs y tests: libres, también `git add <rutas> && git commit` y el push.
- Código: uno por tarea del plan, con `node <CLI del RQ> commit "<tipo>: <qué>" <rutas>` (add, tests relacionados y commit en un paso). Nunca `git commit -a`.
- Push y merge con código piden la etapa 4 (tests + `revision ok`).

## Reglas de sesión

- Varios RQ pueden estar activos a la vez (`--rq <código>` elige). No abras una sesión por RQ: para repartir trabajo, subagentes.
- Un repo es PROD salvo `push_prod: false` explícito en `proyecto.yml`; con `ramas_prod`, sólo el push o merge a esas ramas.
- El stack es el que declara `proyecto.yml` (el arranque lo resume). La referencia de BACG es Odoo + n8n + AWS, con PROD por rama (`ramas_prod`) y conectores MCP de PROD en `mcp_prod`; otro stack se declara. No lo supongas.
- Un RQ que toca varios repos se abre con el mismo código en cada uno: aprobaciones y skills se comparten solas.
- Nada se borra: lo que sale de la vista activa se archiva con `git mv`.
- Antes de buscar con grep, el grafo (`codebase-memory-mcp`); antes de contestar sobre una librería, `context7`.

## Dónde vive cada cosa

- Repo central de lineamientos (`bacgroup/lineamientos-dev-claude-bacg`): `proyectos/<id>/` con `proyecto.yml`, `reglas.md`, `resumen.md` y `backlog.md` (lo escribe la CLI; copia en `docs/backlog.md` del repo). Las mejoras del plugin van a `proyectos/plugin/backlog.md`.
- Un repo que trae su propia configuración la tiene en `.bacg-dev/` (protegida: cambiarla pasa por la compuerta).
- `docs/rq/<código>/`: `spec.md` (encuadre + diseño), `plan.md`, `arq.md`, `estado.yml`, `qa/`.
- `docs/log/changelog/AAAA-MM.md` y `docs/log/rq.jsonl`: changelog y log del proyecto.

## Las compuertas

Si una compuerta frena, seguí su mensaje: dice qué falta. `rq.mjs estado` y `rq.mjs desplegar` muestran dónde está el RQ. La única salida de emergencia es que el usuario diga con sus palabras que saltees una compuerta y por qué.
