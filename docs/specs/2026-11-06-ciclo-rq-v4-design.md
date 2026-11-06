# Ciclo RQ v4: arranque, diseño y plan unificados, Odoo condicional y circuito autómata

- Fecha: 2026-11-06
- Estado: diseño aprobado en conversación; spec pendiente de revisión
- Base: plugin 3.2.0 (`main` a24c3a7). Rama de trabajo: `plg-ciclo-ui`
- Absorbe el handoff ciclo-rq/UI del 2026-11-05 (M1–M7; borrado, queda en el commit 07f4640), con el M3 reemplazado por la etapa 1 de esta spec
- Versión objetivo: 4.0.0 (cambia la numeración de etapas y el contrato de `aprobar`)

## 1. Objetivo

El ciclo de hoy trata distinto a RQ y BUG, salta el diseño en spike y bounded, decide la ejecución con una regla fija, supone Odoo por defecto y se traba en cada aprobación humana. La v4:

1. Arranca cada sesión sabiendo si es un **inicio** o una **reanudación** y lo dice.
2. Normaliza RQ y BUG: los dos pasan por `brainstorming`; diseño y plan son una sola etapa.
3. Deja al usuario elegir cómo se ejecuta el plan.
4. Sirve para cualquier proyecto: Odoo es una condición, no el supuesto.
5. Agrega un **circuito autómata**, igual para todo tipo de RQ, que no espera a una persona salvo en dos paradas duras, y que nunca llega a PROD.

Éxito: un RQ acotado en un proyecto sin Odoo no ve nada de Odoo; un RQ en PowerFy sigue con sus compuertas; un autómata desatendido lleva un RQ del backlog a PR + DEV sin intervención y deja registrado por qué decidió cada cosa.

## 2. Lo que pidió el usuario y lo que se supuso

Pedido (literal en la conversación):
- Etapa 0: inicio o reinicio; en inicio validar proyecto, repos locales y externos, resumen de lo último por backlog y changelog; en reinicio, "dónde nos quedamos". Clasificación mandatoria RQ/BUG; subclasificación trabajada con el usuario, con nombres menos técnicos.
- Diseño y plan en una sola etapa; `brainstorming` siempre; lo que cambia en arquitectónico es ADR y afines. `/prototype` opcional.
- En la ejecución, preguntar `executing-plans` o `subagent-driven-development`.
- Skills de Odoo condicionales al proyecto: el plugin no es sólo de PowerFy.
- Circuito nuevo para DEV autómata, indistinto del tipo, con decisiones no humanas.

Respuestas del usuario a las preguntas de diseño:
- El autómata es **desatendido** (nube/CI) o **local que decide solo**, según dónde corra.
- Paradas duras del autómata: **tests que no se arreglan** y **migraciones destructivas**.
- En desatendido, el RQ sale **del lanzamiento o, si vino vacío, del backlog**.
- Nombres: **Exploración / Acotado / Arquitectónico**.

Supuestos aprobados con el recorrido v4 (mensaje del 2026-11-06):
- Etapas 0–6 con conversión automática de RQ viejos.
- Exploración sin plan; Acotado con diseño corto y tareas en `spec.md`; Arquitectónico con ADR y `plan.md`.
- BUG: `systematic-debugging` primero, después el mismo `brainstorming`.
- Autómata: subagentes con 3 o más tareas independientes; decisiones en `decisiones.md`; nunca `saltar`.
- Activación `$RQ autonomo`, modo por entorno, marca "apto autómata" en el backlog.
- Odoo se activa sólo si se declara o se detecta.

## 3. Etapas v4

| # | Etapa | Reemplaza (3.x) | Se cumple con |
|---|---|---|---|
| 0 | Arranque y clasificación | 0 Encuadre | RQ abierto, fila en backlog, encuadre en `spec.md`, clasificación confirmada |
| 1 | Diseño y plan | 1 Diseño + 2 Plan | diseño (y causa en BUG) en `spec.md`; tareas en `spec.md` o `plan.md`; aprobación |
| 2 | Desarrollo | 3 | commits por tarea con tests verdes |
| 3 | Verificación | 4 | E2E live, verificación local si toca UI, una revisión |
| 4 | DEV / Preview | 5 | sola en Exploración y Acotado; aprobación en Arquitectónico |
| 5 | PROD y entrega | 6 | aprobación y circuito completo |
| 6 | Cierre | 7 | `$RQ cerrar` |

