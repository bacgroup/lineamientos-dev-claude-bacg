// PLG-TEST-INFRA: el commit reintenta una vez la falla que no es un test rojo (infraestructura del runner o timeout),
// anota los inestables y cuenta los rechazos por clase en estado.yml.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado } from '../plugin/scripts/lib/estado.mjs';
import { crearRepoTemporal, sesionDePrueba, fraseDe } from './helpers.mjs';

const SESION = sesionDePrueba();

async function correr(cwd, args, env) {
  let out = '';
  let err = '';
  const frase = fraseDe(args);
  if (frase) SESION.dijo(frase);
  const code = await main(args, {
    cwd,
    home: SESION.home,
    env: { ...process.env, ...SESION.env, ...env },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const SALIDAS = {
  verde: ' Test Files  1 passed (1)\n      Tests  3 passed (3)',
  infra: '      Tests  3 passed (3)\nError: [vitest-worker]: Timeout calling "onTaskUpdate"\n⎯⎯ Unhandled Error ⎯⎯',
  timeout: ' FAIL  src/x.test.ts > caso\nError: Test timed out in 5000ms.\n      Tests  1 failed | 2 passed (3)',
  rojo: ' FAIL  src/x.test.ts > caso\nAssertionError: expected 1 to be 2\n      Tests  1 failed | 2 passed (3)',
};

/**
 * Proyecto cuyo comando de tests responde, corrida a corrida, con las salidas de `modos` (la última se repite).
 * Devuelve el env y una función que dice cuántas veces corrió.
 */
function proyectoCon(...modos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-reint-'));
  fs.mkdirSync(path.join(dir, 'proyectos', 'demo'), { recursive: true });
  const contador = path.join(dir, 'corridas.txt');
  const script = path.join(dir, 'falso.mjs');
  fs.writeFileSync(script, [
    "import fs from 'node:fs';",
    `const c = ${JSON.stringify(contador)};`,
    'const n = fs.existsSync(c) ? Number(fs.readFileSync(c, "utf8")) : 0;',
    'fs.writeFileSync(c, String(n + 1));',
    `const modos = ${JSON.stringify(modos)};`,
    `const salidas = ${JSON.stringify(SALIDAS)};`,
    'const m = modos[Math.min(n, modos.length - 1)];',
    'console.log(salidas[m]);',
    'process.exit(m === "verde" ? 0 : 1);',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'proyectos', 'demo', 'proyecto.yml'), `id: demo\ntests:\n  unit: ${JSON.stringify(`node "${script}"`)}\n`);
  const corridas = () => (fs.existsSync(contador) ? Number(fs.readFileSync(contador, 'utf8')) : 0);
  return { env: { BACG_LINEAMIENTOS_DIR: dir, BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_GH: '1' }, corridas };
}

async function rqAbierto(env) {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  return raiz;
}

test('reintento: falla de infraestructura con todo en verde y después verde → ok, anotado como inestable', async () => {
  const { env, corridas } = proyectoCon('infra', 'verde');
  const raiz = await rqAbierto(env);
  const r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(corridas(), 2);
  assert.match(r.out, /infraestructura/i);
  const t = cargarEstado(raiz, 'R-1').tests;
  assert.equal(t.ok, true);
  assert.equal(t.inestables.length, 1);
  assert.equal(t.inestables[0].clase, 'infraestructura');
  assert.equal(t.rechazos, undefined);
});

test('reintento: infraestructura dos veces → rechaza diciendo que no es de tests y la cuenta', async () => {
  const { env, corridas } = proyectoCon('infra');
  const raiz = await rqAbierto(env);
  const r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 1);
  assert.equal(corridas(), 2);
  assert.match(r.out, /Falla de infraestructura del runner, no de tests/);
  assert.match(r.out, /\{archivos\}/, 'sugiere correr sólo los tests relacionados');
  const t = cargarEstado(raiz, 'R-1').tests;
  assert.equal(t.ok, false);
  assert.deepEqual(t.rechazos, { infraestructura: 1 });
});

test('reintento: timeout y después verde → ok, con el test inestable anotado', async () => {
  const { env, corridas } = proyectoCon('timeout', 'verde');
  const raiz = await rqAbierto(env);
  const r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(corridas(), 2);
  const t = cargarEstado(raiz, 'R-1').tests;
  assert.equal(t.inestables[0].clase, 'timeout');
  assert.deepEqual(t.inestables[0].tests, ['src/x.test.ts > caso']);
});

test('reintento: timeout dos veces → rechaza como timeout', async () => {
  const { env } = proyectoCon('timeout');
  const raiz = await rqAbierto(env);
  const r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 1);
  assert.match(r.out, /superan su tiempo dos veces seguidas/);
  assert.deepEqual(cargarEstado(raiz, 'R-1').tests.rechazos, { timeout: 1 });
});

test('reintento: un test rojo de verdad no se reintenta y los rechazos se acumulan entre corridas', async () => {
  const { env, corridas } = proyectoCon('rojo');
  const raiz = await rqAbierto(env);
  let r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 1);
  assert.equal(corridas(), 1);
  r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(corridas(), 2);
  assert.deepEqual(cargarEstado(raiz, 'R-1').tests.rechazos, { rojo: 2 });
});

test('reintento: BACG_DEV_SIN_REINTENTO=1 lo apaga', async () => {
  const { env, corridas } = proyectoCon('infra', 'verde');
  const raiz = await rqAbierto(env);
  const r = await correr(raiz, ['registrar-tests'], { ...env, BACG_DEV_SIN_REINTENTO: '1' });
  assert.equal(r.code, 1);
  assert.equal(corridas(), 1);
});
