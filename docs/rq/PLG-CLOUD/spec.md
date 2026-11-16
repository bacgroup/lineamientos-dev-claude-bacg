# PLG-CLOUD · El plugin en Claude Code en la nube
Tipo: RQ · Clasificación: Arquitectónico · Repos: bacgroup/lineamientos-dev-claude-bacg (se porta a nkick25/dev-fullflow)

## Qué
Arreglar lo que falló o mintió en la sesión cloud autónoma de PowerFy del 16/11 (alta y 7 RQ de UI). El detalle está en `docs/handoff/2026-11-16-powerfy-cloud.md`.

## Por qué
En la nube, el plugin:
- dio "todo OK" falsos: "ningún PR abierto" con 7 abiertos, "lineamientos al día" con 5 commits de atraso;
- bloqueó por falsos negativos: `gh auth status`, `odoo-skills`, plugins sincronizados;
- dejó pasar escrituras de código por Bash antes del diseño aprobado.

Lo que mintió son los peores casos: ocultan riesgos en lugar de frenar.

## Alcance
**Dentro** (los números son los hallazgos del handoff):
1, 2, 3, 4, 5, 6, 7, 12, 13 (mensaje), 15, 16, 18 (aviso en `entregar`) y la documentación de 9, 10, 11, 14 y 19. El 17 se intentó reproducir y no se pudo: un script común que reescribe `docs/backlog.md`, seguido de `git add` + `git commit`, pasa en los tres armados probados. Queda en PLG-BASH con el caso exacto pendiente.

**Fuera:**
- 8, la fuente única del backlog: es una decisión de proceso. Va como propuesta.
- El entorno de tests de PowerFy (PF-QA-ENTORNO), que es del proyecto.

## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: amerita — cambia el contrato con GitHub (CLI y compuertas) y una compuerta de seguridad (escrituras por Bash); más de 10 archivos.

## Criterio de aceptación → flujo E2E que lo prueba
- S-1: la previa lista los PR abiertos contra DEV por REST (`gh api …/pulls` y `…/pulls/{n}/files`) y trae las ramas de origin aunque el clon sea superficial o tenga refspec sólo de `main`. Si no pudo listar los PR o las ramas, lo dice y no afirma "ninguna rama ni PR". → `tests/github-rest.test.mjs`
- S-2: `entregar` (PR y CI), el aviso de rama mergeada (`rq-rama`), el circuito (`circuito.mjs`) y las compuertas de PR (`promocion`, merge de docs) usan REST por un único helper (`lib/github.mjs`), sin `gh pr …`. → `tests/github-rest.test.mjs`
- S-3: el alta verifica GitHub con `gh api user`, no con `gh auth status`, y avisa si la cuenta no es la del proyecto. → `tests/alta-nube.test.mjs`
- S-4: `BACG_DEV_SIN_GH=1` dice qué no consultó ("PR no consultados") en lugar de dar "ninguno". → `tests/github-rest.test.mjs`
- S-5: `odoo-skills` usa la API y, si falla, un clon anónimo con sparse-checkout de `skills/`, con el mismo `.odoo-skills.json`. → `tests/odoo-skills.test.mjs`
- S-6: "Lineamientos al día" hace fetch (con timeout) antes de comparar. Sin red dice "no verificado". → `tests/alta-nube.test.mjs`
- S-7: los plugins complementarios cuentan también los sincronizados de claude.ai (`plugins/synced/*/<plugin>`). → `tests/alta-nube.test.mjs`
- S-8: con reglas 4.4, la compuerta de Bash aplica la compuerta de edición a las escrituras de código y de UI por redirección, `sed -i`, `tee`, `cp`, `mv` y `python -c` / `node -e` con `open(…,'w')` o `writeFileSync`. → `tests/escritura-bash.test.mjs`
- S-9: `abrir --sin-previa` y `--sin-alta` exigen `--frase "<frase del usuario>"` verificada. → `tests/sin-previa-frase.test.mjs`
- S-10: los rojos conocidos reconocen la salida de Odoo (`FAIL: test_x (modulo.tests.Clase.test_x)` y `ERROR: …`). → `tests/rojos-odoo.test.mjs`
- S-11: `entregar` avisa si otra rama `rq/*` toca el mismo artefacto compilado (`compilados` en `proyecto.yml`; por defecto `*.bundle.js`, `*.min.js` y `dist/**`). → `tests/github-rest.test.mjs`
- S-12: E2E del plugin (`npm run test:e2e`) y `npm test` sin rojos nuevos.

## Diseño

### Criterios centrales
- C-1: el plugin nunca afirma "nada" o "al día" sin haberlo verificado. Si no pudo, lo dice.
- C-2: lo que funciona en una PC funciona igual en la nube, sin variables para apagar controles.
- C-3: ninguna compuerta se esquiva cambiando de herramienta (Write contra Bash).

