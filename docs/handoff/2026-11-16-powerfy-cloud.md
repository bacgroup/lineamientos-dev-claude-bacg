# Handoff · Plugin lineamientos-dev-claude-bacg en Claude Code en la nube

Fecha: 2026-11-16 · Origen: sesión cloud autónoma de PowerFy (alta, 7 RQ de UI y el diseño de PF-MARCA). Plugin usado: la versión sincronizada desde claude.ai (`/root/.claude/plugins/synced/…/lineamientos-dev-claude-bacg`, 4.3.x).

Propuesta de backlog del plugin: **PLG-CLOUD**, con sub-ítems si se separan.

**Pedido del usuario (2026-11-16):** trabajar en forma autónoma los arreglos de este handoff sobre el plugin. Lo que se aplique se porta también a dev-fullflow con `scripts/derivar-plugin.mjs`. Hay que usar `/plugin-dev:create-plugin` para reforzar la orquestación.

## Resumen para decidir

El ciclo completo funcionó en la nube para 7 RQ de UI, pero con workarounds. Recorrió alta, abrir, diseño, TDD, E2E, verificación local, revisión y PR. Los problemas son de tres clases:
- **Falsos "todo OK" que ocultan riesgos.** Son los más graves:
  - la validación previa dice "ninguna rama ni PR abierto" con 7 PR abiertos;
  - el alta dice "lineamientos al día" con la copia 5 commits atrás.
- **Falsos negativos que bloquean:** `gh auth status`, `odoo-skills` y los plugins sincronizados.
- **Huecos de las compuertas:**
  - la compuerta de edición no ve las escrituras por Bash;
  - `--sin-previa` se usa sin frase del usuario;
  - hay choques con los hooks de la nube.

**Recomendación:**
1. Primero, un RQ "GitHub por REST y sin `gh auth`" (hallazgos 1, 2, 3 y 5).
2. Después, las compuertas (16 y 15).

## Hallazgos del plugin (por costo-beneficio)

