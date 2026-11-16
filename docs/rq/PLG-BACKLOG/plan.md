# PLG-BACKLOG Plan de implementación

> **Ejecución:** `superpowers:executing-plans` en línea.

**Spec:** `docs/rq/PLG-BACKLOG/spec.md`

## Restricciones globales
- Los proyectos que no declaran nada siguen igual, salvo que la copia del repo ya no se pisa: se fusiona.
- Ningún test sale a la red.

## Foco de la revisión
1. Una fila con un estado más avanzado en el repo que en la copia central: tiene que ganar el repo.
2. Un archivo sin tabla o con texto antes de la tabla: hay que conservar ese texto.
3. Sin copia central o sin copia en el repo: no hay nada que fusionar ni avisar.

### Tarea 1: fusión y fuente en `lib/backlog.mjs`, con `anotarBacklog` sin pérdidas (S-1, S-2)
- [ ] Test: `tests/backlog-fuente.test.mjs`, rojo antes de implementar.
- [ ] Implementar `fuenteBacklog`, `rangoEstado`, `fusionarFilas`, `diferencias` y `escribirFilas`. `rutaBacklog` recibe el proyecto.
- [ ] Commit.

### Tarea 2: aviso en la previa y `backlog migrar` (S-3, S-4)
- [ ] Tests, implementación y commit.

### Tarea 3: documentación, versión 4.6.0, revisión, E2E y PR
