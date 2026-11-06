import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ETAPA, NOMBRE_ETAPA, VERSION_CICLO, aV4, etapaV3aV4, etapaProyectoAV4,
} from '../plugin/scripts/lib/etapas.mjs';

test('ETAPA y NOMBRE_ETAPA: numeración v4 de 0 a 6', () => {
  assert.deepEqual(ETAPA, { ARRANQUE: 0, DISENO: 1, DESARROLLO: 2, VERIFICACION: 3, DEV: 4, PROD: 5, CIERRE: 6 });
  assert.ok(Object.isFrozen(ETAPA));
  assert.deepEqual(NOMBRE_ETAPA, {
    0: 'Arranque y clasificación', 1: 'Diseño y plan', 2: 'Desarrollo', 3: 'Verificación',
    4: 'DEV / Preview', 5: 'PROD y entrega', 6: 'Cierre',
  });
  assert.equal(VERSION_CICLO, 4);
});

test('etapaV3aV4: Diseño y Plan se juntan; del 3 en adelante corren una', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(etapaV3aV4), [0, 1, 1, 2, 3, 4, 5, 6]);
  // Lo que no es una etapa v3 queda como está.
  for (const x of [8, -1, '3', null, undefined, 2.5]) assert.equal(etapaV3aV4(x), x, String(x));
});

test('aV4 convierte etapa 5 con aprobar 6', () => {
  const v3 = {
    codigo: 'R-1', etapa: 5,
    aprobaciones: [{ etapa: 6, frase: 'Dale a PROD', fecha: 'x' }],
  };
  const copia = structuredClone(v3);
  const v4 = aV4(v3);
  assert.equal(v4.etapa, 4);
  assert.equal(v4.aprobaciones[0].etapa, 5);
  assert.equal(v4.aprobaciones[0].frase, 'Dale a PROD');
  assert.equal(v4.version_ciclo, 4);
  assert.equal(v4._v3, true, 'marca de convertido');
  assert.deepEqual(v3, copia, 'el original queda intacto');
});

test('aV4: dos aprobaciones que caen en la 1 quedan las dos; autonomia.hasta se convierte', () => {
  const v4 = aV4({
    codigo: 'R-1', etapa: 2,
    aprobaciones: [{ etapa: 1, frase: 'Diseño ok' }, { etapa: 2, frase: 'Plan ok' }, { etapa: 7, frase: 'raro' }],
    autonomia: { hasta: 5, frase: 'hasta DEV' },
  });
  assert.equal(v4.etapa, 1);
  assert.deepEqual(v4.aprobaciones.map((a) => a.etapa), [1, 1, 6]);
  assert.equal(v4.autonomia.hasta, 4);
  assert.equal(v4.autonomia.frase, 'hasta DEV');
});

test('aV4 tolera estados sin etapa, sin aprobaciones o con entradas rotas', () => {
  const v4 = aV4({ codigo: 'R-1', aprobaciones: [null, 'x', { frase: 'sin etapa' }], autonomia: null });
  assert.equal(v4.etapa, undefined);
  assert.deepEqual(v4.aprobaciones, [null, 'x', { frase: 'sin etapa' }]);
  assert.equal(v4.autonomia, null);
  assert.equal(v4.version_ciclo, 4);
});

test('aV4 es identidad en v4', () => {
  const e = { codigo: 'R-1', version_ciclo: 4, etapa: 5, aprobaciones: [{ etapa: 5, frase: 'ok' }] };
  assert.equal(aV4(e), e);
  assert.equal(e.etapa, 5);
  assert.equal('_v3' in e, false);
  // Lo que no es un objeto no se toca.
  for (const x of [null, undefined, 'x', [1]]) assert.equal(aV4(x), x);
});

test('etapaProyectoAV4: sin version_ciclo convierte 3→2, 4→3, 6→5; con version_ciclo 4, identidad', () => {
  const v3 = {};
  assert.deepEqual([3, 4, 6].map((n) => etapaProyectoAV4(v3, n)), [2, 3, 5]);
  assert.deepEqual([3, 4, 6].map((n) => etapaProyectoAV4(null, n)), [2, 3, 5]);
  const v4 = { version_ciclo: 4 };
  assert.deepEqual([2, 3, 5].map((n) => etapaProyectoAV4(v4, n)), [2, 3, 5]);
});
