# PLG-DEPS Implementation Plan

> **Ejecución elegida:** en línea (`superpowers:executing-plans`), salvo que el usuario pida subagentes. Pasos con checkbox.

**Goal:** que los plugins requeridos se instalen solos y que no se pueda editar código de un RQ sin ellos.

**Architecture:** una sola fuente de la lista (nueva `lib/plugins-requeridos.mjs`) que separa núcleo y por stack; la consumen el manifiesto (vía test de coherencia), el alta, el arranque y la compuerta de edición.

**Tech Stack:** Node ≥ 22, `node:test`, CLI `rq.mjs`.

**Spec:** `docs/rq/PLG-DEPS/spec.md` · ARQ: `docs/rq/PLG-DEPS/arq.md`

## Global Constraints
- Núcleo: `superpowers@superpowers-marketplace`, `pr-review-toolkit@claude-plugins-official`, `security-guidance@claude-plugins-official`, `claude-security@claude-plugins-official`, `feature-dev@claude-plugins-official`, `claude-md-management@claude-plugins-official`.
- Por stack: `frontend-design@claude-plugins-official` si el proyecto declara `ui.patrones`; `typescript-lsp@claude-plugins-official` si el repo tiene `tsconfig.json` o `package.json` con `typescript`.
- Si no se puede leer lo instalado (`pluginsInstalados` = null): aviso, nunca bloqueo.
- Archivos libres (`docs/**`, `**/*.md`, tests) nunca se bloquean por plugins.

## Review Focus
1. Cuenta con plugins sólo sincronizados desde claude.ai → cuentan como instalados (no bloquear a la nube).
2. `installed_plugins.json` corrupto o ausente → aviso, la edición sigue.
3. Proyecto Odoo sin UI web → no exige `frontend-design` ni `typescript-lsp` (PLG-REQ).
4. Salto `plugins` con frase del usuario → la compuerta deja pasar.
5. Plugin instalado con otro marketplace pero mismo nombre → cuenta (ya lo hace `tiene()` por nombre).

---

### Task 1: Fuente única de requeridos
**Files:** Create `plugin/scripts/lib/plugins-requeridos.mjs`; Modify `plugin/scripts/lib/hooks/session-start.mjs:77-86,113-133`, `plugin/scripts/lib/alta.mjs:15`; Test `tests/plugins-requeridos.test.mjs`
**Interfaces — Produces:** `PLUGINS_NUCLEO: string[]`; `pluginsRequeridos({ raiz, proyecto }): string[]` (núcleo + por stack); `faltantesRequeridos({ raiz, proyecto, env, home }): string[] | null` (null si no se pudo leer); `comandosInstalar(faltan: string[]): string[]` (`claude plugin marketplace add obra/superpowers-marketplace` si falta superpowers, más `claude plugin install <id>` por cada uno).
- [ ] Test rojo: núcleo exacto; Odoo sin `ui.patrones` → sin frontend-design ni typescript-lsp; con `ui.patrones` → incluye frontend-design; `faltantesRequeridos` con home sin `plugins/` → null; `comandosInstalar(['superpowers@superpowers-marketplace'])` incluye el `marketplace add`.
- [ ] Implementar; `session-start` y `alta` importan de acá (`PLUGINS_REQUERIDOS` se reemplaza por `pluginsRequeridos`).
- [ ] `npm test -- tests/plugins-requeridos.test.mjs tests/hooks.test.mjs` en verde; commit.

### Task 2: Manifiesto y marketplace
**Files:** Modify `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plantillas/repo-proyecto/.claude/settings.json`; Test `tests/manifiestos.test.mjs`
**Interfaces — Consumes:** `PLUGINS_NUCLEO`.
- [ ] Test rojo: `plugin.json.dependencies` (como `name@marketplace`) == `PLUGINS_NUCLEO`; `marketplace.json.allowCrossMarketplaceDependenciesOn` == `["superpowers-marketplace","claude-plugins-official"]`; `enabledPlugins` de la plantilla incluye cada núcleo en `true`.
- [ ] Editar los tres JSON; `claude plugin validate ./plugin` (si el CLI está) sin errores.
- [ ] Tests en verde; commit.

### Task 3: Alta obligatoria con comandos
**Files:** Modify `plugin/scripts/lib/alta.mjs:142-152`; Test `tests/alta.test.mjs`, `tests/alta-nube.test.mjs`
**Interfaces — Consumes:** `faltantesRequeridos`, `comandosInstalar`.
- [ ] Test rojo: falta un núcleo → paso `plugins` `obligatorio: true`, `estado: 'falta'`, `como` con `claude plugin install <id>`; sin poder leer → `estado: 'aviso'`, no obligatorio; con plugins synced → `ok`; `abrir` se frena (test existente de `:85` adaptado).
- [ ] Implementar; título "Plugins requeridos"; en synced el `como` agrega "o activalos en claude.ai".
- [ ] Paso nuevo `mcp` recomendado (`obligatorio: false`): aviso si `codebase-memory-mcp` o `context7` no figuran en la config de MCP del usuario, con su comando de alta. Test del paso.
- [ ] Tests en verde; commit.

### Task 4: Compuerta de edición
**Files:** Modify `plugin/scripts/lib/compuerta-edicion.mjs:101`, `plugin/scripts/rq.mjs:49` (`'plugins'` en `COMPUERTAS`); Test `tests/compuerta-edicion.test.mjs`
**Interfaces — Consumes:** `faltantesRequeridos`, `comandosInstalar`; `saltoValido(estado, 'plugins')`.
- [ ] Test rojo: código con núcleo faltante → deny que nombra el plugin y el comando; `.md` → allow; lectura imposible → allow; con salto `plugins` en el RQ activo → allow.
- [ ] Implementar después de `if (tipo === 'libre') return allow();`, usando el estado del RQ activo para el salto.
- [ ] Suite completa (`npm test`) en verde; commit.

### Task 5: Textos
**Files:** Modify `plugin/skills/ciclo-rq/SKILL.md` (sección 0 y saltos), `README.md` (alta), `docs/ENTORNOS.md` (nube: activar en claude.ai).
- [ ] Una línea por lugar: requeridos se instalan solos, compuerta y `saltar plugins`; commit.
