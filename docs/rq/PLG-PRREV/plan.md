# PLG-PRREV Implementation Plan

> **Ejecución elegida:** en línea (`superpowers:executing-plans`), salvo que el usuario pida subagentes. Pasos con checkbox.

**Goal:** revisor automático en GitHub, con las reglas del proyecto, instalable desde la CLI y el alta.

**Architecture:** skill `revision-pr` en el plugin + plantilla de workflow que la invoca vía `claude-code-action`; `rq.mjs revisor-pr` la renderiza por repo con sus ramas.

**Tech Stack:** Node ≥ 22, `node:test`, GitHub Actions, `anthropics/claude-code-action@v1`.

**Spec:** `docs/rq/PLG-PRREV/spec.md` · ARQ: `docs/rq/PLG-PRREV/arq.md` · Depende de PLG-SEG.

## Global Constraints
- Secret: `${{ secrets.ANTHROPIC_API_KEY }}`; nunca una clave literal.
- Permisos del job: `contents: read`, `pull-requests: write`, `issues: read`, `id-token: write`.
- `claude_args`: `--max-turns 30 --allowedTools "mcp__github_inline_comment__create_inline_comment,Bash(gh api:*),Read,Grep,Glob"`.
- Ramas: `ramasSoloPr(proyecto, repo)` ∪ `ramasProd(proyecto, repo)` (`lib/stack.mjs`).

## Review Focus
1. Repo sin `ramas_solo_pr` ni `ramas_prod` → usa la rama por defecto del remoto y lo dice.
2. Workflow ya existente modificado a mano → `revisor-pr` no lo pisa sin `--forzar`.
3. Push de un merge de PR (autor humano) → no dispara revisión (sólo autores externos).
4. Diff vacío o sólo docs → la skill comenta "sin cambios de código" y `criticos: 0`.
5. `bacg-revision.json` ausente (la skill falló) → el paso final no pone rojo por eso; el job ya falló en la acción.

---

### Task 1: Skill `revision-pr`
**Files:** Create `plugin/skills/revision-pr/SKILL.md`; Test `tests/revision-pr.test.mjs`
- [ ] Test rojo: frontmatter con `name: revision-pr` y `allowed-tools` que incluye `mcp__github_inline_comment__create_inline_comment`; el cuerpo nombra `reglas.md`, `adr/`, `ui.canon`, `general/seguridad.md`, `bacg-revision.json` y define crítico como puntos 1 a 5 del checklist.
- [ ] Escribir la skill (≤ 80 líneas): entradas (PR o rango de push), tres focos, formato de comentario, salida JSON.
- [ ] Test en verde; commit.

### Task 2: Plantilla y render
**Files:** Create `plantillas/repo-proyecto/.github/workflows/bacg-revisor.yml`, `plugin/scripts/lib/revisor-pr.mjs`; Modify `plugin/scripts/rq.mjs` (subcomando y ayuda); Test `tests/revisor-pr.test.mjs`
**Interfaces — Produces:** `renderRevisor({ proyecto, entradaRepo, ramaDefecto }): string`; `instalarRevisor({ raiz, proyecto, entradaRepo, forzar }): { ruta, creado: boolean, motivo? }`.
- [ ] Test rojo: render con PowerFy (`18.0-dev`, `18.0`) → `pull_request.branches` y `push.branches` = ambas; `if` del job de push filtra autores de `autoresExternos(proyecto)`; sin claves literales (regex `sk-ant-` ausente) y `secrets.ANTHROPIC_API_KEY` presente; archivo existente distinto sin `forzar` → `creado: false`.
- [ ] Plantilla con marcadores `{{RAMAS}}` y `{{AUTORES_EXTERNOS}}`; paso final `jq -e '.criticos == 0' bacg-revision.json` si el archivo existe.
- [ ] Implementar; `$RQ revisor-pr [--repo <n>] [--forzar]`.
- [ ] Tests en verde; commit.

### Task 3: Alta y textos
**Files:** Modify `plugin/scripts/lib/alta.mjs` (paso `revisor-pr`, `obligatorio: false`), `plugin/skills/ciclo-rq/SKILL.md` (sección 5), `README.md`; Test `tests/alta.test.mjs`
- [ ] Test rojo: repo sin `.github/workflows/bacg-revisor.yml` → paso `revisor-pr` en `aviso` con `como` = `rq.mjs revisor-pr`, recordatorio del secret y de la protección de rama.
- [ ] Implementar y textos; suite completa en verde; commit.

### Task 4: Prueba en vivo (manual, etapa 5)
- [ ] Con el secret cargado en un repo de prueba: PR con un error a propósito (por ejemplo, SQL armado con concatenación) → comentario del revisor y check rojo; push de autor externo sobre `.lovable/**` → comentario en el commit. Registrar `$RQ paso hecho manual:prueba-revisor-en-repo "<links>"`.
