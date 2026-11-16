# Propuestas del 16/11/2026: fricciones de la sesión y circuito de testing para QA

Salen de trabajar PLG-BACKLOG y PLG-BKL2 en Claude Code en la nube. Están cargadas en `docs/backlog.md` como **Pendiente** (PLG-FRIC y PLG-QA). No hay nada implementado.

# PLG-FRIC · Tres fricciones

## Por qué
1. El usuario escribió "Saltea lo necesita y tenes mi OK explicito para cerrar lo pendiente": dos decisiones en una oración. La frase vale para un solo registro y un tramo suelto no cuenta, así que hubo que pedirle un segundo mensaje.
2. En un clon de la nube `remote.origin.fetch` lista sólo algunas ramas. Un `git push` de una rama nueva no deja `origin/<rama>` en el clon, y el control de fin de turno del entorno avisa "rama sin subir" aunque esté subida (tres falsas alarmas).
3. La regresión PLG-BKL2 se escapó porque ningún test pasaba un backlog real, con grupos de filas, por `abrir` y `cerrar`.

## Criterio de aceptación propuesto
- S-1: en una oración con dos o más decisiones unidas por " y " (o " e "), cada cláusula de 3 palabras o más vale como frase literal para un registro, salvo que la oración niegue, frene, condicione o posponga algo (entonces sólo vale entera). → `tests/frases-repetidas.test.mjs`
- S-2: después de un `git push` sin falla en un repo del plugin, si `origin/<rama actual>` no existe en el clon y `remote.origin.fetch` no la cubre, el plugin agrega el refspec de esa rama y la trae, para que la rama remota quede a la vista. Si falla, no bloquea. → `tests/rama-remota.test.mjs`
- S-3: un test pasa por `abrir` y `cerrar` un backlog con la forma real (texto, encabezado, grupos de filas separados por líneas en blanco), en fuente repo y en fuente central, y no queda ninguna fila duplicada. → `tests/backlog-fuente.test.mjs`
- S-4: `npm test` y E2E sin rojos.

## Diseño propuesto
- **S-1** (`lib/ok.mjs`, `lib/transcript.mjs`): `clausulasDeDecision(oracion)` parte la oración en " y " / " e ". Devuelve las cláusulas sólo si hay dos o más, todas de 3 palabras o más, y la oración entera no tiene negación, freno, condición ni postergación (mismas listas que los OK flexibles, sin "para", que en "OK para cerrar" es preposición; "pará" con tilde sí frena). `vecesQueLoDijo` cuenta también esas cláusulas, así vale para la CLI y para la compuerta de Bash. Sigue valiendo una vez por registro cada vez que el usuario la escribió.
- **S-2** (`lib/rama-remota.mjs`, `lib/hooks/post-tool.mjs`): `seguirRamaRemota(raiz)` se llama tras un push sin falla. No hace nada si la rama remota ya se ve o si hay un refspec comodín (`refs/heads/*`). Si no, `git config --add remote.origin.fetch` de la rama y `git fetch origin <rama>` con tope de tiempo. Los errores se ignoran.
- **S-3**: fixture con la forma de `docs/backlog.md` de este repo.

Nota sobre el punto 2: el aviso "rama sin subir" lo emite el control de fin de turno del entorno de la nube (`~/.claude/stop-hook-git-check.sh`), no el plugin. El plugin sólo puede evitar la causa.

# PLG-QA · Circuito de testing funcional para el equipo de QA

## Necesidad
Que el equipo de QA tenga un camino asistido para generar casos de prueba y ejecutarlos con las mismas herramientas de automatización que ya trae el plugin (Playwright por `rq.mjs verificar`, capturas en `qa/`, traza del spec).

## Qué hay hoy
- `rq.mjs verificar` corre el comando `tests.e2e` de `proyecto.yml` (specs del RQ o `--completo`) y guarda sólo el último resultado en `estado.e2e`.
- `verificar --local` registra la verificación manual con capturas en `docs/rq/<código>/qa/`.
- `trazar` enlaza cada criterio de aceptación del spec con su test en `traza.yml`.
- `tests/**`, `e2e/**`, `*.spec.*` y `*.test.*` se editan, commitean y suben sin RQ.

## Qué le falta a QA
1. `verificar`, `registrar-tests`, `trazar` y `devolucion` exigen un RQ activo: no se puede correr ni registrar una regresión, un smoke o una campaña por fuera.
2. No hay generador de casos ni de esqueletos de spec a partir de los criterios de aceptación.
3. No hay catálogo de casos, formato de caso manual ni informe de QA.
4. Se guarda sólo el último resultado (pasó o no): sin historial ni detalle por caso; el rojo previo de un BUG no se verifica y el resultado no vence con commits nuevos.
5. No existe el rol QA ni un "probado por".
6. Una sola `e2e_url`: sin elegir entre DEV, preview u otro ambiente.
7. No hay skill de autoría de E2E (convenciones, fixtures, roles, datos de prueba).

## Piezas propuestas
| # | Pieza | Qué le da a QA | Costo/beneficio |
|---|---|---|---|
| 1 | `rq.mjs qa casos <RQ>` | Casos desde los criterios de aceptación (pasos, datos, esperado) en `qa/casos.md` y esqueleto del spec de Playwright | Medio / alto |
| 2 | `rq.mjs qa correr` sin RQ de desarrollo | Campaña (un RQ, regresión o smoke) contra el ambiente elegido, con el motor de `verificar` | Medio / alto |
| 3 | Informe por corrida | Resultado por caso, capturas, quién probó y sobre qué versión, con historial | Medio / alto |
| 4 | Skill `qa-funcional` | Guía: leer el spec, generar casos, completar los manuales, correr y reportar | Bajo / alto |
| 5 | Devolución desde QA | Un caso fallido abre una devolución o un BUG con la evidencia | Bajo / medio |
| 6 | Visto bueno de QA antes de PROD, opcional por proyecto | Compuerta activable | Medio / medio |

Orden sugerido: 1, 2 y 4 primero; 3, 5 y 6 después.

## Preguntas abiertas
- ¿QA usa Claude Code, o recibe los casos y carga resultados por otro lado?
- ¿Los casos manuales, sin automatizar, tienen que quedar registrados igual?
- ¿El visto bueno de QA frena PROD o sólo informa?
