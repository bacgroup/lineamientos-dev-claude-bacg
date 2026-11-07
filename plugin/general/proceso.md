# Proceso: ciclo de un RQ o BUG

Versión para personas. Las instrucciones paso a paso para el agente (comandos de la CLI, qué skill conviene en cada etapa) están en la skill `lineamientos-dev-claude-bacg:ciclo-rq`; acá va el porqué y lo que hace el usuario.

El principio: **el agente decide, deja anotado y sigue**. Al usuario se le pide lo mínimo: confirmar la clasificación, aprobar el diseño y plan, elegir cómo se ejecuta el plan y el OK de PROD (y el de DEV en los cambios arquitectónicos).

## Arranque

Cada sesión arranca sabiendo si es un **inicio** o una **reanudación**, y lo dice:

- Inicio: proyecto y repo detectados, si el proyecto usa Odoo, el estado de los repos (local y los del proyecto) y lo último trabajado (backlog y changelog).
- Reanudación: el RQ activo, su etapa, qué falta para la siguiente, su rama y su último commit.

## Clasificación

Todo pedido se clasifica antes de tocar nada:

| Tipo | Qué es | ¿Abre ciclo? |
|---|---|---|
| RQ | Funcionalidad nueva o cambio de comportamiento | Sí |
| BUG | Algo que anda mal respecto de lo ya acordado | Sí (primero el diagnóstico de causa raíz; después el mismo diseño que un RQ y el test que lo reproduce) |
| Consulta | Preguntas, lecturas, análisis | No |
| Operativa | Ordenar docs, correr un reporte, SELECTs de lectura | No |

Documentación, tests e instrucciones de agentes (`.md`, `docs/`, `tests/`, `.lovable/`, `.agents/`) se editan, commitean y pushean sin ciclo.

Después se busca en el backlog del proyecto (`docs/backlog.md` del repo): una coincidencia se anuncia y se sigue; varias, se pregunta; ninguna, se propone el código siguiente. La fila la escribe la CLI al abrir y al cerrar.

Un RQ o BUG se clasifica además por tamaño. El agente propone y el usuario confirma o cambia, con sus palabras; hasta entonces no se edita código:

| | Exploración | Acotado | Arquitectónico |
|---|---|---|---|
| Para qué | ver si algo se puede o conviene | cambio acotado | toca contratos, datos, seguridad, despliegue o es grande |
| Diseño | la pregunta y la sonda | diseño corto | spec completa, ARQ y ADR |
| Plan | no | tareas en el spec | `plan.md` |
| Resultado | una recomendación (construirlo es otro RQ) | el cambio en PROD | el cambio en PROD |
| DEV | — | sin OK | con OK del usuario |

## Etapas

| # | Etapa | Qué queda como evidencia |
|---|---|---|
| 0 | Arranque y clasificación | RQ abierto, fila en el backlog, encuadre y clasificación confirmada |
| 1 | Diseño y plan | `spec.md` (y `plan.md` en arquitectónico) con el OK del usuario |
| 2 | Desarrollo | Código y tests en local, un commit por tarea |
| 3 | Verificación | Tests registrados (sin contar los rojos conocidos de `main`), E2E, verificación local si toca pantallas y revisión sin bloqueantes |
| 4 | DEV / Preview | Despliegue al entorno dev |
| 5 | PROD y entrega | OK del usuario para PROD y los pasos del circuito que corresponden |
| 6 | Cierre | Backlog en Hecho, changelog, log y pendientes anotados |

Antes del primer commit de código el agente pregunta cómo ejecutar el plan: en línea, en la misma sesión, o con subagentes (uno por tarea, con una sola revisión al final). Exploración va siempre en línea.

Si el proyecto usa Odoo (lo declara en `proyecto.yml` o el repo tiene addons), se suman las skills oficiales de Odoo al editar y al revisar. Si no, el ciclo no nombra Odoo.

## Aprobaciones

Aprueba el usuario, y sólo él:

