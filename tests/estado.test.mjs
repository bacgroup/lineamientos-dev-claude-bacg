import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  rqActivo, rqsActivos, guardarActivos, cargarEstado, guardarEstado, estadoCommiteado,
  aprobacionValida, autonomiaDe, etapaCumplida, etapaDerivada, saltoValido, cerradosConPendientes,
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
  assert.equal(aprobacionValida(ap(5, 'Dale')), true, 'un "Dale" vale también para PROD');
  assert.equal(aprobacionValida(ap(1, '  ')), false);
  assert.equal(aprobacionValida({ etapa: '1', frase: 'x' }), false);
  assert.equal(aprobacionValida(null), false);
});

test('etapaCumplida: aprobación de la etapa, válida en cualquier sesión', () => {
  const raiz = crearRepoTemporal({});
  const e = base({ aprobaciones: [ap(1, 'Spec aprobada, dale')] });
  assert.equal(etapaCumplida(e, 1, ctx(raiz)), true);
  assert.equal(etapaCumplida(e, 2, ctx(raiz)), false, 'arquitectónico: el OK de diseño no cubre el desarrollo');
  assert.equal(etapaCumplida(e, 4, ctx(raiz)), false, 'arquitectónico: DEV pide su OK');
});

test('etapaCumplida 5 (PROD) exige la frase en los mensajes de la sesión', () => {
  const raiz = crearRepoTemporal({});
  // Un "Avanza" vale si fue el mensaje entero.
  assert.equal(etapaCumplida(base({ aprobaciones: [ap(5, 'Avanza')] }), 5, ctx(raiz)), false);
  assert.equal(etapaCumplida(base({ aprobaciones: [ap(5, 'Avanza')] }), 5, ctx(raiz, { textosUsuario: ['Avanza'] })), true);
  assert.equal(etapaCumplida(base({ aprobaciones: [ap(5, 'Avanza')] }), 5, ctx(raiz, { textosUsuario: ['Avanza con el diseño'] })), false);
  // La autonomía nunca llega a PROD.
  const aut = { hasta: 9, frase: 'Autonomía total', fecha: 'x' };
  assert.equal(etapaCumplida(base({ autonomia: aut }), 5, ctx(raiz, { textosUsuario: ['Autonomía total'] })), false);
});

test('etapaCumplida: autonomía hasta 4 cumple la 2 y la 4; la 1, la 3 y la 5 nunca', () => {
  const raiz = crearRepoTemporal({});
  const aut = { hasta: 4, frase: 'Autonomía hasta la etapa cuatro', fecha: 'x' };
  const e = base({ autonomia: aut });
  const c = ctx(raiz);
  assert.equal(etapaCumplida(e, 2, c), true);
  assert.equal(etapaCumplida(e, 4, c), true);
  escribir(raiz, 'docs/rq/R-T1/spec.md', 'x');
  assert.equal(etapaCumplida(e, 1, c), false, 'el diseño se aprueba siempre');
  assert.equal(etapaCumplida(e, 3, c), false, 'la verificación es evidencia');
  assert.equal(etapaCumplida(e, 5, c), false);
  assert.equal(etapaCumplida(e, 6, c), false);
  assert.equal(etapaCumplida(base({ autonomia: { ...aut, hasta: 2 } }), 4, c), false, 'hasta 2 < 4');
  const e9 = base({ autonomia: { ...aut, hasta: 9 } });
  for (const x of [0, 1, 3, 5, 6, 7, '2', NaN]) assert.equal(etapaCumplida(e9, x, c), false, String(x));
  assert.equal(etapaCumplida(base({ autonomia: { ...aut, frase: '' } }), 2, c), false, 'autonomía sin frase');
});

test('autonomiaDe: spike y bounded tienen autonomía hasta DEV (4) por defecto; arquitectónico no', () => {
  assert.equal(autonomiaDe(base({ clasificacion: 'bounded' })), 4);
  assert.equal(autonomiaDe(base({ clasificacion: 'spike' })), 4);
  assert.equal(autonomiaDe(base({ clasificacion: 'arquitectonico' })), 0);
  assert.equal(autonomiaDe(base({ autonomia: { hasta: 2, frase: 'hasta dos' } })), 2);
});

