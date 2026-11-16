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

test('tramo de aprobación: verbo de aprobación sin negación, como prefijo de la oración, sólo en modo flexible', () => {
  const flex = { flexible: true };
  assert.equal(tramoDeAprobacion('Sí, dale'), true);
  assert.equal(tramoDeAprobacion('ok avanzá'), true);
  assert.equal(tramoDeAprobacion('no apruebo'), false);
  assert.equal(tramoDeAprobacion('mañana vemos'), false);
  // Por defecto (aprobar, saltar, PROD, la compuerta de Bash) el tramo no cuenta: oración entera, como en la 4.3.
  assert.equal(vecesQueLoDijo('Sí, dale', ['Sí, dale, el diseño está bien']), 0);
  // En modo flexible (sólo `ok` con reglas 4.4), "Sí, dale" cuenta; si lo que sigue lo posterga o condiciona, no.
  assert.equal(vecesQueLoDijo('Sí, dale', ['Sí, dale, el diseño está bien'], flex), 1);
  assert.equal(vecesQueLoDijo('Sí, dale', ['Sí, dale, pero mañana revisamos'], flex), 0);
  assert.equal(vecesQueLoDijo('OK', ['OK, pero mañana'], flex), 0);
  assert.equal(vecesQueLoDijo('dale después', ['No, dale después'], flex), 0);
  assert.equal(vecesQueLoDijo('Dale', ['Dale, pero esperá a que lo revise'], flex), 0);
  assert.equal(vecesQueLoDijo('dale', ['Mirá, dale'], flex), 0);
  // Falsos OK que encontró la revisión: condicionales, acuses de recibo, precondiciones y postergaciones.
  for (const [frase, mensaje] of [
    ['Si funciona', 'Si funciona, avisame y lo vemos'],
    ['Dale', 'Dale, pero primero mostrame el mockup'],
    ['Dale mañana', 'Dale mañana, gracias'],
    ['Ok', 'Ok, pará un segundo'],
    ['Listo', 'Listo, ya corrí el script'],
    ['Sí', 'Sí, el error aparece en el login'],
    ['Va', 'Va, pero antes mostrame el diff'],
    ['Perfecto', 'Perfecto, ahora explicame por qué falla'],
    ['Ok', 'Ok, no lo apruebo'],
  ]) assert.equal(vecesQueLoDijo(frase, [mensaje], flex), 0, `${frase} ⟵ ${mensaje}`);
  // Lo de antes sigue igual: oración entera.
  assert.equal(vecesQueLoDijo('Aprobar diseño', ['Acotado + Aprobar diseño']), 1);
});

test('PROD y saltos no aceptan tramos ni reusar la frase de un ok o de la autonomía total', async () => {
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  escribir(raiz, 'R-1', 'spec.md', '# R-1\n\n## Diseño\nx\n\n## Tareas\n- una\n');
  s.dijo('Dale, avanzá con todo, confío en el plan');
  assert.equal((await correr(raiz, ['ok', 'Dale, avanzá con todo'])).code, 0);
  // El tramo no vale para PROD ni para un salto, ni la frase del ok para otra decisión.
  assert.notEqual((await correr(raiz, ['aprobar', '5', 'Dale, avanzá con todo'])).code, 0);
  assert.notEqual((await correr(raiz, ['saltar', 'e2e', 'Dale, avanzá con todo', 'motivo'])).code, 0);
  s.dijo('Trabajá solo hasta DEV');
  assert.equal((await correr(raiz, ['autonomia', 'total', 'Trabajá solo hasta DEV'])).code, 0);
  assert.notEqual((await correr(raiz, ['aprobar', '5', 'Trabajá solo hasta DEV'])).code, 0);
  assert.equal(cargarEstado(raiz, 'R-1').aprobaciones.some((a) => a.etapa === 5), false);
});

test('un segundo ok con la misma frase vale sólo si el usuario la volvió a decir', async () => {
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  escribir(raiz, 'R-1', 'spec.md', SPEC_ARQ);
  escribir(raiz, 'R-1', 'plan.md', '# plan\n');
  s.dijo('Apruebo y avanzá');
  assert.equal((await correr(raiz, ['ok', 'Apruebo y avanzá'])).code, 0);
  const una = await correr(raiz, ['ok', 'Apruebo y avanzá']);
  assert.notEqual(una.code, 0);
  assert.match(una.err, /ya está registrada/);
  // Dicha otra vez, la frase pasa la verificación; ya no queda nada pendiente hasta DEV.
  s.dijo('Apruebo y avanzá');
  assert.match((await correr(raiz, ['ok', 'Apruebo y avanzá'])).err, /nada pendiente/);
});

test('ok y autonomia total no cambian a un RQ de la 4.3', async () => {
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  const e = cargarEstado(raiz, 'R-1');
  delete e.reglas;
  guardarEstado(raiz, e);
  escribir(raiz, 'R-1', 'spec.md', SPEC_ARQ);
  escribir(raiz, 'R-1', 'plan.md', '# plan\n');
  s.dijo('Dale con todo');
  const ok = await correr(raiz, ['ok', 'Dale con todo']);
  assert.notEqual(ok.code, 0);
  assert.match(ok.err, /reglas actualizar/);
  s.dijo('Seguí solo');
  assert.equal((await correr(raiz, ['autonomia', 'total', 'Seguí solo'])).code, 0);
  assert.deepEqual(cargarEstado(raiz, 'R-1').aprobaciones ?? [], []);
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
  // PROD no acepta tramos (oración entera) ni la frase de un ok.
  assert.match(otra.err, /ya está registrada|no aparece/);
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

test('ok: Arquitectónico sin plan.md no gasta la frase: pide escribir el diseño antes de preguntar', async () => {
  const s = sesionDePrueba();
  const correr = correrCon(s);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  s.dijo('Dale, arquitectónico');
  const r = await correr(raiz, ['ok', 'Dale, arquitectónico']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /plan\.md/);
  const e = cargarEstado(raiz, 'R-1');
  assert.equal(e.clasificacion_pendiente, true);
  // Con el diseño y el plan escritos, la misma respuesta (que no se gastó) cubre todo.
  escribir(raiz, 'R-1', 'spec.md', SPEC_ARQ);
  escribir(raiz, 'R-1', 'plan.md', '# plan\n');
  assert.equal((await correr(raiz, ['ok', 'Dale, arquitectónico'])).code, 0);
  assert.deepEqual(cargarEstado(raiz, 'R-1').aprobaciones.map((a) => a.etapa), [1]);
});
