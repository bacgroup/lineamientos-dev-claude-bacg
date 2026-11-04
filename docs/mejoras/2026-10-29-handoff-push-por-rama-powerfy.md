# Handoff · como-trabajo-bacg: push a DEV por rama (Powerfy) y tests en Windows

Fecha: 2026-10-29 · Versión instalada: **0.7.0** · Origen: alta de Powerfy (`proyectos/powerfy/`, esquema viejo)

> **Estado (2026-10-30, plugin 0.8.0):** P1, P2, P3, P4 y P5.1 implementados de forma genérica: el plugin no toma la arquitectura de Powerfy, sino que suma opciones de stack en `proyecto.yml` (`datos`, `ramas_prod`, `entornos.prod.bases`, `agentes_externos`, `tests.shell`), con Supabase + Lovable como valor por defecto. Ver CHANGELOG 0.8.0.
> **Actualización (2026-11-04):** aplicados en `proyectos/powerfy/` el stack (`datos` odoo, `ramas_prod: ["18.0"]`) y el canon P6 en `reglas.md`.
> Pendiente: **P5.2** (RQ multi-repo con estado compartido), en otra versión. **P6** (canon de UI) es de `proyectos/powerfy/reglas.md` y se documenta desde la cuenta de BACG. Para aprovechar P1 en Powerfy, su `proyecto.yml` necesita `ramas_prod: ["18.0"]` y `datos: { motor: odoo, migraciones: ["**/migrations/**"] }`.

## Contexto

Powerfy (Odoo 18, org `bacgroup`) no publica a PROD con cada push. Todo entra por la rama `18.0-dev`, y un push ahí despliega a **DEV** (`deploy-dev.yml`). PROD es el fast-forward `18.0-dev → 18.0` (`deploy.yml`). Los 5 repos tienen `push_prod: true` porque todos terminan en PROD, pero hoy cada push a `18.0-dev` se trata como PROD.

## P1 · PROD por rama destino, no por repo (brecha que bloquea Powerfy)

`compuerta-bash.mjs › destino()` devuelve `prod: entrada.push_prod !== false`, sin mirar la rama. En Powerfy, el push diario a `18.0-dev` va a pedir la etapa 6 (OK de PROD) y el circuito completo.

**Cambio:** campo opcional por repo o por proyecto:

```yaml
ramas_prod: ["18.0"]        # sólo un push o merge que actualiza estas ramas es PROD
```

- Sin `ramas_prod`, todo sigue igual (falla cerrada).
- Con `ramas_prod`, `destino()` resuelve la rama destino: con refspecs (`git push origin 18.0-dev:18.0`, `HEAD:18.0`), la parte después de `:` o, si no hay `:`, el refspec mismo. Sin refspecs, el upstream de la rama actual (`git rev-parse --abbrev-ref @{u}`). `prod = ramas_prod.includes(rama)`. `--all`, `--mirror` y `--branches` (`op.amplio`) siguen siendo PROD. Si no se puede resolver, también.
- El push a una rama que no es PROD sigue exigiendo la etapa 4 y el E2E (ya pasa antes de `if (!dest.prod)`).
- Merge de PR (`merge-pr`): usar la `baseRefName` del PR (`gh pr view --json baseRefName`).
- El paso del circuito sigue siendo `push:<repo>`; sólo se registra cuando el push fue a una rama de PROD.

**Tests:** en `tests/compuerta-bash*.test.mjs`, push sin refspec con upstream `18.0-dev` → no PROD; `HEAD:18.0` → PROD; `18.0-dev:18.0` → PROD; `--all` → PROD; repo sin `ramas_prod` → PROD como hoy.

## P2 · `entornos.dev.tipo: rama` documentado (menor)

La plantilla nombra `rama` como tipo, pero ningún código lee `entornos.dev.rama` ni `url`. Alcanza con documentarlo en `_plantilla/proyecto.yml`: es informativo, y la compuerta usa `ramas_prod` de P1.

## P3 · Comandos de tests en Windows: `shell: true` es `cmd.exe` (riesgo)

`rq.mjs` corre `tests.unit` y `tests.e2e` con `spawnSync(cmd, { shell: true })`. En Windows eso es `cmd.exe`, no Git Bash. Los comandos de Powerfy son `node <script>.mjs …` (no dependen del shell), pero conviene:
- Documentar en la plantilla que los comandos tienen que ser portables (`node`/`npx`, sin `&&` de bash ni `$VAR`).
- Si un proyecto necesita bash, admitir `tests.shell: bash`.

Nota para quien escriba wrappers con Docker desde Git Bash: `--test-tags /modulo` se convierte en `C:/Program Files/Git/modulo` si no se usa `MSYS_NO_PATHCONV=1`. Pasó al probarlo.

## P4 · El refuerzo de UI no se exige en RQ bounded (brecha de proceso)

*Agregado el 2026-10-30, a partir de PF-UI-GUARDADO.*

