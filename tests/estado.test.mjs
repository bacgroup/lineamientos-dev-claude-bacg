import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  rqActivo, rqsActivos, guardarActivos, cargarEstado, guardarEstado, estadoCommiteado,
  aprobacionValida, autonomiaDe, etapaCumplida, saltoValido,
} from '../plugin/scripts/lib/estado.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const base = (extra = {}) => ({
  codigo: 'R-T1', tipo: 'rq', clasificacion: 'arquitectonico', etapa: 1,
  autonomia: null, aprobaciones: [], saltos: [], ...extra,
});
const ap = (etapa, frase) => ({ etapa, frase, fecha: '2026-10-23T12:00:00Z' });
const ctx = (raiz, o = {}) => ({ textosUsuario: [], commiteado: null, raiz, ...o });

function escribir(raiz, rel, txt) {
  const p = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, txt);
}

test('rqActivo: sin ACTIVO es null; con ACTIVO devuelve el código recortado; vacío es null', () => {
  const raiz = crearRepoTemporal({});
  assert.equal(rqActivo(raiz), null);
  escribir(raiz, 'docs/rq/ACTIVO', 'R-T1\n');
  assert.equal(rqActivo(raiz), 'R-T1');
  escribir(raiz, 'docs/rq/ACTIVO', '  \n');
  assert.equal(rqActivo(raiz), null);
});

test('cargarEstado: inexistente e inválido lanzan los errores esperados', () => {
  const raiz = crearRepoTemporal({});
  assert.throws(() => cargarEstado(raiz, 'R-X'), /^Error: ESTADO_INEXISTENTE: R-X$/);
  escribir(raiz, 'docs/rq/R-X/estado.yml', 'a: [1, 2\nb: }');
  assert.throws(() => cargarEstado(raiz, 'R-X'), /^Error: ESTADO_INVALIDO: R-X: .+/);
});

test('guardarEstado crea la carpeta, setea actualizado y round-trip', () => {
  const raiz = crearRepoTemporal({});
  const e = base({ aprobaciones: [ap(1, 'Spec aprobada')] });
  guardarEstado(raiz, e);
  const leido = cargarEstado(raiz, 'R-T1');
  assert.equal(leido.codigo, 'R-T1');
  assert.ok(!Number.isNaN(Date.parse(leido.actualizado)));
  assert.equal(leido.aprobaciones[0].frase, 'Spec aprobada');
});

test('estadoCommiteado: null si no está commiteado; objeto si lo está', () => {
  const raiz = crearRepoTemporal({});
  guardarEstado(raiz, base());
  assert.equal(estadoCommiteado(raiz, 'R-T1'), null);
  spawnSync('git', ['add', '-A'], { cwd: raiz });
  spawnSync('git', ['commit', '-q', '-m', 'estado'], { cwd: raiz });
  assert.equal(estadoCommiteado(raiz, 'R-T1').codigo, 'R-T1');
});

test('aprobacionValida: la frase se validó al registrarla; acá alcanza con etapa entera y frase no vacía', () => {
  assert.equal(aprobacionValida(ap(1, 'Spec aprobada, dale')), true);
  assert.equal(aprobacionValida(ap(6, 'Dale')), true, 'un "Dale" vale también para PROD');
  assert.equal(aprobacionValida(ap(1, '  ')), false);
  assert.equal(aprobacionValida({ etapa: '1', frase: 'x' }), false);
  assert.equal(aprobacionValida(null), false);
});

