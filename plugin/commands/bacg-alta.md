---
description: Alta de esta PC paso a paso (stepper de primer uso): deja todo configurado antes del primer RQ
---

Desde la carpeta donde vas a trabajar (idealmente, un repo del proyecto), corré:

`node "…/rq.mjs" alta`

En lugar de `…/rq.mjs`, poné la ruta exacta, entre comillas, de la línea `CLI del RQ: node "…"` que inyectó `SessionStart`. Si esa línea falta, usá `${CLAUDE_PLUGIN_ROOT}/scripts/rq.mjs`.

Mostrá la lista de pasos tal cual. Después guiá al usuario **de a un paso**, empezando por el "Próximo paso":

1. Explicá en una línea para qué sirve el paso y qué tiene que hacer.
2. Si el paso es un archivo de esta PC (por ejemplo `~/.claude/bacg-dev.json` para los tests), preguntale los datos que faltan (cómo corre sus tests, en qué carpeta tiene su entorno local) y, con su OK, escribilo vos **sumando** a lo que ya tenga el archivo, sin pisar otras claves.
3. Si el paso es un comando (instalar, clonar, `gh auth login`), dáselo para que lo corra él; no corras logins ni instalaciones por tu cuenta.
4. Volvé a correr `rq.mjs alta` y seguí con el próximo paso.

Terminá cuando la salida diga "Todo listo". Los pasos "(recomendado)" se pueden dejar para después: avisá qué se pierde si no se hacen. Este comando no abre RQ ni toca repos del producto.
