---
description: Muestra el estado del RQ activo y el próximo paso del ciclo
---

Invocá la skill `lineamientos-dev-claude-bacg:ciclo-rq` con la herramienta Skill. Después, desde la raíz del repo del proyecto, corré:

`node "…/rq.mjs" estado`

En lugar de `…/rq.mjs`, poné la ruta exacta, entre comillas, de la línea `CLI del RQ: node "…"` que inyectó `SessionStart`. Si esa línea falta, usá `${CLAUDE_PLUGIN_ROOT}/scripts/rq.mjs`.

Mostrá la salida tal cual. Después, en una o dos líneas: qué falta para cumplir la etapa en curso (de 0 Arranque y clasificación a 6 Cierre) y cuál es la próxima acción. Si no hay RQ activo, decilo, mostrá el resumen de `node "…/rq.mjs" arranque` (repos y lo último trabajado) y ofrecé abrir uno con `/bacg-rq <código>`. Este comando no cambia el estado.
