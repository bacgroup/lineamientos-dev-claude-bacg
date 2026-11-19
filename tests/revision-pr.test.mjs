// PLG-PRREV: skill revision-pr, la segunda línea de revisión que corre en GitHub (claude-code-action).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivo = path.join(raiz, 'plugin', 'skills', 'revision-pr', 'SKILL.md');

function partes() {
  const texto = fs.readFileSync(archivo, 'utf8');
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(m, 'revision-pr/SKILL.md sin frontmatter');
  return { front: m[1], cuerpo: m[2] };
}

test('PLG-PRREV: revision-pr tiene nombre y puede comentar en línea', () => {
  const { front } = partes();
  assert.match(front, /^name: revision-pr$/m);
  assert.match(front, /^description: .+/m);
  assert.match(front, /allowed-tools:.*mcp__github_inline_comment__create_inline_comment/);
});

test('PLG-PRREV: revisa con las reglas del proyecto y el checklist de seguridad, no con criterios genéricos', () => {
  const { cuerpo } = partes();
  for (const s of ['reglas.md', 'adr/', 'ui.canon', 'general/seguridad.md', 'Checklist de aplicaciones']) {
    assert.ok(cuerpo.includes(s), `revision-pr no nombra ${s}`);
  }
});

test('PLG-PRREV: sólo un crítico de seguridad (puntos 1 a 5 con evidencia) pone el check en rojo vía bacg-revision.json', () => {
  const { cuerpo } = partes();
  assert.match(cuerpo, /bacg-revision\.json/);
  assert.match(cuerpo, /"criticos"/);
  assert.match(cuerpo, /cr[ií]tico[^\n]*puntos 1 a 5/i);
  assert.match(cuerpo, /evidencia en el diff/i);
  assert.match(cuerpo, /sin cambios de c[oó]digo/i, 'diff vacío o sólo docs: criticos 0');
  assert.ok(cuerpo.split(/\r?\n/).length <= 90, 'la skill tiene que ser corta');
});
