import test from 'node:test';
import assert from 'node:assert/strict';
import { exigenciasDelProyecto, faltaParaEtapa } from '../plugin/scripts/lib/requisitos.mjs';

const proyecto = {
  skills_requeridas: [
    { etapa: 3, skill: 'anthropic-skills:bacg-n8n-guidelines', rutas: ['n8n/**'] },
    { etapa: 3, skill: 'anthropic-skills:bacg-diagnostico-bugs', tipo: 'bug' },
    { etapa: 6, skill: 'anthropic-skills:bacg-n8n-pasaje-prod', rutas: ['n8n/**'] },
    { etapa: 9, skill: 'ignorada' },
  ],
};
const rq = { codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', skills: [], saltos: [] };
const bug = { ...rq, tipo: 'bug' };

test('skills_requeridas: por tipo y por rutas tocadas', () => {
  assert.deepEqual(exigenciasDelProyecto(rq, proyecto, ['addons/x.py']), []);
  assert.deepEqual(exigenciasDelProyecto(rq, proyecto, ['n8n/flujo.json']).map((x) => x.skill), ['anthropic-skills:bacg-n8n-guidelines', 'anthropic-skills:bacg-n8n-pasaje-prod']);
  assert.deepEqual(exigenciasDelProyecto(bug, proyecto, ['addons/x.py']).map((x) => x.skill), ['anthropic-skills:bacg-diagnostico-bugs']);
  assert.equal(exigenciasDelProyecto(rq, proyecto, null).length, 2, 'sin saber las rutas, se exige (falla cerrada)');
});

test('faltaParaEtapa suma las del proyecto y las da por cumplidas si están cargadas o con saltar skills', () => {
  const falta = faltaParaEtapa({ ...rq, revision: { ok: true } }, 6, null, proyecto);
  assert.ok(falta.includes('anthropic-skills:bacg-n8n-pasaje-prod'));
  const cargadas = { ...rq, skills: ['bacg-n8n-guidelines', 'bacg-n8n-pasaje-prod', 'test-driven-development', 'verification-before-completion'], revision: { ok: true } };
  assert.deepEqual(faltaParaEtapa(cargadas, 6, null, proyecto), []);
  const salto = { ...rq, revision: { ok: true }, saltos: [{ compuerta: 'skills', frase: 'x', motivo: 'm', fecha: 'f' }] };
  assert.deepEqual(faltaParaEtapa(salto, 6, null, proyecto), []);
});
