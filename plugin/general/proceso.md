# Proceso: ciclo de un RQ o BUG

Versión para personas. Las instrucciones paso a paso para el agente (comandos de la CLI, qué skill conviene en cada etapa) están en la skill `lineamientos-dev-claude-bacg:ciclo-rq`; acá va el porqué y lo que hace el usuario.

El principio: **el agente decide, deja anotado y sigue**. Al usuario se le pide lo mínimo: el OK de PROD siempre, y el del diseño y el plan sólo en los cambios arquitectónicos.

## Clasificación

Todo pedido se clasifica antes de tocar nada:

| Tipo | Qué es | ¿Abre ciclo? |
|---|---|---|
| RQ | Funcionalidad nueva o cambio de comportamiento | Sí |
| BUG | Algo que anda mal respecto de lo ya acordado | Sí (diagnóstico de causa raíz y test que lo reproduce, sin brainstorming ni plan) |
| Consulta | Preguntas, lecturas, análisis | No |
| Operativa | Ordenar docs, correr un reporte, SELECTs de lectura | No |

Documentación, tests e instrucciones de agentes (`.md`, `docs/`, `tests/`, `.lovable/`, `.agents/`) se editan, commitean y pushean sin ciclo.

Después se busca en el backlog del proyecto (`docs/backlog.md` del repo): una coincidencia se anuncia y se sigue; varias, se pregunta; ninguna, se propone el código siguiente. La fila la escribe la CLI al abrir y al cerrar.

Un RQ o BUG se clasifica además por tamaño de diseño:

- `spike` y `bounded`: cambio acotado. Autonomía hasta DEV por defecto: con un `spec.md` corto el agente avanza sin pedir OK.
- `arquitectonico`: toca contratos, datos, seguridad o despliegue. Diseño y plan los aprueba el usuario.

## Etapas

| # | Etapa | Qué queda como evidencia |
|---|---|---|
| 0 | Alta | RQ abierto y fila en el backlog |
| 1 | Diseño | `spec.md` (y OK del usuario si es arquitectónico) |
| 2 | Plan | Sólo arquitectónico: `plan.md` con matriz de tests y OK del usuario |
| 3 | Desarrollo LOCAL | Código y tests en local, commits chicos |
| 4 | Verificación local | Tests registrados (sin contar los rojos conocidos de `main`) y revisión sin bloqueantes |
| 5 | DEV / Preview | Despliegue al entorno dev y verificación automática |
| 6 | PROD | OK del usuario para PROD y los pasos del circuito que corresponden |
| 7 | Cierre | Relevo, backlog en Hecho, pendientes anotados |

## Aprobaciones

Aprueba el usuario, y sólo él:

1. PROD. Si el pedido ya dice qué hacer en PROD ("aplicalo en PROD", "pusheá a main"), ese pedido es el OK: no se vuelve a preguntar. Un "Dale" o "Avanza" sirve si fue la respuesta entera a la pregunta.
2. En cambios arquitectónicos, además, el diseño y el plan.

Una aprobación se registra con la frase literal del usuario; la compuerta lo verifica en el momento de registrarla. Después vale para todo el RQ: otra sesión o un subagente no la tienen que volver a pedir. La excepción es PROD: el OK se vuelve a buscar en los mensajes de la sesión que publica, para que un registro hecho por fuera de la compuerta no alcance. El agente nunca inventa ni completa una aprobación.

## Modo autónomo

En `spike` y `bounded` es el modo por defecto hasta DEV (etapa 5). En arquitectónico lo activa el usuario ("dejá corriendo R-12 hasta DEV"). **PROD nunca es autónomo.**

- Cada decisión queda en `docs/rq/<código>/decisiones.md`: qué se decidió, alternativas, motivo y si es reversible.
- Si una decisión necesita al usuario, el agente no frena: la anota, sigue con otra tarea independiente y la deja para revisión.
- Al terminar, el **parte** resume qué quedó hecho, qué se decidió, qué está bloqueado y qué espera OK.

## Tests que ya estaban rojos

Los tests que fallan en `main` por causas ajenas se declaran una vez en `tests.rojos_conocidos` del `proyecto.yml`. `registrar-tests` no los cuenta, así que no hace falta saltear compuertas por ellos en cada RQ. Arreglarlos es un FIX aparte.

## Despliegue

El circuito de PROD (`circuito_prod`) se adapta al cambio:

- Sin migraciones no hay pasos de SQL; sin cambios de estándares no hay `sync-lineamientos`.
- Cada paso depende sólo de lo que declara su `despues_de`: entre repos hijos no hay orden; en cada uno, el SQL antes del merge.
- `rq.mjs desplegar` arma el plan completo (con los bloques SQL del handoff de base si hay migraciones). Con el OK de PROD, el agente lo ejecuta de punta a punta.
- Lo hecho por fuera (un merge desde la web, una migración ya aplicada) se registra con su evidencia, y un push o un PR ya mergeado se detectan solos.
- Los pasos manuales (publicar en Lovable) quedan como pendientes del usuario y no bloquean el cierre.

## Saltos de emergencia

Si el usuario dice con sus palabras "salteá la compuerta X porque Y" (X: edición, commit, push o e2e), se registra con su frase y el motivo. El agente nunca lo propone por su cuenta. Ningún salto pasa por encima del OK de PROD.

## Retomar, sesiones y subagentes

No hay relevo. Al retomar, el arranque reinyecta el encuadre (cabecera de `docs/rq/<código>/spec.md`) y `rq.mjs entregar` dice qué falta (tests, E2E, revisión, PR, CI y pasos de PROD). El cierre deja el changelog y una línea en `docs/log/rq.jsonl`.

Un RQ por conversación: después de cerrar y pushear, `/clear`. Pueden estar activos varios RQ en el mismo repo (`--rq` elige el RQ en curso); para repartir tareas de un RQ están los subagentes, que ven las aprobaciones y las skills registradas en el RQ.

## Una pasada por artefacto

El encuadre, el spec y el plan se escriben una vez y se aprueban una vez (sólo cuando hay ARQ). No se arma un TO DO aparte con la checklist de cada skill: el plan es la lista. Spec y plan de Superpowers van a `docs/rq/<código>/`, nunca a `docs/superpowers/`.

Por qué: en las sesiones de octubre el mismo plan se revisaba cuatro o cinco veces (spec del plugin, TO DO, brainstorming, writing-plans y sus auto-revisiones) y cada pasada relee todo el contexto.
