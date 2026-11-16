# PLG-BACKLOG · Fuente única del backlog
Tipo: RQ · Clasificación: Arquitectónico · Repos: bacgroup/lineamientos-dev-claude-bacg (se porta a nkick25/dev-fullflow)

## Qué
Una sola fuente de verdad para el backlog de cada proyecto, sin pérdidas cuando hay dos copias. Es el hallazgo 8 del handoff de PowerFy en la nube (`docs/handoff/2026-11-16-powerfy-cloud.md`).

## Por qué
En los proyectos con la configuración en el repo central (como PowerFy), la fuente es `proyectos/<id>/backlog.md` de la copia local de lineamientos. `rq.mjs` copia ese archivo **entero** sobre `docs/backlog.md` del repo cada vez que abre o cierra un RQ. Si la copia local está atrasada, o alguien agregó o actualizó filas en el repo, se pierden. Eso pasó en PowerFy: paneles hechos que figuraban como Pendiente, y una fila agregada en `a0cff6f` que ya no está en `18.0-dev`.

## Alcance
**Dentro:**
- `backlog: repo` en `proyecto.yml`, que hace de `docs/backlog.md` del repo la única fuente.
- Escritura sin pérdidas cuando hay dos copias.
- Aviso de divergencia en la previa.
- `rq.mjs backlog migrar`.

**Fuera:**
- Cambiar la configuración de PowerFy. Lo hace el usuario en su sesión, con `backlog migrar`.

## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: amerita — cambia la fuente de verdad de un dato del proceso (el backlog).

## Criterio de aceptación → flujo E2E que lo prueba
- S-1: con `backlog: repo` (o con la configuración en el repo), `abrir` y `cerrar` escriben sólo `docs/backlog.md` del repo y no tocan la copia central. → `tests/backlog-fuente.test.mjs`
- S-2: con la fuente central, `abrir` y `cerrar` fusionan antes las dos copias, sin pisar nada:
  - la fusión es quirúrgica: sólo agrega las filas que faltan o sube la celda Estado; columnas extra, filas sin código, `\|` escapados y el texto antes y después de la tabla quedan igual;
  - por código, gana el estado más avanzado (Hecho, Descartado o Cerrado; después En curso, En revisión, En QA o un Hecho con "falta"; después el resto);
  - la fila del RQ que escribe la CLI manda en las dos copias (un RQ reabierto queda En curso);
  - lo fusionado se escribe en las dos copias.
  - Límite conocido: `docs/backlog.md` vive en cada rama; una copia atrasada en otra rama puede volver a Hecho un RQ reabierto. La salida es `backlog migrar`.

  → `tests/backlog-fuente.test.mjs`
- S-3: la validación previa avisa si las dos copias difieren y lista los códigos. → `tests/backlog-fuente.test.mjs`
- S-4: `backlog migrar` fusiona la copia central en `docs/backlog.md` del repo, marca la central como obsoleta y declara `backlog: repo` en el `proyecto.yml` central; la segunda vez responde "ya está migrado". → `tests/backlog-fuente.test.mjs`
- S-5: `npm test` y E2E sin rojos.

## Diseño

### Criterios centrales
- C-1: ninguna fila del backlog se pierde por una copia atrasada.
- C-2: una sola fuente declarada por proyecto. Mientras haya dos copias, se fusionan y se avisa.

### Enfoques
1. **Prohibir la copia central y forzar el repo para todos.** Rompe los proyectos actuales sin migrarlos. Descartado.
2. **Fuente declarada, fusión segura en la transición y migración explícita (elegido).** No rompe nada: el paso a la fuente única lo decide cada proyecto, y mientras tanto no se pierden filas.

### Piezas (`lib/backlog.mjs`)
- `fuenteBacklog(raiz, proyecto)` devuelve `repo` o `central`. Es `repo` si la configuración está en el repo o si `proyecto.backlog === 'repo'`.
- `rutaBacklog(dirLin, id, raiz, proyecto)` respeta esa fuente.
- `rangoEstado`, `diferencias(a, b)`, `parsearBacklog` (sólo la primera tabla del archivo), `fusionarEnArchivo(archivo, filas)` (quirúrgica), `upsertEnArchivo(archivo, codigo, campos)`, `columnasDe` y `crearConEncabezadoDe`.
- `anotarBacklog` (`rq.mjs`): con la fuente central, fusiona la copia del repo en la central, escribe la fila del RQ, fusiona la central en la copia del repo y escribe la fila del RQ también ahí.
- `previa`: si hay dos copias y difieren, lista los códigos y propone `backlog migrar`. Con `backlog: repo`, el backlog remoto sale del repo.
- `backlog migrar`:
  1. declara `backlog: repo` en el `proyecto.yml` central (si falta), así una migración a medias se completa corriéndolo de nuevo;
  2. si la central ya está marcada obsoleta, responde "ya está migrado" y termina;
  3. si el repo no tiene `docs/backlog.md`, lo crea con el encabezado de la central; avisa las columnas que la central tiene y el repo no;
  4. fusiona la central en `docs/backlog.md`;
  5. agrega al principio de la copia central `> OBSOLETO: la fuente es docs/backlog.md de <repo>`.

### Lo que queda al implementador
Los textos de los mensajes.
