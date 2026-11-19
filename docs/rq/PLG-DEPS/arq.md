# PLG-DEPS · ARQ

**Contexto.** El plugin necesita otros 8 plugins para que el ciclo funcione (Superpowers es su motor). Hoy sólo los avisa. Claude Code soporta `dependencies` en `plugin.json` (code.claude.com/docs/en/plugins/dependencies, leído el 18/11/2026): instala solas las dependencias al instalar o actualizar, exige permitir los marketplaces cruzados en el marketplace raíz y **desactiva el plugin si una dependencia falta**. Cargado desde claude.ai (synced) no instala nada: cuenta como cumplida si el plugin del mismo nombre está activado ahí.

**Opciones.**
| Opción | Pro | Contra |
|---|---|---|
| A. Los 8 en `dependencies` | Se instalan todos solos | Proyecto sin TS/UI carga plugins que no usa (PLG-REQ); si falla uno, se apaga el plugin con las compuertas de PROD |
| B. Núcleo en `dependencies` + stack por alta y compuerta | Instalación sola de lo universal; lo de stack según el proyecto; mensaje claro en vez de plugin apagado | Dos mecanismos que mantener (una sola fuente de la lista en código) |
| C. Sólo alta + compuerta (**elegida**) | Nunca apaga el plugin ni sus compuertas de PROD; el faltante se ve con su comando | Nada se instala solo: el alta da los comandos y el agente los corre con OK |

**Decisión.** C (usuario, 19/11): con B, una cuenta a la que le falte un núcleo pierde el plugin entero, incluidas las compuertas de PROD (la doc: "the install completes without the dependency and your plugin then fails to load"). La instalación sola queda para la organización (managed settings, PLG-DEPS-ORG).

**Atributos de calidad.** Seguridad: las compuertas de PROD nunca dependen de otro plugin. Disponibilidad: el plugin carga siempre. DX: un comando por faltante, que el agente corre con OK.

**Riesgos.** Una cuenta nueva tiene que pasar por el alta antes de editar (la compuerta lo frena con el comando). La compuerta depende de leer `installed_plugins.json`: ante error, avisa y no bloquea.

**ADR.** No amerita uno nuevo: no cambia el stack ni una decisión vigente; queda registrado en este arq.md.