test('etapaCumplida: un bounded sin aprobaciones llega a 2 y 4 por defecto, pero el diseño (1) pide OK', () => {
  const raiz = crearRepoTemporal({});
  const e = base({ clasificacion: 'bounded' });
  escribir(raiz, 'docs/rq/R-T1/spec.md', 'x');
  escribir(raiz, 'docs/rq/R-T1/plan.md', 'x');
  assert.equal(etapaCumplida(e, 1, ctx(raiz)), false, 'spec.md y plan.md no reemplazan el aprobar 1');
  for (const n of [2, 4]) assert.equal(etapaCumplida(e, n, ctx(raiz)), true, `autonomía por defecto: ${n}`);
  assert.equal(etapaCumplida(e, 3, ctx(raiz)), false, 'la verificación es evidencia');
  assert.equal(etapaCumplida(e, 5, ctx(raiz)), false, 'PROD siempre con OK del usuario');
  assert.equal(etapaCumplida(base({ clasificacion: 'spike' }), 1, ctx(raiz)), false, 'spike: el diseño también pide OK');
});

test('etapaCumplida 3: sólo evidencia (tests.ok y revision.ok)', () => {
  const raiz = crearRepoTemporal({});
  assert.equal(etapaCumplida(base({ tests: { ok: true }, revision: { ok: true } }), 3, ctx(raiz)), true);
  assert.equal(etapaCumplida(base({ tests: { ok: true } }), 3, ctx(raiz)), false);
  assert.equal(etapaCumplida(base({ tests: { ok: false }, revision: { ok: true } }), 3, ctx(raiz)), false);
  // Ni aprobación ni autonomía la reemplazan.
  const aut = { hasta: 9, frase: 'Autonomía total', fecha: 'x' };
  assert.equal(etapaCumplida(base({ aprobaciones: [ap(3, 'ok')], autonomia: aut }), 3, ctx(raiz)), false);
});

test('etapaCumplida: en bounded el OK del diseño cubre desarrollo y DEV; en arquitectónico no', () => {
  const raiz = crearRepoTemporal({});
  const e = base({ clasificacion: 'bounded', aprobaciones: [ap(1, 'Spec aprobada, dale')] });
  for (const n of [1, 2, 4]) assert.equal(etapaCumplida(e, n, ctx(raiz)), true, String(n));
  const arq = { ...e, clasificacion: 'arquitectonico' };
  for (const n of [2, 4]) assert.equal(etapaCumplida(arq, n, ctx(raiz)), false, String(n));
  const arqOk = { ...arq, aprobaciones: [ap(1, 'Diseño ok'), ap(2, 'Desarrollá'), ap(4, 'A DEV')] };
  for (const n of [1, 2, 4]) assert.equal(etapaCumplida(arqOk, n, ctx(raiz)), true, String(n));
});

test('etapaDerivada v4: el diseño cuenta aprobado; plan.md no define etapa', () => {
  const raiz = crearRepoTemporal({});
  const e = base({ etapa: 0 });
  const d = (x) => etapaDerivada(x, raiz);
  assert.equal(d(e), 0, 'sin nada');
  escribir(raiz, 'docs/rq/R-T1/spec.md', 'x');
  assert.equal(d(e), 0, 'spec.md sin aprobación');
  escribir(raiz, 'docs/rq/R-T1/plan.md', 'x');
  assert.equal(d(e), 0, 'plan.md solo no cambia la etapa');
  const ap1 = { ...e, aprobaciones: [ap(1, 'Diseño ok')] };
  assert.equal(d(ap1), 1, 'spec.md + aprobar 1');
  assert.equal(d({ ...ap1, tests: { ok: false } }), 2, 'tests registrados');
  assert.equal(d({ ...ap1, tests: { ok: true }, revision: { ok: true } }), 3, 'tests ok + revisión ok');
  assert.equal(d({ ...ap1, tests: { ok: true }, revision: { ok: true }, e2e: { ok: true } }), 4, '+ E2E ok');
  assert.equal(d({ ...ap1, aprobaciones: [ap(1, 'x'), ap(5, 'A PROD')] }), 5, 'aprobación 5');
  assert.equal(d({ ...ap1, circuito: [{ paso: 'x' }] }), 5, 'circuito');
  assert.equal(d({ ...ap1, etapa: 6 }), 6, 'registrada 6');
  assert.equal(d({ ...e, etapa: 2 }), 2, 'nunca menor que la registrada');
});

