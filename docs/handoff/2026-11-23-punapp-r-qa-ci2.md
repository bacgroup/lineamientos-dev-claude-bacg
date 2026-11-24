# Handoff para el plugin dev-fullflow: hallazgos de R-QA-CI2 (PunAPP)

Fecha: 2026-11-23 · Repo del plugin: `nkick25/dev-fullflow` (versión usada: 4.7.0, caché local)
Complementa el handoff de CRM_AHRAI `docs/handoff/2026-11-23-plugin-minutos-actions.md` (minutos de GitHub Actions). Acá van los ajustes a esa propuesta que salieron de aplicarla en PunAPP y los problemas del ciclo que aparecieron en el camino.

## Qué se hizo en PunAPP (R-QA-CI2)

- `ci.yml` pasó a `paths:` y `sync-to-clones.yml` a `paths-ignore:`: un push de sólo docs no corre ninguno de los dos. Del 1 al 23/11, 19 de las 23 corridas del CI por push a `main` no habrían corrido.
- Push con código (`4f223d766`): CI y sync en verde. `concurrency` ya estaba desde R-QA-CI1.
- Test que vigila el filtro: `src/lib/__tests__/sync-scope.test.ts` (bloque R-QA-CI2).

## 1. Ajustes a la propuesta de minutos (plantilla de CI y chequeo de arranque)

**1.1 El CI no puede ignorar `.dev-fullflow/**`.** La plantilla de CI del plugin (`scripts/ci/tests-unit.mjs` en PunAPP, la del revisor de R-QA-CI1) lee `tests.rojos_conocidos` de `.dev-fullflow/proyecto.yml`. Si el CI ignora esa carpeta, un push que saca un rojo conocido no corre y el rojo aparece en el próximo push de código, atribuido a otro cambio. La propuesta 3 del handoff de CRM (`paths-ignore: ['docs/**', '**/*.md']`) está bien para el CI; agregar `.dev-fullflow/**` no.

**1.2 Tests que leen docs.** En PunAPP, `src/test/security/bug-sec-rls1.test.ts` lee `docs/rq/BUG-SEC-RLS1/migracion.sql` y `docs/planes/SEDE_DB_BUG-SEC-RLS1.md`. El ciclo empuja a guardar SQL y handoffs en `docs/`, así que es un patrón esperable en cualquier proyecto. Con `paths-ignore` no hay forma de exceptuarlos (no admite `!`). Propuesta:
- En la plantilla, usar `paths:` con orden: `'**'`, las exclusiones `!docs/**`, `!**/*.md`, …, y al final las re-inclusiones de lo que lee la suite (gana el último patrón que coincide).
- Que el chequeo de arranque (propuesta 4 del otro handoff) además busque en los tests lecturas de rutas excluidas (`readFileSync`, `?raw`, `import.meta.glob`) y avise. Ver el test de PunAPP como referencia; su límite: no ve rutas armadas por partes (`join(raiz, 'docs', 'x.md')`).

**1.3 Workflows de sync o despliegue.** Además del CI, conviene revisar cualquier workflow con `on: push` del proyecto. En PunAPP el sync HQ→sedes corría en cada push de docs (2 jobs). La plantilla o el chequeo de arranque deberían cubrirlos, ignorando sólo lo que no está en el alcance de ese workflow.

## 2. Problemas del ciclo encontrados en este RQ

**2.1 Frases del usuario en lista numerada no se reconocen.** El usuario respondió en un mensaje:
```
1- Omití el E2E, el cambio no tiene pantalla.
2- Publicá R-QA-CI2 en main.
```
`saltar e2e "Omití el E2E, el cambio no tiene pantalla."` y `aprobar 5 "Publicá R-QA-CI2 en main."` se rechazaron ("no aparece en lo que escribió el usuario"). Pasaron recién con el prefijo `1- ` / `2- `. Propuesta: al partir el mensaje en oraciones, quitar marcadores de lista (`1-`, `1.`, `1)`, `-`, `*`, `•`) al principio de cada línea.

