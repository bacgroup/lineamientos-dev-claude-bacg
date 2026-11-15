// PLG-DFF2 (premisa 1): OK flexibles. `ok "<frase>"` registra de una vez todo lo pendiente hasta DEV; `autonomia total`
// cubre también el diseño, el plan y la ejecución de un Arquitectónico; una frase vale como tramo entre comas si trae un
// verbo de aprobación y nada que la niegue. PROD sigue pidiendo `aprobar 5`. Y la marca `reglas: 44` (tarea 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado, etapaCumplida, guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { vecesQueLoDijo } from '../plugin/scripts/lib/transcript.mjs';
import { tramoDeAprobacion } from '../plugin/scripts/lib/ok.mjs';
import { reglas44 } from '../plugin/scripts/lib/reglas.mjs';
import { crearRepoTemporal, sesionDePrueba, lineamientos44 } from './helpers.mjs';

const DIR_LIN = lineamientos44();

function correrCon(sesion) {
  return async (cwd, args) => {
    let out = '';
    let err = '';
    const code = await main(args, {
      cwd,
      home: sesion.home,
      env: { ...process.env, ...sesion.env, BACG_LINEAMIENTOS_DIR: DIR_LIN, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_PREVIA: '1' },
      stdout: { write: (s) => { out += s; } },
      stderr: { write: (s) => { err += s; } },
    });
    return { code, out, err };
  };
}

const escribir = (raiz, codigo, archivo, texto) => {
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', codigo), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', codigo, archivo), texto);
};
const SPEC_ARQ = '# R-1\n\n## Diseño\nalgo\n\n### Criterios centrales\n- C-1: uno\n';

