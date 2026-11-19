// PLG-SEG: checklist de seguridad de aplicaciones (OWASP, con ISO 27001 y SOC 2 como referencia) que aplica la revisión.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

function checklist() {
  const texto = leer('plugin', 'general', 'seguridad.md');
  const m = texto.match(/^## Checklist de aplicaciones\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m);
  assert.ok(m, 'general/seguridad.md no tiene la sección "## Checklist de aplicaciones"');
  return m[1];
}

test('PLG-SEG: el checklist tiene de 10 a 14 puntos, cada uno con qué mirar en el diff y su referencia', () => {
  const puntos = checklist().split(/\r?\n/).filter((l) => /^\d+\. /.test(l));
  assert.ok(puntos.length >= 10 && puntos.length <= 14, `tiene ${puntos.length} puntos`);
  for (const p of puntos) {
    assert.match(p, /→ .+ → /, `sin "punto → qué mirar → referencia": ${p}`);
    assert.match(p, /\bA\d{2}\b|ISO \d|CC\d/, `sin referencia OWASP, ISO 27001 o SOC 2: ${p}`);
  }
});

test('PLG-SEG: define crítico (puntos 1 a 5), "no aplica" en bloque y que es referencia, no auditoría', () => {
  const c = checklist();
  assert.match(c, /cr[ií]tico/i);
  assert.match(c, /1 a 5/);
  assert.match(c, /no aplica/i);
  assert.match(c, /referencia/i);
  assert.match(c, /no (?:produce|genera) evidencia de auditor[ií]a/i);
});

test('PLG-SEG: revisor-rq aplica el checklist sólo a lo que el diff toca, y ciclo-rq lo nombra en la revisión', () => {
  const revisor = leer('plugin', 'agents', 'revisor-rq.md');
  assert.match(revisor, /general\/seguridad\.md/);
  assert.match(revisor, /Checklist de aplicaciones/);
  assert.match(revisor, /s[oó]lo .*diff toca|lo que el diff toca/i);
  const ciclo = leer('plugin', 'skills', 'ciclo-rq', 'SKILL.md');
  const s5 = ciclo.split(/^## 5\. /m)[1].split(/^## 6\. /m)[0];
  assert.match(s5, /Checklist de aplicaciones/);
});