`etapaDerivada` pasa a: `spec.md` con diseño → 1 sólo si el diseño está aprobado; `tests` → 2; tests y revisión ok → 3; E2E ok → 4; aprobación 5 o circuito → 5; registrada 6 → 6.

## 4. Etapa 0: arranque y clasificación

### 4.1 `$RQ arranque` (nuevo; también lo llama el hook SessionStart)

Detecta el modo:
- **Reanudación** si `docs/rq/ACTIVO` apunta a un RQ con etapa < 6. Si no hay ACTIVO pero hay otros RQ abiertos, es inicio y los lista.
- **Inicio** en otro caso.

Salida en **inicio**:
1. Proyecto y repo detectados (lo que hoy hace la validación previa de 3.2.0) y si el proyecto usa Odoo.
2. Repos del proyecto: el local (rama, adelante/atrás del upstream, cambios sin commitear) y los externos de `proyecto.yml` (`repos[]`): si están clonados, su rama y su estado; si no, que faltan.
3. Lo último trabajado: las 5 filas del backlog con cambio más reciente (estado y código) y las 3 últimas entradas del changelog.

Salida en **reanudación**: lo mismo, comprimido a una línea por repo, y en detalle:
- RQ activo, tipo, subclasificación, etapa.
- Lo que falta para la siguiente etapa (`faltaParaEtapa`).
- Rama del RQ y último commit; cambios sin commitear.
- Última decisión registrada (`decisiones.md`) si la hay.

No escribe nada. Es idempotente.

### 4.2 Clasificación (incluye M2)

- `$RQ abrir` exige tipo (`rq|bug`) y propone subclasificación (`exploracion|acotado|arquitectonico`). Imprime qué implica cada una (tabla de la sección 5). Deja `clasificacion_pendiente: true`.
- Modo humano: el agente le propone la clasificación al usuario con su motivo; el usuario la confirma o la cambia. `$RQ clasificacion confirmar "<frase>"` o `$RQ clasificacion cambiar <c> "<frase>"`. La frase es literal del usuario (compuerta de frases).
- Hasta confirmar, la compuerta de edición niega todo archivo que no sea de `docs/rq/<código>/`.
- Modo autómata: la clasificación se confirma sola (sección 9.4).
- Internamente los valores siguen siendo `spike|bounded|arquitectonico` en `estado.yml` para no romper RQ abiertos; la CLI acepta y muestra los nombres nuevos. Tabla de equivalencias en `lib/clasificacion.mjs`.

### 4.3 Rama del RQ (M7)

Si la rama actual está en `ramas_solo_pr` o `ramas_prod`, `abrir` pasa a `rq/<código>` (`lib/ramas.mjs`, ya escrito): la toma si existe; si no, la crea desde el upstream cuando HEAD sólo está atrás, o desde HEAD si tiene commits propios. La compuerta de commit niega commits en ramas protegidas salvo `saltar rama`. `entregar` reporta "rama equivocada".

## 5. Etapa 1: diseño y plan

`superpowers:brainstorming` se invoca siempre, en RQ y en BUG. Sus tres caminos (spike, bounded, architectural) se alinean con la subclasificación; el agente no reclasifica dentro de brainstorming (la clasificación ya está confirmada en la etapa 0; si aparece complejidad oculta, sube la clasificación con `clasificacion cambiar`).

| | Exploración | Acotado | Arquitectónico |
|---|---|---|---|
| BUG antes | `systematic-debugging`, `## Causa` en `spec.md` | igual | igual |
| Diseño | pregunta y sonda (2–3 frases) en `spec.md` | diseño corto en `spec.md` | spec completa en `spec.md` |
| ARQ | no | no | `decision-arq` + ADR |
| Plan | no | `## Tareas` en `spec.md` | `writing-plans` → `plan.md` |
| `/prototype` | no | ofrecido si toca UI | ofrecido si toca UI |
| Aprobación | `$RQ aprobar 1` | `$RQ aprobar 1` | `$RQ aprobar 1` (diseño y plan) |