**2.2 El hook del push anota el paso en otro RQ activo.** El `git push origin HEAD:main` de R-QA-CI2 (desde un worktree, con `--rq` en todos los comandos previos) registró `push:pilates-flow-portal` también en `docs/rq/R-CLS-REACT1/estado.yml`, que figuraba en `ACTIVO` y no tenía nada que ver con ese push. Se revirtió a mano. Propuesta: el hook atribuye el push sólo al RQ en curso (el último elegido con `--rq`) o a los RQ cuyos commits están en el rango pusheado, nunca a todos los de `ACTIVO`.

**2.3 `$RQ commit` deja el stage armado cuando la compuerta lo frena.** El primer `commit` se negó por skills faltantes, pero los archivos quedaron en stage. Un `git checkout -- <archivo>` posterior restauró desde el índice (con el cambio) en lugar de HEAD. Propuesta: si la compuerta niega, deshacer el `git add` que hizo la CLI o avisarlo en el mensaje.

**2.4 Commit de sólo tests no corre el test que cambió.** `$RQ commit … src/lib/__tests__/sync-scope.test.ts` respondió "sólo docs y tests: sin correr tests". Un test modificado es justo lo que hay que correr. Propuesta: si el commit trae archivos de test, correr esos tests (`vitest related` o el archivo directo).

**2.5 La revisión vence con un commit que la CLI trata como "sólo tests".** Después de un commit de sólo tests, `revision ok` volvió a pedir las tres pasadas ("la revisión anterior es del …"). Las dos reglas no coinciden: o un commit de tests cuenta como código (y entonces debería correr tests, 2.4) o no vence la revisión. Propuesta: alinearlas; lo razonable es que vence y corre tests.

**2.6 `paso no-aplica` no acepta `merge-prs-sync:`.** El cambio no viaja a sedes (`.github/` y el test están fuera del sync) y no se abrió ningún PR de sync, pero `paso no-aplica merge-prs-sync:<sede>` responde que esos pasos no se pueden marcar así. El cierre igual quedó sin pendientes, así que no bloqueó, pero no hay forma de dejarlo explícito. Propuesta: permitir `no-aplica` en `merge-prs-sync:` cuando el diff del RQ no tiene archivos sincronizables (el plugin conoce `sync`), o calcularlo solo.

**2.7 `cerrar` deja la fila del backlog sin Prioridad ni Impacto.** `abrir --tarea` no las pide y `cerrar` avisa que quedaron vacías. Propuesta: `abrir` acepta `--prioridad` e `--impacto` (o los pregunta junto con la clasificación) y los guarda en `estado.yml`.

**2.8 Peso del ciclo para un cambio de configuración de CI.** Para un Acotado que sólo toca `.github/workflows/*.yml` la compuerta exigió `brainstorming`, `writing-plans`, `test-driven-development`, `executing-plans`, tres pasadas de revisión y, tras una corrección, dos pasadas más. El valor estuvo en la revisión (encontró 1.1 y 1.2); el resto fue ceremonia sobre un diseño ya aprobado. Propuesta a evaluar: para diffs que sólo tocan `.github/**` u otra configuración sin superficie de app, una variante con una sola pasada de revisión y sin `executing-plans`.

**2.9 Worktree cuando el checkout está ocupado.** La skill dice no usar worktrees salvo que `reglas.md` lo pida. En PunAPP el checkout de HQ estaba en `rq/R-CLS-REACT1` con 3 RQ activos y 42 archivos sin commitear: abrir otro RQ ahí lo mezclaba todo. Para un cambio sin superficie de app el worktree no afecta el E2E. Propuesta: que la skill contemple ese caso y que `abrir` lo sugiera cuando el árbol está sucio con trabajo de otro RQ. Detalle práctico en Windows: el `node_modules` del worktree se enlaza con `New-Item -ItemType Junction` (desde Git Bash, `cmd //c mklink /J` falla por las comillas).

## Cómo verificar

- 2.1: test de la CLI con un mensaje en lista numerada; `saltar` y `aprobar 5` aceptan la oración sin el marcador.
- 2.2: dos RQ en `ACTIVO`, push con commits de uno solo; el `estado.yml` del otro no cambia.
- 2.4 y 2.5: commit de sólo un test → corre ese test; la revisión se vuelve a pedir.
- 1.1 y 1.2: en un proyecto de prueba con la plantilla nueva, un push que sólo toca `.dev-fullflow/proyecto.yml` o un archivo de `docs/` leído por un test corre el CI; un push de sólo `docs/backlog.md` no.
