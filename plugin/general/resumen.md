# Cómo trabajamos (resumen general)

Esto se inyecta al arrancar cada sesión en un repo con `.lineamientos` o `.como-trabajo/`. El detalle está en `general/*.md` (dentro del plugin) y en la skill `como-trabajo-bacg:ciclo-rq`.

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
- El stack es el que declara `proyecto.yml` (el arranque lo resume): la referencia histórica es Supabase + Lovable, pero un proyecto puede usar otra base, otro backend o deploy por rama. No lo supongas.
- Nada se borra: lo que sale de la vista activa se archiva con `git mv`.
- Antes de buscar con grep, el grafo (`codebase-memory-mcp`); antes de contestar sobre una librería, `context7`.

## Dónde vive cada cosa (todo en el repo)

- `.como-trabajo/`: `proyecto.yml`, `reglas.md`, `resumen.md`, canon, `adr/`. Protegida: cambiarla pasa por la compuerta.
- `docs/backlog.md`: backlog (lo escribe la CLI).
- `docs/rq/<código>/`: `spec.md` (encuadre + diseño), `plan.md`, `arq.md`, `estado.yml`, `qa/`.
- `docs/log/changelog/AAAA-MM.md` y `docs/log/rq.jsonl`: changelog y log del proyecto.

## Las compuertas

Si una compuerta frena, seguí su mensaje: dice qué falta. `rq.mjs estado` y `rq.mjs desplegar` muestran dónde está el RQ. La única salida de emergencia es que el usuario diga con sus palabras que saltees una compuerta y por qué.