1. PROD. Si el pedido ya dice qué hacer en PROD ("aplicalo en PROD", "pusheá a main"), ese pedido es el OK: no se vuelve a preguntar. Un "Dale" o "Avanza" sirve si fue la respuesta entera a la pregunta.
2. El diseño y el plan, en toda clasificación (una vez, juntos).
3. En cambios arquitectónicos, además, el paso a DEV.

También son del usuario la confirmación de la clasificación y la elección de cómo se ejecuta el plan. Todo se registra con su frase literal; la compuerta lo verifica en el momento de registrarla. Después vale para todo el RQ: otra sesión o un subagente no la tienen que volver a pedir. La excepción es PROD: el OK se vuelve a buscar en los mensajes de la sesión que publica, para que un registro hecho por fuera de la compuerta no alcance. El agente nunca inventa ni completa una aprobación.

## Autonomía

En Exploración y Acotado el agente avanza solo desarrollo y DEV una vez aprobado el diseño. En arquitectónico lo habilita el usuario ("dejá corriendo R-12 hasta DEV"). **El diseño y PROD nunca son autónomos.** Si una decisión necesita al usuario, el agente la anota en el RQ, sigue con otra tarea independiente y la deja para revisión.

## Tests que ya estaban rojos

Los tests que fallan en `main` por causas ajenas se declaran una vez en `tests.rojos_conocidos` del `proyecto.yml`. `registrar-tests` no los cuenta, así que no hace falta saltear compuertas por ellos en cada RQ. Arreglarlos es un BUG aparte.

## Ramas

Cada RQ trabaja en su rama `rq/<código>`. Si el proyecto declara ramas que sólo reciben PR (la de DEV) o ramas de PROD, abrir el RQ pasa a su rama y la compuerta no deja commitear código en aquellas.

## Despliegue

El circuito de PROD (`circuito_prod`) se adapta al cambio:

- Sin migraciones no hay pasos de SQL; sin cambios de estándares no hay `sync-lineamientos`.
- Cada paso depende sólo de lo que declara su `despues_de`: entre repos hijos no hay orden; en cada uno, el SQL antes del merge.
- `rq.mjs desplegar` arma el plan completo (con los bloques SQL del handoff de base si hay migraciones). Con el OK de PROD, el agente lo ejecuta de punta a punta.
- Lo hecho por fuera (un merge desde la web, una migración ya aplicada) se registra con su evidencia, y un push o un PR ya mergeado se detectan solos.
- Los pasos manuales (publicar en Lovable) quedan como pendientes del usuario y no bloquean el cierre.

## Saltos de emergencia

Si el usuario dice con sus palabras "salteá la compuerta X porque Y" (X: edición, commit, push, e2e, skills, seguridad, ui, verificación local o rama), se registra con su frase y el motivo. El agente nunca lo propone por su cuenta. Ningún salto pasa por encima del OK de PROD.

## Retomar, sesiones y subagentes

No hay relevo. Al retomar, el arranque dice dónde quedó el RQ y reinyecta el encuadre (cabecera de `docs/rq/<código>/spec.md`); `rq.mjs entregar` dice qué falta (tests, E2E, revisión, PR, CI y pasos de PROD). El cierre deja el changelog y una línea en `docs/log/rq.jsonl`. Los RQ abiertos con la versión anterior del ciclo (etapas 0 a 7) se convierten solos a la numeración nueva.

Un RQ por conversación: después de cerrar y pushear, `/clear`. Pueden estar activos varios RQ en el mismo repo (`--rq` elige el RQ en curso); para repartir tareas de un RQ están los subagentes, que ven las aprobaciones y las skills registradas en el RQ.

## Una pasada por artefacto

El encuadre, el spec y el plan se escriben una vez y se aprueban una vez. No se arma un TO DO aparte con la checklist de cada skill: el plan es la lista. Spec y plan de Superpowers van a `docs/rq/<código>/`, nunca a `docs/superpowers/`.

Por qué: en las sesiones de octubre el mismo plan se revisaba cuatro o cinco veces (spec del plugin, TO DO, brainstorming, writing-plans y sus auto-revisiones) y cada pasada relee todo el contexto.
