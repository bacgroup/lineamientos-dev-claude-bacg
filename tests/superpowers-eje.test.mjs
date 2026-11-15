// PLG-DFF2 (premisa 2): con reglas 4.4, Superpowers es el motor obligatorio del ciclo. Antes del primer commit de código:
// brainstorming, writing-plans (Acotado y Arquitectónico), TDD y la skill de la ejecución elegida. En la verificación:
// requesting-code-review, verification-before-completion y, si hubo una revisión bloqueante, receiving-code-review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exigencias } from '../plugin/scripts/lib/requisitos.mjs';

const skillsEn = (estado, etapa) => exigencias(estado).filter((x) => x.etapa === etapa && x.skill).map((x) => x.skill.split(':').pop()).sort();

test('4.4 Acotado: plan, TDD y ejecución en línea antes del primer commit de código', () => {
  const e = { codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', reglas: 44 };
  assert.deepEqual(skillsEn(e, 2), ['brainstorming', 'executing-plans', 'test-driven-development', 'writing-plans']);
  assert.deepEqual(skillsEn(e, 3), ['requesting-code-review', 'verification-before-completion']);
});

test('4.4 Arquitectónico con subagentes: subagent-driven-development en lugar de executing-plans', () => {
  const e = { codigo: 'R-1', tipo: 'rq', clasificacion: 'arquitectonico', reglas: 44, ejecucion: { modo: 'subagentes' } };
  assert.ok(skillsEn(e, 2).includes('subagent-driven-development'));
  assert.ok(!skillsEn(e, 2).includes('executing-plans'));
});

test('4.4 BUG: systematic-debugging además; con una revisión bloqueante, receiving-code-review', () => {
  const e = { codigo: 'B-1', tipo: 'bug', clasificacion: 'bounded', reglas: 44, revisiones_bloqueantes: 1 };
  assert.ok(skillsEn(e, 2).includes('systematic-debugging'));
  assert.ok(skillsEn(e, 3).includes('receiving-code-review'));
});

test('4.4 Exploración: sin plan ni ejecución (la sonda no se planifica)', () => {
  const e = { codigo: 'S-1', tipo: 'rq', clasificacion: 'spike', reglas: 44 };
  assert.deepEqual(skillsEn(e, 2), ['brainstorming', 'test-driven-development']);
});

test('sin reglas 4.4: las exigencias de la 4.3 (TDD en la verificación, sin requesting-code-review)', () => {
  const e = { codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded' };
  assert.deepEqual(skillsEn(e, 2), ['brainstorming']);
  assert.deepEqual(skillsEn(e, 3), ['test-driven-development']);
});
