---
description: Abre o retoma un RQ o BUG (ciclo-rq) y muestra su estado
argument-hint: <código> [descripción]
---

Invocá la skill `lineamientos-dev-claude-bacg:ciclo-rq` con la herramienta Skill y seguila para el pedido: `$ARGUMENTS`.

Para la CLI, usá la ruta exacta y entre comillas de la línea `CLI del RQ: node "…"` que inyectó `SessionStart`. Abajo aparece como `…/rq.mjs`. Sólo si esa línea falta, usá `${CLAUDE_PLUGIN_ROOT}/scripts/rq.mjs`.

1. Mirá el arranque que inyectó `SessionStart` (si no está, `node "…/rq.mjs" arranque`): si es una reanudación, decile al usuario en dos o tres líneas dónde quedó el RQ activo y seguí desde ahí.
2. Si `$ARGUMENTS` trae un código, buscalo en `docs/rq/` y con Grep en `docs/backlog.md`. Si no trae código, decidí si es RQ o BUG y buscá en el backlog como indica la skill.
3. Abrí o retomá el RQ desde la raíz del repo del proyecto:
   `node "…/rq.mjs" abrir <código> --tipo rq|bug --clasificacion exploracion|acotado|arquitectonico --tarea "<texto>"`
   Si el RQ ya existe, el comando lo retoma con su etapa. Leé su `spec.md` (encuadre).
4. Si la clasificación quedó pendiente, proponésela al usuario con su motivo y lo que implica, y registrá su respuesta literal con `node "…/rq.mjs" clasificacion confirmar "<su frase>"` (o `clasificacion cambiar <clasificación> "<su frase>"`).
5. Mostrá el estado con `node "…/rq.mjs" estado` y decí en una línea cuál es el próximo paso según la etapa.
