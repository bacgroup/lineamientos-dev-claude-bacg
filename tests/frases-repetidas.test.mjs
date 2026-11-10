// PLG-DFF (pedido 4 de dev-fullflow): una frase que el usuario repite en un mismo mensaje vale una vez por cada oración en que
// la dijo. "1. OK\n2. OK\n3. OK" son tres OK (clasificación, diseño y PROD), no uno.
import test from 'node:test';
import assert from 'node:assert/strict';
import { vecesQueLoDijo } from '../plugin/scripts/lib/transcript.mjs';

test('una frase repetida en oraciones de un mismo mensaje cuenta una vez por oración', () => {
  assert.equal(vecesQueLoDijo('OK', ['1. OK\n2. OK\n3. OK']), 3);
  assert.equal(vecesQueLoDijo('Dale', ['Dale + Dale']), 2);
});

test('suma las veces de varios mensajes', () => {
  assert.equal(vecesQueLoDijo('OK', ['OK', '1. OK\n2. OK']), 3);
});

test('un mensaje entero cuenta una vez y un tramo de oración no cuenta', () => {
  assert.equal(vecesQueLoDijo('OK', ['OK']), 1);
  assert.equal(vecesQueLoDijo('OK', ['OK, pero mañana']), 0);
  assert.equal(vecesQueLoDijo('OK', ['No está OK']), 0);
  assert.equal(vecesQueLoDijo('', ['OK']), 0);
});