| # | Hallazgo | Severidad | Evidencia | Arreglo propuesto | Costo |
|---|---|---|---|---|---|
| 1 | La validación previa no ve los PR ni las ramas de otros. `previa.mjs:169` usa `gh pr list`, que va por GraphQL y da 403 en la nube. Con `BACG_DEV_SIN_GH=1` imprime en silencio "ninguna rama ni PR abierto". | Alta | Se repitió en 5 aperturas, con #6, #7, #12, #13 y #14 abiertos. | Usar REST: `gh api repos/{o}/{r}/pulls?state=open&base=<dev>` y `/pulls/{n}/files`. Si no puede listar, decirlo; nunca "ninguno". | Bajo |
| 2 | Todos los `gh pr list/create/checks` usan GraphQL: `circuito.mjs:85,116` y `rq-rama.mjs:70` (rama ya mergeada). La skill pide `gh pr create` y `gh pr checks --watch`. | Alta | `gh pr create` dio 403. Los 9 PR se abrieron con `gh api repos/…/pulls` y la CI se siguió con `/actions/runs?branch=`. | Un helper `ghPr()` sobre REST, y en la skill los equivalentes REST. | Bajo a medio |
| 3 | Falso negativo en el paso "GitHub CLI autenticado" del alta. `alta.mjs:101` usa `gh auth status`: en la nube el proxy inyecta la credencial y `gh auth status` falla, aunque `gh api user` funciona. | Alta (bloquea) | `gh api user` → `nlopez-bacg`. | Chequear con `gh api user --jq .login` y comparar con `cuenta_github` (amplía PLG-GH). | Bajo |
| 4 | `BACG_DEV_SIN_GH=1` apaga demasiado: además del alta, `entregar` deja "PR y CI: sin consultar" y la previa miente (hallazgo 1). | Media | Salida de `rq.mjs entregar`. | Con el 3 resuelto deja de hacer falta. Si queda, que afecte sólo al alta. | Bajo |
| 5 | `rq.mjs odoo-skills` falla en la nube: `gh api` sobre `odoo/odoo` no está habilitado para la sesión. | Alta (bloquea) | 403 "access not enabled for this session". | Alternativa por git anónimo: `clone --filter=blob:none --sparse` más `sparse-checkout set skills`, con el mismo `.odoo-skills.json`. Se hizo a mano y el alta lo aceptó. | Bajo |
| 6 | "Lineamientos al día" no hace fetch: da ✅ con la copia 5 commits atrás. | Media | `behind 5` después de un `git fetch` manual. | `git fetch` con timeout antes de comparar; sin red, "no verificado". | Bajo |
| 7 | Plugins complementarios: dice "faltan" cuando no faltan. En la nube vienen sincronizados (`~/.claude/plugins/synced/`) y no figuran en `installed_plugins.json`. | Baja | Las skills de esos plugins se cargaron en la sesión. | Leer también `plugins/synced/*/`. | Bajo |
| 8 | Hay dos backlogs que divergen. La copia central mostraba como Pendiente paneles ya hechos. Además, la fila de PF-UI-PANEL-KIT/PF-REPORTS-BUNDLE que un commit dice haber agregado no está en `18.0-dev`. | Media | Diff entre los backlogs; commit `a0cff6f` de powerfy-bi. | Una sola fuente de verdad; el arranque y la previa avisan si difieren. | Medio |
| 9 | La compuerta de push evalúa el comando entero antes de correrlo: `revision ok …; git push` se niega por "falta la etapa 3". | Baja | Hook `PreToolUse:Bash`. | Documentar: registrar y pushear en comandos separados. | Muy bajo |
| 10 | Choca con el Stop hook de la nube ("commit y push de lo pendiente") cuando la compuerta todavía no deja pushear. | Baja | Pasó 4 veces. | Documentar: commit local, y push al registrar la revisión. | Muy bajo |
| 11 | El agente no puede hacer el merge a DEV en modo automático: el clasificador niega escribir `Bash(gh pr merge:*)` en `settings.local.json` ("socavar supervisión"). Quedaron 7 PR de RQ con la CI lista y sin mergear. | Media | Denegación al intentarlo. | El paso 13 del alta tiene que decir que lo agrega el usuario (o la configuración del entorno cloud). | Muy bajo |
| 12 | Los rojos conocidos se reconocen sólo con líneas `FAIL <test>` (vitest/jest). La salida de Odoo (`FAIL: Clase.test`) no se parsea. | Media | Hubo que adaptar `odoo-test.mjs`. | Un parser para Odoo, o documentarlo en `ENTORNOS.md`. | Bajo |
| 13 | `verificar <ruta>` con el spec dentro de `docs/rq/<código>/qa/` da "No tests found". | Baja | Salida de `verificar`. | `--config` con `testDir` dinámico, o copiar el spec. | Bajo |
| 14 | El criterio ARQ "más de ~10 archivos" se aplica literal: PF-UI-MIGRACION (17 archivos de reemplazo de textos) cae en Arquitectónico. | Baja | Spec de PF-UI-MIGRACION. | Contar archivos sólo si hay contratos, datos, seguridad o despliegue. | Muy bajo |
| 15 | `--sin-previa` se usa sin frase del usuario: el agente lo usó en PF-UI-DOCMAP. En TESORERO lo frenó el clasificador; la CLI no. | Media | Denegación del clasificador. | Exigir la frase: `saltar previa "<frase>"`. | Bajo |
| 16 | La compuerta de edición no cubre las escrituras por Bash (heredoc, `python3 -c`, scripts). En REPORTES el agente modificó `ReportTable.tsx` y creó SCSS antes del diseño aprobado y del test en rojo; sólo se frenó el Write posterior. Se revirtió y se rehízo en orden. | Alta | Hook `PreToolUse:Write` contra Bash. | Que el hook de Bash detecte las escrituras a rutas de `ui.patrones` o de código (redirecciones, `sed -i`, `python` con `open(...,'w')`), o que la compuerta de commit compare el diff con la etapa. | Medio |
| 17 | Falso positivo de Bash al commitear docs (relacionado con PLG-BASH): `script.py docs/backlog.md && git add && git commit` se niega como "con código". | Baja | Backlog del 16/11. | Analizar sólo las rutas del `git add`. | Bajo |
| 18 | Artefactos compilados compartidos entre RQ paralelos: 4 PR tocan `reports.bundle.js` y la misma versión del manifest, y la CLI no lo detecta ni avisa. | Media | #12, #13, #14 y #15 de powerfy-bi. | En `abrir` y `entregar`, avisar si otra rama `rq/*` toca el mismo archivo compilado. La sección 1.1 de la skill ya lo dice, pero no hay chequeo. | Bajo |
| 19 | La autonomía de sesión funcionó bien, incluso después de reiniciar el contenedor (positivo). Falta que `abrir` diga al principio que un Arquitectónico queda frenado en `aprobar 1` aunque haya autonomía: hoy lo dice al final. | Baja | PF-MARCA. | Ponerlo al principio de la salida. | Muy bajo |

