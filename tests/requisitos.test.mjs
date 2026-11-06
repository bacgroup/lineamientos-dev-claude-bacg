import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  tocaUi, verificacionLocalOk, faltaParaEtapa, exigencias, exigenciasDelProyecto, FALTA_VERIFICACION_LOCAL,
} from '../plugin/scripts/lib/requisitos.mjs';
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
  // La etapa 3 es Verificación.
  const raiz = repoConSpec('UI [x] · sensible [ ]');
  assert.ok(faltaParaEtapa(estadoBase(), 3, raiz, {}).includes(FALTA_VERIFICACION_LOCAL));
  // La revisión (etapa 5) viene después de la verificación local.
  const falta = faltaParaEtapa(estadoBase(), 5, raiz, {});
  assert.ok(falta.indexOf(FALTA_VERIFICACION_LOCAL) < falta.findIndex((f) => f.startsWith('la revisión')));
  assert.equal(faltaParaEtapa(estadoBase(), 2, raiz, {}).includes(FALTA_VERIFICACION_LOCAL), false);
  const ok = estadoBase({ verificacion_local: { que: 'x', capturas: ['docs/rq/R-1/qa/a.png'], fecha: '2026-11-06T00:00:00Z' } });
  assert.equal(verificacionLocalOk(ok), true);
  assert.equal(faltaParaEtapa(ok, 3, raiz, {}).includes(FALTA_VERIFICACION_LOCAL), false);
});

test('un RQ que no toca UI no pide verificación local', () => {
  const raiz = repoConSpec('UI [ ] · sensible [ ]');
  assert.equal(faltaParaEtapa(estadoBase(), 3, raiz, {}).includes(FALTA_VERIFICACION_LOCAL), false);
});

test('saltar verificacion-local la cubre', () => {
  const raiz = repoConSpec('UI [x] · sensible [ ]');
  const e = estadoBase({ saltos: [{ compuerta: 'verificacion-local', frase: 'dale, sin verificar', motivo: 'm' }] });
  assert.equal(verificacionLocalOk(e), true);
  assert.equal(faltaParaEtapa(e, 3, raiz, {}).includes(FALTA_VERIFICACION_LOCAL), false);
});

test('exigencias v4: lo de desarrollo en 2, verificación en 3, PROD en 5', () => {
  const bug = exigencias({ tipo: 'bug' });
  assert.deepEqual(bug, [
    { etapa: 2, skill: 'superpowers:systematic-debugging' }, { etapa: 2, causa: true },
    { etapa: 3, skill: 'superpowers:test-driven-development' }, { etapa: 5, revision: true },
  ]);
  const arq = exigencias({ tipo: 'rq', clasificacion: 'arquitectonico' });
  assert.deepEqual(arq, [
    { etapa: 2, skill: 'superpowers:writing-plans' }, { etapa: 3, skill: 'superpowers:test-driven-development' },
    { etapa: 5, skill: 'superpowers:verification-before-completion' }, { etapa: 5, revision: true },
  ]);
});

test('proyecto externo sin version_ciclo: skills_requeridas en numeración v3 se convierten', () => {
  const raiz = repoConSpec('UI [ ] · sensible [ ]');
  const e = estadoBase();
  const v3 = { skills_requeridas: [{ etapa: 6, skill: 'x:prod' }, { etapa: 3, skill: 'x:dev' }, { etapa: 4, skill: 'x:verif' }] };
  assert.ok(faltaParaEtapa(e, 5, raiz, v3).includes('x:prod'));
  assert.deepEqual(exigenciasDelProyecto(e, v3, []), [
    { etapa: 5, skill: 'x:prod' }, { etapa: 2, skill: 'x:dev' }, { etapa: 3, skill: 'x:verif' },
  ]);
  assert.equal(faltaParaEtapa(e, 4, raiz, v3).includes('x:prod'), false);
  assert.ok(faltaParaEtapa(e, 2, raiz, v3).includes('x:dev'));
  // Con version_ciclo 4 la etapa vale tal cual; la 6 (Cierre) y la 4 (DEV) no exigen skills.
  const v4 = { version_ciclo: 4, skills_requeridas: [{ etapa: 5, skill: 'x:prod' }, { etapa: 6, skill: 'x:cierre' }, { etapa: 4, skill: 'x:dev' }] };
  assert.deepEqual(exigenciasDelProyecto(e, v4, []), [{ etapa: 5, skill: 'x:prod' }]);
});
