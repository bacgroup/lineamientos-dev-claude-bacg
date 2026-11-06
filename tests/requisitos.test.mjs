import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tocaUi, verificacionLocalOk, faltaParaEtapa, FALTA_VERIFICACION_LOCAL } from '../plugin/scripts/lib/requisitos.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const estadoBase = (extra = {}) => ({ codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', saltos: [], ...extra });
const repoConSpec = (toca) =>
  crearRepoTemporal({ archivos: { 'docs/rq/R-1/spec.md': `# R-1\n\n## Toca: ${toca}\n` } });

test('toca UI por spec', () => {
  const si = repoConSpec('UI [x] · sensible [ ]');
  assert.equal(tocaUi(estadoBase(), si, {}, []), true);
  const no = repoConSpec('UI [ ] · sensible [ ]');
  assert.equal(tocaUi(estadoBase(), no, {}, []), false);
});

test('toca UI por el diff aunque el spec no lo marque', () => {
  const raiz = repoConSpec('UI [ ] · sensible [ ]');
  assert.equal(tocaUi(estadoBase(), raiz, { ui: { patrones: ['src/pages/**'] } }, ['src/pages/Home.tsx']), true);
});

test('faltaParaEtapa pide la verificación local antes que la revisión', () => {
  // v3: la etapa 4 es Verificación (Task 3 renumera a v4).
  const raiz = repoConSpec('UI [x] · sensible [ ]');
  assert.ok(faltaParaEtapa(estadoBase(), 4, raiz, {}).includes(FALTA_VERIFICACION_LOCAL));
  // La revisión (v3: etapa 6) viene después de la verificación local.
  const falta = faltaParaEtapa(estadoBase(), 6, raiz, {});
  assert.ok(falta.indexOf(FALTA_VERIFICACION_LOCAL) < falta.findIndex((f) => f.startsWith('la revisión')));
  assert.equal(faltaParaEtapa(estadoBase(), 3, raiz, {}).includes(FALTA_VERIFICACION_LOCAL), false);
  const ok = estadoBase({ verificacion_local: { que: 'x', capturas: ['docs/rq/R-1/qa/a.png'], fecha: '2026-11-06T00:00:00Z' } });
  assert.equal(verificacionLocalOk(ok), true);
  assert.equal(faltaParaEtapa(ok, 4, raiz, {}).includes(FALTA_VERIFICACION_LOCAL), false);
});

test('un RQ que no toca UI no pide verificación local', () => {
  const raiz = repoConSpec('UI [ ] · sensible [ ]');
  assert.equal(faltaParaEtapa(estadoBase(), 4, raiz, {}).includes(FALTA_VERIFICACION_LOCAL), false);
});

test('saltar verificacion-local la cubre', () => {
  const raiz = repoConSpec('UI [x] · sensible [ ]');
  const e = estadoBase({ saltos: [{ compuerta: 'verificacion-local', frase: 'dale, sin verificar', motivo: 'm' }] });
  assert.equal(verificacionLocalOk(e), true);
  assert.equal(faltaParaEtapa(e, 4, raiz, {}).includes(FALTA_VERIFICACION_LOCAL), false);
});
