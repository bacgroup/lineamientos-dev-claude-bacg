# Tokens: leer menos, acertar más

- **Grafo antes que grep.** Para símbolos, relaciones y arquitectura, `codebase-memory-mcp` (`search_graph`, `trace_path`, `get_code_snippet`, `get_architecture`). `grep` queda para literales y huecos de cobertura del grafo.
- **`context7` antes de contestar sobre una librería**, framework, SDK o CLI, aunque creas saber la respuesta: tu información puede estar vieja.
- **`typescript-lsp`** para navegar (definiciones, referencias, tipos) en lugar de abrir archivos para buscar.
- **Leé los archivos por partes.** Con `offset`/`limit` o buscando primero; no abras archivos enteros para mirar una función.
- **Backlog sin releer.** Buscá la fila del RQ con `grep`; no cargues el archivo completo.
- **Un RQ por conversación.** Cada turno relee toda la conversación: con tres RQ en una sesión se llegó a ~450 k tokens de caché por turno. Después de `rq.mjs cerrar` y su push, `/clear`; el siguiente RQ arranca de su encuadre, `estado.yml` y `rq.mjs entregar`. El trabajo paralelo de un mismo RQ va en subagentes.
- **`/clear` también a mitad de un RQ largo** cuando la conversación ya no sirve: lo que importa sobrevive en `docs/rq/<código>/` y `rq.mjs entregar` dice qué falta.
- **Skills: las de la tabla de `ciclo-rq`, obligatorias y completas, una vez por RQ (y otra vez después de compactar, las de UI).** Superpowers es el motor; las de diseño libre pesan unos 25 k tokens y son para la landing, para pantallas de gestión manda el canon del proyecto. **Piso de calidad que no se recorta por tokens:** leer entera la referencia, recargar el canon y el journey con mockup. En R-MOD-V2, ahorrar 20 k tokens de lectura costó 2 M de retrabajo. Lo mecánico (capturas, corridas de E2E, greps, informes) va a subagentes de un modelo más barato.
- **Tests relacionados y E2E con alcance.** `rq.mjs commit` corre sólo los tests relacionados cuando el comando trae `{archivos}`; `rq.mjs verificar` corre sólo los specs del RQ cuando `tests.e2e` trae `{specs}`, y la suite completa una vez antes de PROD (`--completo`).
- **Un comando por commit.** `rq.mjs commit "<msg>" <rutas>` reemplaza `git add` + `registrar-tests` + `git commit` y los reintentos por bloqueos. Las salidas de la CLI son de una línea si todo sale bien.
- **Plugins que no usa el proyecto, apagados** en `.claude/settings.json` del repo (`enabledPlugins`): cada plugin suma skills y herramientas al listado de cada turno.
- Pedí salidas acotadas: `--stat` antes que el diff completo, `head`/`tail` en logs, `SELECT` con columnas y `LIMIT`.
