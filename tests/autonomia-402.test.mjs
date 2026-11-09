// 4.0.2: lo que frenaba la autonomía en la prueba de punta a punta del 2026-11-09 (handoff-plugin-4.0.1.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado } from '../plugin/scripts/lib/estado.mjs';
import { evaluarBash } from '../plugin/scripts/lib/compuerta-bash.mjs';
import { lockE2e, firmaE2e, ejecutaE2e } from '../plugin/scripts/lib/e2e-lock.mjs';
import { crearRepoTemporal, sesionDePrueba, fraseDe } from './helpers.mjs';

const SESION = sesionDePrueba();

async function correr(cwd, args, env, { dijo = true } = {}) {
  let out = '';
  let err = '';
  const frase = fraseDe(args);
  if (frase && dijo) SESION.dijo(frase);
  const code = await main(args, {
    cwd,
    home: SESION.home,
    env: { BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', ...SESION.env, ...env },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

function lin(yml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  fs.mkdirSync(path.join(dir, 'proyectos', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proyectos', 'demo', 'proyecto.yml'), `id: demo\n${yml}`);
  return { BACG_LINEAMIENTOS_DIR: dir };
}

const git = (raiz, ...a) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8' });

// ---------- 6: una sola corrida E2E a la vez ----------

const E2E_ARGS = `node -e "require('fs').writeFileSync('e2e-args.txt', process.argv.slice(1).join('|') + '#' + (process.env.BACG_E2E_LOCK||''))" {specs}`;

test('6: verificar no arranca si ya hay otra corrida E2E del proyecto en curso', async () => {
  const env = lin(`tests:\n  e2e: ${JSON.stringify(E2E_ARGS)}\n`);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-6A', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  const lock = lockE2e('demo');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  // Otro proceso vivo (este mismo) tiene el lock.
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, fecha: new Date().toISOString(), que: 'otra', rq: 'R-OTRO', firma: 'e2e.mjs' }));
  try {
    const r = await correr(raiz, ['verificar', '--completo'], env);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /Hay una corrida E2E en curso \(rq\.mjs verificar de R-OTRO/);
    assert.equal(fs.existsSync(path.join(raiz, 'e2e-args.txt')), false, 'no corrió');
    assert.equal(cargarEstado(raiz, 'R-6A').e2e, undefined, 'no registró un E2E rojo falso');
  } finally {
    fs.rmSync(lock, { force: true });
  }
  const r = await correr(raiz, ['verificar', '--completo'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(fs.readFileSync(path.join(raiz, 'e2e-args.txt'), 'utf8'), /#.*e2e-demo\.lock$/, 'el comando recibe BACG_E2E_LOCK');
  assert.equal(fs.existsSync(lock), false, 'verificar suelta el lock al terminar');
});

test('6: la compuerta de Bash niega lanzar el script E2E a mano mientras verificar corre', () => {
  const lock = lockE2e('demo');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, fecha: new Date().toISOString(), que: 'v', rq: 'R-1', firma: 'e2e.mjs' }));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')); // carpeta del workspace, fuera de un repo
  try {
    const r = evaluarBash({ comando: 'node qa/e2e.mjs qa/e2e/pf-ui.spec.ts', cwd, ctx: { textosUsuario: [] } });
    assert.equal(r.decision, 'deny');
    assert.match(r.motivo, /Hay una corrida E2E en curso/);
    assert.equal(evaluarBash({ comando: 'cat qa/e2e.mjs', cwd, ctx: { textosUsuario: [] } }).decision, 'allow');
    assert.equal(evaluarBash({ comando: 'node qa/odoo-test.mjs x', cwd, ctx: { textosUsuario: [] } }).decision, 'allow');
  } finally {
    fs.rmSync(lock, { force: true });
  }
  const cwd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  assert.equal(evaluarBash({ comando: 'node qa/e2e.mjs', cwd: cwd2, ctx: { textosUsuario: [] } }).decision, 'allow');
});

test('6: firma del comando E2E y detección de su ejecución', () => {
  assert.equal(firmaE2e('node "C:/MiCarpeta/Odoo DEVs/PowerFy/qa/e2e.mjs" {specs}'), 'e2e.mjs');
  assert.equal(firmaE2e('npx playwright test {specs}'), 'playwright');
  assert.equal(ejecutaE2e('node "C:/MiCarpeta/Odoo DEVs/PowerFy/qa/e2e.mjs" a.spec.ts', 'e2e.mjs'), true);
  assert.equal(ejecutaE2e('cd x && node qa\\e2e.mjs', 'e2e.mjs'), true);
  assert.equal(ejecutaE2e('grep -n lock qa/e2e.mjs', 'e2e.mjs'), false);
  assert.equal(ejecutaE2e('node qa/e2e-db.mjs', 'e2e.mjs'), false);
  assert.equal(ejecutaE2e('npx playwright test x', 'playwright'), true);
});

// ---------- 7: {specs} sin specs del RQ ----------

test('7: con {specs} y sin specs del RQ en su diff, verificar no corre la suite entera: lo dice y pide la ruta', async () => {
  const env = lin(`tests:\n  e2e: ${JSON.stringify(E2E_ARGS)}\n`);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-7', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  let r = await correr(raiz, ['verificar'], env);
  assert.equal(r.code, 1);
  assert.match(r.err, /no encontré specs E2E del RQ R-7 en su diff/);
  assert.match(r.err, /\$RQ verificar <ruta del spec>/);
  assert.match(r.err, /--completo/);
  assert.equal(fs.existsSync(path.join(raiz, 'e2e-args.txt')), false);
  // Un spec fuera del repo (la carpeta qa/e2e del workspace) se acepta por ruta.
  const fuera = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')), 'pf-ui.spec.ts');
  fs.writeFileSync(fuera, 'x');
  r = await correr(raiz, ['verificar', fuera], env);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(raiz, 'e2e-args.txt'), 'utf8').split('#')[0], fuera.replace(/\\/g, '/'));
  assert.equal(cargarEstado(raiz, 'R-7').e2e.completo, false);
});

// ---------- 1: varias decisiones en un mensaje ----------

test('1: un mensaje con varias decisiones separadas por "+" registra cada una con su tramo', async () => {
  const env = lin('');
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1M', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1M', 'spec.md'), '# R-1M\n\n## Tareas\n\n- [ ] algo\n');
  SESION.dijo('Acotado + Aprobar diseño + Ejecutar en linea + Handoff de problema de plugin para mejora posterior');
  let r = await correr(raiz, ['clasificacion', 'confirmar', 'Acotado'], env, { dijo: false });
  assert.equal(r.code, 0, r.err);
  r = await correr(raiz, ['aprobar', '1', 'Aprobar diseño'], env, { dijo: false });
  assert.equal(r.code, 0, r.err);
  r = await correr(raiz, ['ejecucion', 'inline', 'Ejecutar en linea'], env, { dijo: false });
  assert.equal(r.code, 0, r.err);
  // Cada tramo vale una vez: no se reusa para otro registro.
  r = await correr(raiz, ['aprobar', '4', 'Aprobar diseño'], env, { dijo: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /ya está registrada en el RQ/);
  assert.match(r.err, /varias decisiones/);
  const e = cargarEstado(raiz, 'R-1M');
  assert.equal(e.clasificacion_pendiente, false);
  assert.equal(e.ejecucion.modo, 'inline');
  assert.ok(e.aprobaciones.some((a) => a.etapa === 1));
});