test('cargarEstado convierte un estado.yml v3 sin reescribirlo', () => {
  const raiz = crearRepoTemporal({});
  const texto = 'codigo: R-V3\ntipo: rq\nclasificacion: bounded\netapa: 5\naprobaciones:\n  - etapa: 6\n    frase: Dale a PROD\n';
  escribir(raiz, 'docs/rq/R-V3/estado.yml', texto);
  const e = cargarEstado(raiz, 'R-V3');
  assert.equal(e.etapa, 4);
  assert.equal(e.aprobaciones[0].etapa, 5);
  assert.equal(e.version_ciclo, 4);
  assert.equal(e._v3, true);
  const enDisco = fs.readFileSync(path.join(raiz, 'docs/rq/R-V3/estado.yml'), 'utf8');
  assert.equal(enDisco, texto);
  assert.equal(enDisco.includes('version_ciclo'), false);
});

test('guardarEstado escribe version_ciclo 4 y no la marca _v3; un v4 se lee tal cual', () => {
  const raiz = crearRepoTemporal({});
  escribir(raiz, 'docs/rq/R-V3/estado.yml', 'codigo: R-V3\netapa: 3\n');
  const e = cargarEstado(raiz, 'R-V3');
  assert.equal(e.etapa, 2);
  guardarEstado(raiz, e);
  const enDisco = fs.readFileSync(path.join(raiz, 'docs/rq/R-V3/estado.yml'), 'utf8');
  assert.match(enDisco, /^version_ciclo: 4$/m);
  assert.equal(enDisco.includes('_v3'), false);
  const otra = cargarEstado(raiz, 'R-V3');
  assert.equal(otra.etapa, 2, 'no se convierte dos veces');
  assert.equal('_v3' in otra, false);
  guardarEstado(raiz, base());
  assert.equal(cargarEstado(raiz, 'R-T1').version_ciclo, 4);
});

test('estadoCommiteado convierte también un estado.yml v3', () => {
  const raiz = crearRepoTemporal({ archivos: { 'docs/rq/R-V3/estado.yml': 'codigo: R-V3\netapa: 7\n' } });
  const e = estadoCommiteado(raiz, 'R-V3');
  assert.equal(e.etapa, 6);
  assert.equal(e.version_ciclo, 4);
});

test('cerradosConPendientes: cerrado es la etapa 6, también en un estado.yml v3 (etapa 7)', () => {
  const raiz = crearRepoTemporal({});
  escribir(raiz, 'docs/rq/R-V3/estado.yml', 'codigo: R-V3\netapa: 7\npendientes: [x]\n');
  escribir(raiz, 'docs/rq/R-V4/estado.yml', 'codigo: R-V4\nversion_ciclo: 4\netapa: 6\npendientes: [y]\n');
  escribir(raiz, 'docs/rq/R-AB/estado.yml', 'codigo: R-AB\nversion_ciclo: 4\netapa: 5\npendientes: [z]\n');
  assert.deepEqual(cerradosConPendientes(raiz).map((c) => c.codigo).sort(), ['R-V3', 'R-V4']);
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
  const aut = { hasta: 4, frase: 'Autonomía hasta la etapa cuatro', fecha: 'x' };
  const c = ctx(raiz);
  assert.equal(etapaCumplida(null, 1, c), false);
  assert.equal(etapaCumplida(undefined, 1, c), false);
  assert.equal(etapaCumplida('x', 1, c), false);
  assert.equal(etapaCumplida(base({ aprobaciones: { etapa: 1 } }), 1, c), false);
  assert.equal(etapaCumplida(base({ autonomia: aut, codigo: undefined }), 1, c), false);
  assert.equal(etapaCumplida(base({ autonomia: aut }), 1, undefined), false);
  assert.equal(etapaCumplida(base({ autonomia: { ...aut, hasta: 4.5 } }), 2, c), false);
  assert.equal(etapaCumplida(base({ autonomia: aut }), 2, c), true);
  assert.equal(saltoValido(null, 'commit'), false);
  assert.equal(saltoValido(base({ saltos: 'x' }), 'commit'), false);
  assert.equal(aprobacionValida(null), false);
});

test('código inválido: ../x se rechaza en todas las funciones', () => {
  const raiz = crearRepoTemporal({});
  assert.throws(() => cargarEstado(raiz, '../x'), (e) => e.message === 'ESTADO_INVALIDO: ../x: código inválido');
  assert.throws(() => guardarEstado(raiz, base({ codigo: '../x' })), (e) => e.message === 'ESTADO_INVALIDO: ../x: código inválido');
  assert.equal(estadoCommiteado(raiz, '../x'), null);
  const aut = { hasta: 4, frase: 'Autonomía hasta la etapa cuatro', fecha: 'x' };
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