test('etapaCumplida: aprobación de la etapa, válida en cualquier sesión', () => {
  const raiz = crearRepoTemporal({});
  const e = base({ aprobaciones: [ap(1, 'Spec aprobada, dale')] });
  assert.equal(etapaCumplida(e, 1, ctx(raiz)), true);
  assert.equal(etapaCumplida(e, 3, ctx(raiz)), false, 'arquitectónico: el OK de diseño no cubre el desarrollo');
  // PROD: la frase tiene que estar en los mensajes de la sesión; un "Avanza" vale si fue el mensaje entero.
  assert.equal(etapaCumplida(base({ aprobaciones: [ap(6, 'Avanza')] }), 6, ctx(raiz)), false);
  assert.equal(etapaCumplida(base({ aprobaciones: [ap(6, 'Avanza')] }), 6, ctx(raiz, { textosUsuario: ['Avanza'] })), true);
  assert.equal(etapaCumplida(base({ aprobaciones: [ap(6, 'Avanza')] }), 6, ctx(raiz, { textosUsuario: ['Avanza con el diseño'] })), false);
});

test('etapaCumplida: autonomía hasta 5 + plan.md cumple la 2; la 6 nunca', () => {
  const raiz = crearRepoTemporal({});
  const aut = { hasta: 5, frase: 'Autonomía hasta la etapa cinco', fecha: 'x' };
  const e = base({ autonomia: aut });
  const c = ctx(raiz);
  assert.equal(etapaCumplida(e, 2, c), false, 'sin plan.md');
  escribir(raiz, 'docs/rq/R-T1/plan.md', 'x');
  assert.equal(etapaCumplida(e, 2, c), true);
  assert.equal(etapaCumplida(e, 1, c), false, 'sin spec.md');
  escribir(raiz, 'docs/rq/R-T1/spec.md', 'x');
  assert.equal(etapaCumplida(e, 1, c), true);
  assert.equal(etapaCumplida(e, 3, c), true);
  assert.equal(etapaCumplida(e, 6, c), false);
  assert.equal(etapaCumplida(e, 7, c), false, 'hasta 5 < 7');
  const e9 = base({ autonomia: { ...aut, hasta: 9 } });
  for (const x of [0, 7, 8, '3', NaN]) assert.equal(etapaCumplida(e9, x, c), false, String(x));
  assert.equal(etapaCumplida(base({ autonomia: { ...aut, frase: '' } }), 3, c), false, 'autonomía sin frase');
});

test('autonomiaDe: spike y bounded tienen autonomía hasta DEV por defecto; arquitectónico no', () => {
  assert.equal(autonomiaDe(base({ clasificacion: 'bounded' })), 5);
  assert.equal(autonomiaDe(base({ clasificacion: 'spike' })), 5);
  assert.equal(autonomiaDe(base({ clasificacion: 'arquitectonico' })), 0);
  assert.equal(autonomiaDe(base({ autonomia: { hasta: 3, frase: 'hasta tres' } })), 3);
});

test('etapaCumplida: un bounded sin aprobaciones avanza con su spec.md (autonomía por defecto)', () => {
  const raiz = crearRepoTemporal({});
  const e = base({ clasificacion: 'bounded' });
  for (const n of [1, 2]) assert.equal(etapaCumplida(e, n, ctx(raiz)), false, `sin spec: ${n}`);
  escribir(raiz, 'docs/rq/R-T1/spec.md', 'x');
  for (const n of [1, 2, 3, 5]) assert.equal(etapaCumplida(e, n, ctx(raiz)), true, `con spec: ${n}`);
  assert.equal(etapaCumplida(e, 4, ctx(raiz)), false);
  assert.equal(etapaCumplida(e, 6, ctx(raiz)), false, 'PROD siempre con OK del usuario');
});

test('etapaCumplida 4: sólo evidencia (tests.ok y revision.ok)', () => {
  const raiz = crearRepoTemporal({});
  assert.equal(etapaCumplida(base({ tests: { ok: true }, revision: { ok: true } }), 4, ctx(raiz)), true);
  assert.equal(etapaCumplida(base({ tests: { ok: true } }), 4, ctx(raiz)), false);
  assert.equal(etapaCumplida(base({ tests: { ok: false }, revision: { ok: true } }), 4, ctx(raiz)), false);
});