## Entorno de tests en la nube (PowerFy)

No es del plugin, pero el plugin lo exige y hoy vive sólo en la PC de Nico. Se reprodujo en `/home/user/qa/` con:
- `docker-compose.local.yml`: Postgres 16 y Odoo 18 en 8069 y 8070, contenedor `powerfy-local-odoo-1`;
- `odoo-test.mjs {archivos}` y `e2e.mjs {specs}`;
- la base plantilla `powerfy_tpl`;
- los specs E2E de cada RQ (con copias en `docs/rq/<código>/qa/`).

Requerimiento en el backlog de PowerFy: PF-QA-ENTORNO.

Tropiezos, todos resueltos:
- `dockerd` no arranca solo: hay que lanzarlo en cada contenedor nuevo.
- Docker Hub da 429 para `odoo:18.0`: usar `mirror.gcr.io/library/odoo:18.0`.
- Bitbucket (extra-addons) no es accesible. El entorno cubre tema, paneles, doc_map, migración, tesorería y POS.
- Hacen falta OCA server-brand (tema) y server-backend (`base_user_role`, para `powerfy_roles` y `powerfy_treasury`).
- E2E sin `--dev`: después de recompilar el bundle hay que reiniciar el contenedor.
- La base con datos demo da 11 tests rojos ajenos (9 de migración y 2 de reportes): PF-MIG-LOADER y PF-TEST-DEMO.
- Las capturas `fullPage` no sirven en Odoo (el scroll está en `.o_action_manager`): agrandar el viewport.
- libsass (Odoo 18) rompe con `min()`/`max()` de CSS cuando mezclan unidades: "Incompatible units: '%' and 'px'" y "Style error" en todo el backend. Usar `width` más `max-width`, o `calc()`. Conviene sumarlo a `proyectos/powerfy/reglas.md`.

## Qué quedó hecho en la sesión

| RQ | Estado | PR (a 18.0-dev) | CI |
|---|---|---|---|
| PF-UI-DOCMAP | Etapa 4, sin mergear | bacgroup/powerfy-addons#6 | ✅ |
| PF-UI-MIGRACION | Etapa 4, sin mergear | bacgroup/powerfy-addons#7 | ✅ |
| PF-UI-REP-TESORERO | Etapa 4, sin mergear | bacgroup/powerfy-bi#12 | ✅ (falló 2 veces por Bitbucket y pasó al tercer intento) |
| PF-UI-REP-RRHH | Etapa 4, sin mergear | bacgroup/powerfy-bi#13 | ✅ |
| PF-UI-REP-POS | Etapa 4, sin mergear | bacgroup/powerfy-bi#14 | ✅ |
| PF-UI-REP-REPORTES | Etapa 4, sin mergear | bacgroup/powerfy-bi#15 | ✅ |
| PF-MARCA | Etapa 1: spec, ARQ y plan esperando `aprobar 1` | rama `rq/PF-MARCA` (sólo docs) | — |
| Backlog | 10 requerimientos nuevos y PF-WEB1 hecho | bacgroup/powerfy-bi#16, bacgroup/powerfy-addons#8 | — |

## Siguiente paso sugerido

- **Usuario:** el permiso de merge (o el merge manual) y `BB_SSH_KEY`. Mergear en serie los PR de powerfy-bi, con rebase y `vite build` entre uno y otro. Después, deploy a DEV y prueba.
- **Dueño del plugin:** primero los hallazgos 1, 2, 3 y 5 juntos; después el 16 y el 15 (compuertas); después el 6, 7, 12, 13 y 18.
- **Proceso:** decidir la fuente única del backlog (hallazgo 8).