- Skills de BACG por etapa (sección 2.0 de ciclo-rq) siguen igual, filtradas por condición del proyecto (sección 8).
- La compuerta de commit exige: `brainstorming` registrado; en BUG, además `systematic-debugging` y `## Causa`; en Arquitectónico, `writing-plans` y `plan.md`.
- **Exploración termina al final de la sonda** (etapa 2 reducida): el resultado es una recomendación; su código no se commitea a la rama del RQ salvo bajo `docs/rq/<código>/sonda/`. Construirlo es un RQ nuevo.

## 6. Etapa 2: desarrollo

- Humano: antes del primer commit de código el agente pregunta la ejecución. `$RQ ejecucion inline|subagentes "<frase>"` (frase literal). Exploración no pregunta: en línea.
- Autómata: regla de la sección 9.4.
- `test-driven-development` siempre; en BUG, primero el test que reproduce.
- Con subagentes, sin reviewer por tarea: la revisión es una sola, en la etapa 3 (regla actual).
- Refuerzo de UI y skills de Odoo al editar (M6, ya escrito en `compuerta-edicion.mjs`).
- `$RQ commit`:
  - M4: archivos trackeados bajo `.gitignore` se agregan con `git add -u -- <ruta>`; no trackeados e ignorados → error explícito.
  - M5: `registrar-tests` deja `estado.yml`, `ACTIVO` y `backlog.md` en stage; el árbol testeado los excluye (`lib/arbol.mjs`, ya escrito).
  - Niega en rama protegida (M7).

## 7. Etapas 3 a 6

- **3 Verificación:** `$RQ verificar` (E2E live). Si el RQ toca UI (marca en `spec.md` o archivos de UI en el diff), M1: `$RQ verificar --local "<qué se recorrió>" <capturas...>`, capturas en `docs/rq/<código>/qa/`, al menos una; escape `saltar verificacion-local`. Una revisión (`$RQ revision ok|bloqueante`), con `odoo-review`/`odoo-security` sólo en Odoo y `claude-security` en rutas sensibles.
- **4 DEV / Preview:** sola en Exploración y Acotado; `$RQ aprobar 4` en Arquitectónico.
- **5 PROD y entrega:** `verification-before-completion`, `$RQ aprobar 5`, circuito de la sección 6 de ciclo-rq. `entregar` y `estado` muestran "Verificación local: sin registrar" y "rama equivocada" cuando aplica.
- **6 Cierre:** `$RQ cerrar` (sin cambios).

## 8. Odoo condicional y generalidad

- `usaOdoo(proyecto, raiz)`:
  1. `odoo_skills: false` → no.
  2. `datos.motor` declarado → `=== 'odoo'`.
  3. Sin declarar → **detección**: algún `__manifest__.py` a profundidad ≤ 3 en algún repo del proyecto (cacheado por sesión). Hoy el default es `odoo`; pasa a ser la detección.
- Sin Odoo: ninguna compuerta, mensaje, sección del arranque ni fila de la skill nombra Odoo. Las tablas de ciclo-rq que hablan de Odoo quedan en una sección "Si el proyecto usa Odoo".
- Limpieza de supuestos de PowerFy en la skill y mensajes: puertos, `18.0-dev`, nombres de repos y la nota "PowerFy: 18.0" pasan a ejemplos marcados como tales o a `proyecto.yml`.
- `$RQ alta` sólo pide instalar las skills de Odoo si algún proyecto registrado las usa.

## 9. Circuito autómata

### 9.1 Activación

- `$RQ autonomo [<código>|"<texto>"]`.
- **Modo local**: requiere frase literal del usuario (`$RQ autonomo ... --frase "<frase>"`, compuerta de frases). Habilita el circuito sólo para ese RQ.
- **Modo desatendido**: lo habilita el entorno, no el agente: variable `BACG_AUTONOMO=desatendido` puesta por quien lanza la sesión (CI, tarea programada, sesión en la nube). La compuerta de Bash niega cualquier comando que la defina o la exporte. Sin la variable no hay modo desatendido.
- Sin código ni texto (sólo desatendido): toma el primer RQ del backlog con estado Pendiente y marca `autómata: apto`, en orden de prioridad. Sin candidatos: termina con "nada para hacer".
- Con texto: abre el RQ (`abrir`) y clasifica solo.
- `estado.autonomo = { modo: 'local'|'desatendido', desde, frase? }`.

