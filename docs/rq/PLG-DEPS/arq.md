# PLG-DEPS · ARQ

**Contexto.** El plugin necesita otros 8 plugins para que el ciclo funcione (Superpowers es su motor). Hoy sólo los avisa. Claude Code soporta `dependencies` en `plugin.json` (code.claude.com/docs/en/plugins/dependencies, leído el 18/11/2026): instala solas las dependencias al instalar o actualizar, exige permitir los marketplaces cruzados en el marketplace raíz y **desactiva el plugin si una dependencia falta**. Cargado desde claude.ai (synced) no instala nada: cuenta como cumplida si el plugin del mismo nombre está activado ahí.

**Opciones.**
| Opción | Pro | Contra |
|---|---|---|
| A. Los 8 en `dependencies` | Se instalan todos solos | Proyecto sin TS/UI carga plugins que no usa (PLG-REQ); si falla uno, se apaga el plugin con las compuertas de PROD |
| B. Núcleo en `dependencies` + stack por alta y compuerta (**elegida**) | Instalación sola de lo universal; lo de stack según el proyecto; mensaje claro en vez de plugin apagado | Dos mecanismos que mantener (una sola fuente de la lista en código) |
| C. Sólo alta + compuerta | Nunca apaga el plugin | Nada se instala solo |

**Decisión.** B, con la opción 3 de la organización en PLG-DEPS-ORG.

**Atributos de calidad.** Seguridad: sólo dos marketplaces permitidos, ambos ya en uso. Disponibilidad: el riesgo de "plugin apagado" se limita al núcleo, que se instala solo. DX: un comando por faltante.

**Riesgos.** Una versión rota en un marketplace ajeno llega sola (mitigación posible: rangos de versión cuando publiquen tags). La compuerta depende de leer `installed_plugins.json`: ante error, avisa y no bloquea.

**ADR.** No amerita uno nuevo: no cambia el stack ni una decisión vigente; queda registrado en este arq.md.
