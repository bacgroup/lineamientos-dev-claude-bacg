# PLG-BKL2 · El backlog con grupos de filas duplica la fila del RQ
Tipo: BUG · Clasificación: Acotado · Repos: bacgroup/lineamientos-dev-claude-bacg (se porta a nkick25/dev-fullflow)

## Qué
Con un backlog cuyas filas están en grupos separados por líneas en blanco bajo un solo encabezado (como `docs/backlog.md` de este repo), `abrir` y `cerrar` no encuentran la fila del RQ si está en un grupo posterior y agregan una duplicada. Visto al cerrar PLG-BACKLOG: quedó una fila "Hecho" nueva y la original "En curso".

## Causa
Regresión de la 4.6.0 (PLG-BACKLOG, ronda 2 de revisión). Para no tomar una segunda tabla del archivo (notas, glosario) como filas del backlog, `parsearBacklog` y `abrirTabla.desde` (`plugin/scripts/lib/backlog.mjs`) cortan la tabla en la primera línea que no empieza con `|`. Una línea en blanco entre grupos de filas corta igual, así que los grupos siguientes dejan de ser backlog. Antes de la 4.6.0 se tomaban todas las líneas `|` del archivo.

## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]

## Criterio de aceptación → flujo E2E que lo prueba
- S-1: en un backlog con grupos de filas separados por líneas en blanco, `parsearBacklog` devuelve las filas de todos los grupos y `upsertEnArchivo` / `fusionarEnArchivo` actualizan la fila existente en lugar de duplicarla. → `tests/backlog-fuente.test.mjs`
- S-2: una segunda tabla con su propio encabezado y separador sigue sin tomarse como backlog. → `tests/backlog-fuente.test.mjs`
- S-3: `npm test` y E2E sin rojos.

## Diseño
La tabla del backlog va desde su encabezado hasta el final del archivo o hasta que empieza **otra tabla**: una fila `|` seguida de una línea separadora (`|---|`). Las líneas en blanco y el texto intermedio no cortan. Una sola función (`indicesDeFilas`) define ese límite y la usan `parsearBacklog` y `abrirTabla.desde`. Las filas nuevas se siguen insertando al final del primer grupo contiguo.

## Tareas
1. Test rojo: grupos separados por línea en blanco (parseo, upsert sin duplicar, fusión sin duplicar).
2. `indicesDeFilas` en `backlog.mjs`, usada por `parsearBacklog` y `abrirTabla.desde`.
3. Versión 4.6.1, CHANGELOG, port a dev-fullflow.