### 9.2 Recorrido

Mismas etapas, mismas skills y compuertas que el humano, salvo que toda espera humana se resuelve por regla (9.4). Fin:
- **Local:** al terminar la etapa 3. Deja resumen y `decisiones.md` para revisar.
- **Desatendido:** al terminar la etapa 4: push de `rq/<código>`, PR contra la rama del proyecto, deploy a DEV si el proyecto lo declara. El PR lleva el resumen y enlaza `decisiones.md`.
- **Nunca** etapa 5: `aprobar 5` niega si `estado.autonomo` está presente.

### 9.3 Paradas duras

| Parada | Disparador | Qué hace |
|---|---|---|
| Tests que no se arreglan | `registrar-tests` en rojo 3 veces seguidas sobre el mismo RQ sin un verde en el medio | marca `estado.estacionado = { motivo, diagnostico, fecha }`, backlog → "Estacionado", commitea el diagnóstico en `docs/rq/<código>/`; en desatendido sigue con el próximo apto |
| Migración destructiva | el diff en stage tiene una migración (`migraciones` de `proyecto.yml`) con DROP/RENAME de tabla o columna, o borra datos | la compuerta de commit niega; el autómata deja la migración sin commitear, estaciona y avisa |
| Compuerta imposible | una compuerta exige algo que sólo da `saltar` | estaciona con el nombre de la compuerta; nunca usa `saltar` |

Un RQ estacionado sólo lo reanuda una persona (`$RQ reanudar "<frase>"`).

### 9.4 Reglas de decisión

| Decisión humana hoy | Regla del autómata |
|---|---|
| Confirmar clasificación | la que propone la CLI; ante duda entre dos, la más pesada |
| Aprobar diseño (1) | se aprueba si `spec.md` tiene las secciones exigidas por la clasificación y el criterio de aceptación tiene al menos un flujo E2E |
| Ejecución | subagentes si `## Tareas`/`plan.md` tiene 3 o más tareas sin dependencias entre sí; si no, en línea |
| `/prototype` | no |
| Verificación local (UI) | capturas del E2E en `docs/rq/<código>/qa/` como evidencia |
| Aprobar DEV (4, Arquitectónico) | desatendido: se aprueba; local: no llega |
| `saltar` cualquier compuerta | prohibido; parada dura |

Cada regla aplicada escribe una entrada en `docs/rq/<código>/decisiones.md`:
```
## <fecha> · etapa <n> · <decisión>
Regla: <id de la regla>
Elegido: <valor>
Motivo: <1–3 líneas con la evidencia>
```
y en `estado.yml` registra la aprobación con `por: 'autómata'` y `regla: <id>` en lugar de `frase`. Las compuertas aceptan `por: 'autómata'` sólo si `estado.autonomo` existe y la regla es válida para esa decisión.

### 9.5 Backlog

Columna (o etiqueta) `Autómata` con valores `apto` / vacío; estado nuevo `Estacionado`. `$RQ agents` y el tablero la muestran.

## 10. Compatibilidad

- `estado.yml` gana `version_ciclo: 4`. Al leer uno sin el campo: etapas registradas y aprobaciones ≥ 2 se corren una (−1); `plan.md` deja de definir etapa propia. No se reescribe el archivo hasta el próximo comando que escriba.
- `aprobar <n>` acepta la numeración nueva. Un `aprobar 6` sobre un RQ de versión 3 se traduce a 5 con aviso.
- `clasificacion_pendiente` ausente → no bloquea (RQ viejos).
- Valores de clasificación internos sin cambio.
- `AGENTS.md` (agentes externos) se regenera con la numeración nueva.

## 11. Cambios por archivo