test('etapaCumplida: en bounded el OK del diseño cubre plan, desarrollo y DEV; en arquitectónico no', () => {
  const raiz = crearRepoTemporal({});
  const e = base({ clasificacion: 'bounded', aprobaciones: [ap(1, 'Spec aprobada, dale')] });
  for (const n of [2, 3, 5]) assert.equal(etapaCumplida(e, n, ctx(raiz)), true, String(n));
  const arq = { ...e, clasificacion: 'arquitectonico' };
  assert.equal(etapaCumplida(arq, 2, ctx(raiz)), false);
});

test('saltoValido: salto registrado de la misma compuerta', () => {
  const s = { compuerta: 'commit', frase: 'Saltá la compuerta de commit', motivo: 'm', fecha: 'x' };
  const e = base({ saltos: [s] });
  assert.equal(saltoValido(e, 'commit'), true);
  assert.equal(saltoValido(e, 'push'), false);
  assert.equal(saltoValido(base({ saltos: [{ ...s, frase: '' }] }), 'commit'), false);
});

test('etapaCumplida y saltoValido nunca lanzan: entradas rotas dan false', () => {
  const raiz = crearRepoTemporal({});
  const aut = { hasta: 5, frase: 'Autonomía hasta la etapa cinco', fecha: 'x' };
  const c = ctx(raiz);
  assert.equal(etapaCumplida(null, 1, c), false);
  assert.equal(etapaCumplida(undefined, 1, c), false);
  assert.equal(etapaCumplida('x', 1, c), false);
  assert.equal(etapaCumplida(base({ aprobaciones: { etapa: 1 } }), 1, c), false);
  assert.equal(etapaCumplida(base({ autonomia: aut, codigo: undefined }), 1, c), false);
  assert.equal(etapaCumplida(base({ autonomia: aut }), 1, undefined), false);
  assert.equal(etapaCumplida(base({ autonomia: { ...aut, hasta: 5.5 } }), 3, c), false);
  assert.equal(etapaCumplida(base({ autonomia: aut }), 3, c), true);
  assert.equal(saltoValido(null, 'commit'), false);
  assert.equal(saltoValido(base({ saltos: 'x' }), 'commit'), false);
  assert.equal(aprobacionValida(null), false);
});

test('código inválido: ../x se rechaza en todas las funciones', () => {
  const raiz = crearRepoTemporal({});
  assert.throws(() => cargarEstado(raiz, '../x'), (e) => e.message === 'ESTADO_INVALIDO: ../x: código inválido');
  assert.throws(() => guardarEstado(raiz, base({ codigo: '../x' })), (e) => e.message === 'ESTADO_INVALIDO: ../x: código inválido');
  assert.equal(estadoCommiteado(raiz, '../x'), null);
  const aut = { hasta: 5, frase: 'Autonomía hasta la etapa cinco', fecha: 'x' };
  assert.equal(etapaCumplida(base({ codigo: '../x', autonomia: aut }), 1, ctx(raiz)), false);
});

test('rqsActivos y guardarActivos: varios RQ, uno por línea, sin duplicados; vacío borra ACTIVO', () => {
  const raiz = crearRepoTemporal({});
  assert.deepEqual(rqsActivos(raiz), []);
  guardarActivos(raiz, ['R-1', 'R-2', 'R-1', '../x']);
  assert.deepEqual(rqsActivos(raiz), ['R-1', 'R-2']);
  assert.equal(rqActivo(raiz), 'R-2');
  guardarActivos(raiz, []);
  assert.equal(fs.existsSync(path.join(raiz, 'docs', 'rq', 'ACTIVO')), false);
  assert.equal(rqActivo(raiz), null);
});

test('estadoCommiteado: YAML que no es objeto (array) da null', () => {
  const raiz = crearRepoTemporal({ archivos: { 'docs/rq/R-A/estado.yml': '- 1\n- 2\n' } });
  assert.equal(estadoCommiteado(raiz, 'R-A'), null);
});