test('reglas 44: abrir deja la marca salvo en un proyecto con `reglas: 43`; un RQ viejo la toma con `reglas actualizar`', async () => {
  {
    // Copia del fixture tal cual (con `reglas: 43`): abrir escribe el backlog y no tiene que tocar el original.
    const copiaFixture43 = fs.mkdtempSync(path.join(os.tmpdir(), 'lin43-'));
    fs.cpSync(path.join(import.meta.dirname, 'fixtures', 'lineamientos'), copiaFixture43, { recursive: true });
    const s43 = sesionDePrueba();
    const viejo = crearRepoTemporal({ proyectoId: 'demo' });
    const r43 = await main(['abrir', 'R-9', '--tipo', 'rq', '--clasificacion', 'bounded'], {
      cwd: viejo, home: s43.home,
      env: { ...process.env, ...s43.env, BACG_LINEAMIENTOS_DIR: copiaFixture43, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_PREVIA: '1' },
      stdout: { write() {} }, stderr: { write() {} },
    });
    assert.equal(r43, 0);
    assert.equal(reglas44(cargarEstado(viejo, 'R-9')), false);
  }
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  assert.equal((await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'])).code, 0);
  assert.equal(reglas44(cargarEstado(raiz, 'R-1')), true);
  const e = cargarEstado(raiz, 'R-1');
  delete e.reglas;
  guardarEstado(raiz, e);
  assert.equal(reglas44(cargarEstado(raiz, 'R-1')), false);
  const r = await correr(raiz, ['reglas', 'actualizar']);
  assert.equal(r.code, 0, r.err);
  assert.equal(reglas44(cargarEstado(raiz, 'R-1')), true);
  assert.equal(reglas44({}), false);
});

test('tramo de aprobación: verbo de aprobación sin negación, como prefijo de la oración', () => {
  assert.equal(tramoDeAprobacion('Sí, dale'), true);
  assert.equal(tramoDeAprobacion('ok avanzá'), true);
  assert.equal(tramoDeAprobacion('no apruebo'), false);
  assert.equal(tramoDeAprobacion('mañana vemos'), false);
  // "Sí, dale, el diseño está bien" → "Sí, dale" cuenta; si lo que sigue lo posterga, no.
  assert.equal(vecesQueLoDijo('Sí, dale', ['Sí, dale, el diseño está bien']), 1);
  assert.equal(vecesQueLoDijo('Sí, dale', ['Sí, dale, pero mañana revisamos']), 0);
  assert.equal(vecesQueLoDijo('OK', ['OK, pero mañana']), 0);
  // La negación antes o un freno después anulan el tramo.
  assert.equal(vecesQueLoDijo('dale después', ['No, dale después']), 0);
  assert.equal(vecesQueLoDijo('Dale', ['Dale, pero esperá a que lo revise']), 0);
  // Un tramo que no está al principio de la oración no cuenta.
  assert.equal(vecesQueLoDijo('dale', ['Mirá, dale']), 0);
  // Lo de antes sigue igual: oración entera.
  assert.equal(vecesQueLoDijo('Aprobar diseño', ['Acotado + Aprobar diseño']), 1);
});

test('autonomia total: un Arquitectónico con diseño y plan queda aprobado, con ejecución en línea y autonomía hasta DEV', async () => {
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  escribir(raiz, 'R-1', 'spec.md', SPEC_ARQ);
  const frase = 'Te dejo mi OK y trabajo este RQ de manera automatizada';
  s.dijo(frase);
  const sinPlan = await correr(raiz, ['autonomia', 'total', frase]);
  assert.equal(sinPlan.code, 0, sinPlan.err);
  assert.match(sinPlan.out, /plan\.md/);
  assert.equal((cargarEstado(raiz, 'R-1').aprobaciones ?? []).length, 0);
  escribir(raiz, 'R-1', 'plan.md', '# plan\n');
  const r = await correr(raiz, ['autonomia', 'aplicar']);
  assert.equal(r.code, 0, r.err);
  const e = cargarEstado(raiz, 'R-1');
  assert.equal(e.clasificacion_pendiente, false);
  assert.deepEqual(e.aprobaciones.map((a) => [a.etapa, a.via]), [[1, 'sesion-total']]);
  assert.equal(e.ejecucion?.modo, 'inline');
  assert.equal(e.ejecucion?.via, 'sesion-total');
  assert.equal(e.autonomia?.hasta, 4);
  assert.equal(etapaCumplida(e, 4, { raiz }), true);
  assert.equal(etapaCumplida(e, 5, { raiz, textosUsuario: [frase] }), false);
});

test('autonomia total con --ejecucion subagentes registra esa ejecución', async () => {
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  escribir(raiz, 'R-1', 'spec.md', SPEC_ARQ);
  escribir(raiz, 'R-1', 'plan.md', '# plan\n');
  s.dijo('Avancen solos con todo');
  const r = await correr(raiz, ['autonomia', 'total', 'Avancen solos con todo', '--ejecucion', 'subagentes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(cargarEstado(raiz, 'R-1').ejecucion?.modo, 'subagentes');
});

test('ok: una respuesta registra todo lo pendiente hasta DEV y cuenta como un solo uso de la frase', async () => {
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  escribir(raiz, 'R-1', 'spec.md', SPEC_ARQ);
  escribir(raiz, 'R-1', 'plan.md', '# plan\n');
  s.dijo('Sí, dale con todo, confío en el plan');
  const r = await correr(raiz, ['ok', 'Sí, dale con todo']);
  assert.equal(r.code, 0, r.err);
  const e = cargarEstado(raiz, 'R-1');
  assert.equal(e.clasificacion_pendiente, false);
  assert.equal(e.clasificacion_confirmada?.via, 'ok');
  assert.deepEqual(e.aprobaciones.map((a) => [a.etapa, a.via]), [[1, 'ok']]);
  assert.equal(e.ejecucion?.modo, 'inline');
  assert.equal(e.autonomia?.hasta, 4);
  const grupos = new Set([e.clasificacion_confirmada.grupo, e.aprobaciones[0].grupo, e.ejecucion.grupo, e.autonomia.grupo]);
  assert.equal(grupos.size, 1);
  // La misma frase dicha una sola vez no vale para un segundo ok ni para otra decisión.
  const otra = await correr(raiz, ['aprobar', '5', 'Sí, dale con todo']);
  assert.notEqual(otra.code, 0);
  assert.match(otra.err, /ya está registrada/);
});

test('ok: sin nada pendiente hasta DEV lo dice y no registra nada; nunca aprueba PROD', async () => {
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  escribir(raiz, 'R-1', 'spec.md', '# R-1\n\n## Diseño\nx\n\n## Tareas\n- una\n');
  s.dijo('ok, avanzá');
  assert.equal((await correr(raiz, ['ok', 'ok, avanzá'])).code, 0);
  s.dijo('dale de nuevo');
  const r = await correr(raiz, ['ok', 'dale de nuevo']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /nada pendiente/i);
  assert.equal(cargarEstado(raiz, 'R-1').aprobaciones.some((a) => a.etapa === 5), false);
});

test('ok: Arquitectónico sin plan.md confirma la clasificación y avisa qué falta para el diseño', async () => {
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  s.dijo('Dale, arquitectónico');
  const r = await correr(raiz, ['ok', 'Dale, arquitectónico']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /plan\.md/);
  const e = cargarEstado(raiz, 'R-1');
  assert.equal(e.clasificacion_pendiente, false);
  assert.deepEqual(e.aprobaciones ?? [], []);
});