Ya escritos en `plg-ciclo-ui` (sin commitear, sin tests): `lib/arbol.mjs` (M5), `lib/ramas.mjs` (M7), `lib/compuerta-bash.mjs` (M5, M7, frase de `clasificacion`), `lib/requisitos.mjs` (M1), `lib/compuerta-edicion.mjs` (M2, M6).

Por hacer:
- `lib/clasificacion.mjs` (nuevo): nombres, equivalencias, implicancias, regla "la más pesada".
- `lib/arranque.mjs` (nuevo): inicio/reanudación, resumen de repos, backlog y changelog.
- `lib/autonomo.mjs` (nuevo): modo, reglas 9.4, `decisiones.md`, paradas 9.3, selección del backlog.
- `lib/estado.mjs`: `etapaDerivada` v4, conversión v3→v4, aprobación `por: 'autómata'`.
- `lib/odoo-skills.mjs`: `usaOdoo` con detección.
- `lib/requisitos.mjs`: requisitos por etapa v4 (brainstorming siempre, tareas en spec en Acotado).
- `lib/compuerta-bash.mjs`: niega `BACG_AUTONOMO`; niega `aprobar 5` en autómata; migración destructiva.
- `rq.mjs`: subcomandos `arranque`, `clasificacion`, `ejecucion`, `autonomo`, `reanudar`; `verificar --local`; `abrir` (pendiente, implicancias, rama); `commit` (M4, M5, rama); `registrar-tests` (M5, contador de rojos); `entregar`/`estado` (líneas nuevas); `COMPUERTAS` + `verificacion-local`, `rama`.
- `hooks/`: SessionStart llama a `arranque`.
- `skills/ciclo-rq/SKILL.md`: reescrita para v4 (etapas, tabla de la sección 5, ejecución elegible, Odoo condicional, circuito autómata, nuevos subcomandos).
- `commands/`: `/bacg-rq` y `/bacg-estado` con el arranque.
- `CHANGELOG.md` y versión 4.0.0.

## 12. Tests

Archivo nuevo por módulo (`arranque`, `clasificacion`, `autonomo`, `ramas`, `arbol`) más casos en los existentes de compuertas y estado. Casos mínimos:
- Arranque: repo sin RQ → inicio; con ACTIVO abierto → reanudación con lo que falta.
- Clasificación pendiente bloquea edición de código y no la de `docs/rq/`.
- Conversión v3→v4 de un `estado.yml` en etapa 5 con `aprobar 6`.
- Proyecto sin `datos.motor` y sin `__manifest__.py` → nada de Odoo exigido.
- Commit con estado.yml en stage después de `registrar-tests` → pasa (M5).
- Commit en `18.0-dev` → negado; `abrir` en `18.0-dev` → `rq/<código>` (M7).
- `BACG_AUTONOMO=x` en un comando del agente → negado.
- Autómata: 3 rojos → estacionado; migración con DROP → negada; `aprobar 5` → negado; aprobación de diseño por regla deja entrada en `decisiones.md`.
- Corrida dirigida por archivo (la suite completa tarda ~53 min en esta PC; se corre una vez al final).

## 13. Fuera de alcance

- Lanzar el autómata desatendido (cron, CI, nube): esta spec define lo que hace al correr, no quién lo programa.
- Cambios a los agentes externos (Lovable) más allá de regenerar `AGENTS.md`.
- Paralelizar varios RQ en el mismo desatendido (uno a la vez).

## 14. Riesgos

- **Autoaprobación.** El circuito autómata es la única vía para aprobar sin frase; se acota con `estado.autonomo` creado por frase (local) o por entorno (desatendido), y la compuerta de Bash protege la variable. Se revisa con `claude-security` antes del merge.
- **Renumeración.** Docs, tablero, `AGENTS.md` y RQ abiertos mezclan numeraciones durante la transición; mitigado por la conversión al leer y el aviso en `aprobar`.
- **Detección de Odoo** en monorepos grandes: profundidad acotada y caché por sesión.
- **Tamaño.** Se implementa en dos planes: (1) ciclo humano v4 + handoff + Odoo condicional; (2) circuito autómata. Se puede publicar 4.0.0 con el plan 1 si el 2 se demora, dejando `autonomo` fuera.