**Qué pasó.** Un RQ bounded cambiaba la botonera Guardar/Descartar de todos los formularios. El agente cargó sólo `frontend-design` y diseñó sin seguir el orden de `diseno-frontend`: no leyó el canon, no auditó la pantalla existente (`redesign-existing-projects`) y no revisó móvil. El resultado tuvo tres fallas básicas:
- contradijo el pedido explícito ("color acorde al sentido de la transacción"): Guardar en rojo de marca;
- botones de 28 px junto a los de 33/37 px de la misma fila;
- en móvil, el paginador saltaba a una segunda línea.

El usuario lo marcó con capturas.

**Causa.** `ciclo-rq` §4 pide `diseno-frontend` "según el caso" y la compuerta sólo exige lo que declara `ui.skills` / `ui.reglas`. En Powerfy `ui.skills: []`, así que nada lo frenó. El agente leyó "bounded" como permiso para un diseño exprés.

**Cambios:**
1. Si un RQ (de cualquier clasificación) toca archivos de `ui.patrones`, la compuerta de edición exige `como-trabajo-bacg:diseno-frontend` aunque `ui.skills` esté vacío. Que `ui.skills` sume skills, no que las reemplace.
2. `diseno-frontend` exige `redesign-existing-projects` cuando el archivo editado ya existe en el repo (pantalla existente). Hoy es "sólo si la pantalla ya existe", pero nada lo verifica.
3. Antes de la aprobación de diseño (etapa 1), el `spec.md` debe tener la sección de UI del entregable de `diseno-frontend` (canon, dirección, auditoría, estados). La CLI puede verificarlo como hace con `## Causa` en los BUG (`## Diseño` o `### Estados`).
4. En el entregable de `diseno-frontend`, sumar dos cosas:
   - la revisión con captura en móvil (≤ 400 px);
   - la alineación con los componentes vecinos de la misma barra: alto, radio, tamaño de letra y línea base.

**Tests:**
- RQ bounded que edita un `.scss` en `ui.patrones` sin `diseno-frontend` → bloqueado.
- Con `diseno-frontend` pero sin `redesign-existing-projects` sobre un archivo existente → bloqueado.
- Archivo nuevo → sólo `diseno-frontend`.

## P5 · El hook no registra skills cuando la sesión corre fuera del repo (bug)

*Agregado el 2026-10-30.*

`lib/hooks/post-tool.mjs › registrarSkill()` busca el repo con el `cwd` de la sesión. En Powerfy la sesión corre en `C:/MiCarpeta/Odoo DEVs/PowerFy` y los repos estaban en `C:/powerfy/<repo>` (desde el 2026-10-30 están en `C:/MiCarpeta/Odoo DEVs/PowerFy/<repo>`: la sesión corre en la carpeta padre de los repos, que tampoco es un repo, así que el bug sigue). Ninguna skill se registró en `estado.yml`, y el primer `$RQ commit` falló pidiendo `writing-plans`, que sí se había cargado.

Se resolvió a mano invocando el hook con `cwd` apuntando al repo. Lo mismo pasa con un RQ que abarca dos repos (PF-UI en `powerfy-addons` y `powerfy-bi`): cada repo lleva su propio estado y hubo que abrir el RQ, registrar las aprobaciones y las skills dos veces.

**Cambios:**
1. Si el `cwd` no es un repo con `.lineamientos` o `.como-trabajo`, registrar la skill en los RQ activos de los repos que la sesión tocó (los `cwd` de los Bash y las rutas de Edit/Write del transcript) o en los repos del proyecto declarados en `proyecto.yml`.
2. Para RQ multi-repo: un repo "principal" con el `estado.yml`, y los demás que lo referencien (`--rq PF-UI@powerfy-addons`), o que `abrir` en un repo secundario copie aprobaciones y skills del principal.

**Tests:**
- Sesión con `cwd` fuera de los repos invoca una skill → queda en el `estado.yml` del RQ activo del repo tocado.
- RQ abierto en dos repos → la skill queda en los dos.

## P6 · Canon de UI de Powerfy (para `proyectos/powerfy/reglas.md`)

*Agregado el 2026-10-30; lo pidió el usuario en PF-UI-GUARDADO.*

- Color semántico de acciones: **verde = guardar o confirmar un cambio, rojo = descartar o borrar**. El coral de marca no se usa para acciones destructivas, ni el rojo para confirmar.
- Todo cambio de UI se revisa con captura en móvil y alineado con los componentes vecinos de la misma barra.
- Íconos de interfaz sólo Lucide (PF-UI). Los íconos solos sin texto quedan para móvil o para acciones universales (engranaje, paginador), siempre con `aria-label` y tooltip.
- Íconos de apps: siempre la imagen que trae cada módulo (`web_icon`), sin modificar el archivo, dentro de un marco con el estilo Powerfy. Es un fundamento de Odoo: cada módulo trae su imagen.
- Toda pantalla se revisa en escritorio y en móvil: Odoo usa plantillas distintas para cada uno (por ejemplo, el menú de apps).

## Fuera de alcance

- Mover Powerfy a `.como-trabajo/` de `powerfy-docker`: se hace cuando `nlopez-bacg` tenga escritura en bacgroup.
- La infraestructura de tests de Powerfy (wrapper de Odoo + Playwright): es del proyecto, no del plugin.
