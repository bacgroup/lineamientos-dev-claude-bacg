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
const puntos = () => checklist().split(/\r?\n/).filter((l) => /^\d+\. /.test(l));

// Referencias válidas: OWASP Top 10 2021 (A01–A10), ISO 27001:2022 Anexo A (5.x–8.x) y SOC 2 (CCn.n o Pn.n).
const REF = /^(?:OWASP A(?:0[1-9]|10)(?:, A(?:0[1-9]|10))*|ISO 27001 [5-8]\.\d+(?:, [5-8]\.\d+)*|SOC 2 (?:CC|P)\d\.\d(?:, (?:CC|P)\d\.\d)*)$/;

test('PLG-SEG: el checklist tiene de 10 a 14 puntos numerados sin saltos, con qué mirar y referencias reales', () => {
  const ps = puntos();
  assert.ok(ps.length >= 10 && ps.length <= 14, `tiene ${ps.length} puntos`);
  ps.forEach((p, i) => {
    assert.ok(p.startsWith(`${i + 1}. `), `numeración con salto en: ${p}`);
    const tramos = p.split(' → ');
    assert.equal(tramos.length, 3, `sin "punto → qué mirar → referencia": ${p}`);
    const refs = tramos[2].split(' · ');
    for (const r of refs) assert.match(r, REF, `referencia mal formada o fuera de rango: "${r}"`);
    if (i < 10) assert.ok(refs.some((r) => r.startsWith('OWASP')), `el punto ${i + 1} no lleva referencia OWASP`);
  });
});

test('PLG-SEG: los críticos son los puntos 1 a 5 (acceso, entradas, sesiones, secretos, datos personales)', () => {
  const ps = puntos();
  const temas = [/acceso/i, /entradas/i, /sesiones/i, /secretos/i, /datos personales/i];
  temas.forEach((re, i) => assert.match(ps[i], re, `el punto ${i + 1} no es ${re}`));
  const c = checklist();
  assert.match(c, /cr[ií]tico[^\n]*puntos 1 a 5/i);
  assert.match(c, /no aplica/i);
  assert.match(c, /no (?:produce|genera) evidencia de auditor[ií]a/i);
  assert.match(c, /PLG-PRREV/, 'el revisor del PR todavía no existe: se nombra como PLG-PRREV');
});

test('PLG-SEG: revisor-rq aplica el checklist sólo a lo que el diff toca, sabe dónde encontrarlo y lo reporta', () => {
  const revisor = leer('plugin', 'agents', 'revisor-rq.md');
  const pasada = revisor.split(/\r?\n/).find((l) => /Seguridad de aplicaci[oó]n/.test(l) && /^\d+\. /.test(l));
  assert.ok(pasada, 'revisor-rq no tiene la pasada "Seguridad de aplicación"');
  assert.match(pasada, /Checklist de aplicaciones/);
  assert.match(pasada, /s[oó]lo a lo que el diff toca/i);
  assert.match(pasada, /no aplica/i);
  assert.match(pasada, /cr[ií]tico/i);
  assert.match(revisor, /BACG_LINEAMIENTOS_DIR|copia de lineamientos/, 'no dice dónde buscar general/seguridad.md');
  assert.match(revisor, /^Checklist: /m, 'la salida no tiene la línea Checklist');
  assert.match(revisor.split('---')[1], /security checklist/i, 'la descripción no menciona la pasada de seguridad');
  const ciclo = leer('plugin', 'skills', 'ciclo-rq', 'SKILL.md');
  const partes = ciclo.split(/^## 5\. /m);
  assert.ok(partes.length > 1, 'ciclo-rq no tiene la sección "## 5."');
  assert.match(partes[1].split(/^## 6\. /m)[0], /Checklist de aplicaciones/);
});