test('1: la compuerta de Bash acepta un tramo corto que es una oración entera, no uno separado por coma', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const textos = ['Acotado + Aprobar diseño + Ejecutar en linea'];
  assert.equal(evaluarBash({ comando: 'node "$RQ" clasificacion confirmar "Acotado"', cwd: raiz, ctx: { textosUsuario: textos } }).decision, 'allow');
  assert.equal(evaluarBash({ comando: 'node "$RQ" aprobar 5 "Dale"', cwd: raiz, ctx: { textosUsuario: ['Dale, pero mañana'] } }).decision, 'deny');
  assert.equal(evaluarBash({ comando: 'node "$RQ" aprobar 5 "Acot"', cwd: raiz, ctx: { textosUsuario: textos } }).decision, 'deny');
});

// ---------- 2: $RQ armado con una variable de shell ----------

test('2: RQ="node …/rq.mjs"; $RQ <sub> "<frase>" con palabras de subcomando dentro de la frase se lee y valida', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const f = 'Acotado + Aprobar diseño + Ejecutar en linea';
  const cmd = `RQ="node C:/x/rq.mjs"; $RQ clasificacion confirmar "${f}"`;
  assert.equal(evaluarBash({ comando: cmd, cwd: raiz, ctx: { textosUsuario: [f] } }).decision, 'allow');
  // La frase igual se valida: si el usuario no la dijo, se niega por la frase (no por ilegible).
  const r = evaluarBash({ comando: cmd, cwd: raiz, ctx: { textosUsuario: ['otra cosa'] } });
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /texto literal del usuario/);
  // Lo ilegible sigue negado: un subcomando con frase que el parser no lee.
  const oculto = `RQ="node C:/x/rq.mjs"; node -e "import('C:/x/rq.mjs')" aprobar 5 "${f}"`;
  assert.equal(evaluarBash({ comando: oculto, cwd: raiz, ctx: { textosUsuario: [f] } }).decision, 'deny');
});

test('2: el mensaje de forma ilegible da una forma que la compuerta acepta (ruta literal o $RQ en el mismo comando)', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const r = evaluarBash({ comando: 'X=/a/rq.mjs; node -e "1" $X aprobar 5 "Dale"', cwd: raiz, ctx: { textosUsuario: ['Dale'] } });
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /node "<ruta>\/rq\.mjs" <subcomando> "<frase>"/);
});