### Enfoques considerados
1. **Parches en cada llamada a `gh`.** Es rápido, pero deja 9 llamadas con criterios distintos y vuelve a romperse con la próxima. Descartado.
2. **Un helper REST único, `lib/github.mjs`, inyectable en los tests (elegido).**
   - Una sola manera de leer PR, archivos, checks, ramas y cuenta.
   - Cada función devuelve `{ datos }` o `{ error }`, y quien la llama decide el mensaje.
   - Los tests ya inyectan `gh`, y siguen igual.
3. **Que la nube tenga `gh auth` y GraphQL.** Depende del proveedor, no del plugin. Descartado.

### Piezas
- **`lib/github.mjs`:**
  - `repoGh(raiz)` → `owner/repo`, desde el remoto. Usa `remotoGh`.
  - `api(ruta, {env})`: `gh api` con timeout. Devuelve `{ datos } | { error }`.
  - `prsAbiertos(repo, {base, head})`.
  - `archivosPr(repo, n)`.
  - `prDeRama(repo, rama, {estado})`: incluye mergeados (`merged_at`).
  - `checksDe(repo, sha)`: check-runs más statuses.
  - `ramaPorDefecto(repo)`.
  - `cuentaActual()`.
  - Paginación: `per_page=100` y una página (lo que pasa de 100 se avisa).
- **Previa:**
  - `git fetch origin '+refs/heads/*:refs/remotes/origin/*'`, con `--depth=50` si el clon es superficial.
  - PR por REST.
  - La línea final distingue:
    - "ninguna rama ni PR" (verificado);
    - "ramas: ninguna; PR: no consultados (motivo)".
- **Alta:**
  - `gh api user --jq .login` reemplaza a `gh auth status`.
  - Fetch con timeout de 20 s antes de "al día".
  - Plugins: `installed_plugins.json` y `plugins/synced/*/`.
  - El paso del merge en modo automático dice que la regla la agrega el usuario o el entorno: el agente no puede (hallazgo 11).
- **`odoo-skills`:** `instalarSkillsOdoo` prueba la API. Si falla, usa `git clone --depth 1 --filter=blob:none --sparse --branch <rama>` y después `sparse-checkout set skills` (`git` es inyectable).
- **Compuerta de Bash** (`escriturasProhibidas` → `escrituras`):
  - Cada destino de escritura dentro de un repo de proyecto genera una op `edicion`, que se evalúa con `evaluarEdicion`, el mismo motor de la compuerta de Write.
  - Detecta también `python -c`, `python3 -c` y `node -e`, buscando `open('<ruta>', 'w'|'a')`, `.write_text(`, `writeFileSync('<ruta>'` y `appendFileSync`.
  - El hook de Bash le pasa `skills` y `skillsContexto` del transcript, como el de Write.
  - Sin reglas 4.4 sólo se mira lo de siempre (estado y transcript), para no cambiar a los RQ en curso.
- **PR por REST en la compuerta (revisión):** `gh api …/pulls` (POST) y `-X PUT …/pulls/<n>/merge` son `pr-create` y `merge-pr`. `merges`, `git/refs` y las mutaciones de merge por `graphql` van a la red de seguridad. Las consultas en hooks tienen un tope de 4 s.
- **`--sin-previa` / `--sin-alta`:** exigen `--frase` verificada contra la transcripción, sin consumir usos.
- **Rojos de Odoo:** `fallosDe` también reconoce `^(FAIL|ERROR): (\w+) \(([\w.]+)\)` como `<modulo.tests.Clase>.<test>`.
- **Compilados:** en `entregar`, con `proyecto.compilados`, para cada `origin/rq/*` distinta de la propia se mira si su diff contra la base toca alguno de los mismos archivos compilados. Si los toca, aviso.
- **Documentación** (`ciclo-rq`, `ENTORNOS.md`, `abrir`):
  - Registrar la revisión y pushear van en comandos aparte (9).
  - Con el Stop hook de la nube: commit local y push al registrar la revisión (10).
  - ARQ cuenta archivos sólo si hay contrato, datos, seguridad o despliegue (14).
  - `abrir` dice al principio que un Arquitectónico espera `aprobar 1`/`ok` (19).
  - `verificar` explica "No tests found" cuando el spec está en `docs/rq/<código>/qa/` (13).
  - Los equivalentes REST de `gh pr create`/`checks`/`merge` en la skill (2).

### Propuesta (no se construye): fuente única del backlog (hallazgo 8)
Con la configuración en el repo, `docs/backlog.md` de la rama de DEV es la única fuente. La copia central de lineamientos deja de tener backlog por proyecto, y el arranque avisa si encuentra uno viejo. Queda para decidir con el usuario.

### Lo que queda al implementador
Nombres internos, los mensajes exactos y los fixtures de los tests.
