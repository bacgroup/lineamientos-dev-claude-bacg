import test from 'node:test';
import assert from 'node:assert/strict';
import { NOMBRES, clasificacionDe, implicancias, MAS_PESADA } from '../plugin/scripts/lib/clasificacion.mjs';

test('clasificacionDe acepta el valor interno o el nombre nuevo, sin tildes ni mayúsculas', () => {
  assert.equal(clasificacionDe('Acotado'), 'bounded');
  assert.equal(clasificacionDe('exploracion'), 'spike');
  assert.equal(clasificacionDe('Exploración'), 'spike');
  assert.equal(clasificacionDe('Arquitectónico'), 'arquitectonico');
  assert.equal(clasificacionDe('bounded'), 'bounded');
  assert.equal(clasificacionDe('x'), null);
  assert.equal(clasificacionDe(undefined), null);
});

test('NOMBRES: nombres visibles de los valores internos', () => {
  assert.deepEqual(NOMBRES, { spike: 'Exploración', bounded: 'Acotado', arquitectonico: 'Arquitectónico' });
});

test('implicancias sigue la tabla de la sección 5', () => {
  const arq = implicancias('arquitectonico', 'rq').join('\n');
  assert.match(arq, /decision-arq/);
  assert.match(arq, /plan\.md/);
  assert.match(implicancias('bounded', 'bug').join('\n'), /systematic-debugging/);
  assert.doesNotMatch(implicancias('bounded', 'rq').join('\n'), /systematic-debugging/);
  assert.match(implicancias('spike', 'rq').join('\n'), /sonda/);
});

test('MAS_PESADA: spike < bounded < arquitectonico', () => {
  assert.equal(MAS_PESADA('spike', 'bounded'), 'bounded');
  assert.equal(MAS_PESADA('arquitectonico', 'bounded'), 'arquitectonico');
  assert.equal(MAS_PESADA('spike', 'spike'), 'spike');
});
