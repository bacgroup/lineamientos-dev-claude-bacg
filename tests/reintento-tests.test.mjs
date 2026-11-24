// PLG-TEST-INFRA: el commit reintenta una vez la falla que no es un test rojo (infraestructura del runner o timeout),
// anota los inestables y cuenta los rechazos por clase en estado.yml.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../plugin/scripts/rq.mjs';
import { execFileSync } from 'node:child_process';
import { cargarEstado, guardarEstado } from '../plugin/scripts/lib/estado.mjs';
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
  rojoViejo: ' FAIL  src/viejo.test.ts > caso\nAssertionError: expected 1 to be 2\n      Tests  1 failed | 2 passed (3)',
};

/**
 * Proyecto cuyo comando de tests responde, corrida a corrida, con las salidas de `modos` (la última se repite).
 * Devuelve el env y una función que dice cuántas veces corrió.
 */
function proyectoCon(...modos) {
  return proyectoConVarios([modos]);
}

/** Igual que proyectoCon, con un comando de tests por lista de modos (tests.unit + tests.integracion…) y yml extra. */
function proyectoConVarios(listas, { extra = '', sufijo = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-reint-'));
  fs.mkdirSync(path.join(dir, 'proyectos', 'demo'), { recursive: true });
  const contadores = listas.map((modos, i) => {
    const contador = path.join(dir, `corridas-${i}.txt`);
    const script = path.join(dir, `falso-${i}.mjs`);
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
    return { contador, cmd: `node "${script}"${sufijo}` };
  });
  const claves = ['unit', 'componentes', 'sql'];
  const tests = contadores.map((c, i) => `  ${claves[i]}: ${JSON.stringify(c.cmd)}`).join('\n');
  fs.writeFileSync(path.join(dir, 'proyectos', 'demo', 'proyecto.yml'), `id: demo\ntests:\n${tests}\n${extra}`);
  const leer = (c) => (fs.existsSync(c) ? Number(fs.readFileSync(c, 'utf8')) : 0);
  const corridas = (i = 0) => leer(contadores[i].contador);
  return { env: { BACG_LINEAMIENTOS_DIR: dir, BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_GH: '1' }, corridas };
}

/** Deja el RQ listo para commitear código: tareas en spec.md y las skills de proceso que exige el primer commit. */
function listoParaDesarrollo(raiz) {
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'spec.md'), '# spec\n\n## Tareas\n\n- [ ] una\n');
  const e = cargarEstado(raiz, 'R-1');
  const skills = ['superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:test-driven-development', 'superpowers:executing-plans'];
  e.skills = [...(e.skills ?? []), ...skills.map((skill) => ({ skill, etapa: 1 }))];
  e.ejecucion = { modo: 'inline', frase: 'en línea', fecha: 'f' };
  guardarEstado(raiz, e);
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

test('cierre: la línea de docs/log/rq.jsonl lleva los rechazos por clase y los tests inestables', async () => {
  const { env } = proyectoCon('rojo', 'timeout', 'verde');
  const raiz = await rqAbierto(env);
  await correr(raiz, ['registrar-tests'], env); // rojo: rechazo
  await correr(raiz, ['registrar-tests'], env); // timeout y después verde: inestable
  const r = await correr(raiz, ['cerrar', '--resumen', 'Listo.'], env);
  assert.equal(r.code, 0, r.out + r.err);
  const linea = JSON.parse(fs.readFileSync(path.join(raiz, 'docs', 'log', 'rq.jsonl'), 'utf8').trim().split('\n').at(-1));
  assert.deepEqual(linea.rechazos_tests, { rojo: 1 });
  assert.equal(linea.tests_inestables.length, 1);
  assert.equal(linea.tests_inestables[0].clase, 'timeout');
});

test('cierre: sin rechazos ni inestables, la línea del log no suma esos campos', async () => {
  const { env } = proyectoCon('verde');
  const raiz = await rqAbierto(env);
  await correr(raiz, ['registrar-tests'], env);
  await correr(raiz, ['cerrar', '--resumen', 'Listo.'], env);
  const linea = JSON.parse(fs.readFileSync(path.join(raiz, 'docs', 'log', 'rq.jsonl'), 'utf8').trim());
  assert.equal('rechazos_tests' in linea, false);
  assert.equal('tests_inestables' in linea, false);
});

// Revisión de PLG-TEST-INFRA.
test('reintento: si el comando ya usa {archivos}, el rechazo no sugiere la pista', async () => {
  const { env } = proyectoConVarios([['infra']], { sufijo: ' {archivos}' });
  const raiz = await rqAbierto(env);
  listoParaDesarrollo(raiz);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  execFileSync('git', ['add', 'src/a.ts'], { cwd: raiz });
  const r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 1);
  assert.match(r.out, /Falla de infraestructura del runner/);
  assert.doesNotMatch(r.out, /Pista: con \{archivos\}/);
});

test('reintento: si el reintento falla sólo con rojos conocidos, cuenta como ok', async () => {
  const { env, corridas } = proyectoConVarios([['timeout', 'rojoViejo']]);
  const yml = path.join(env.BACG_LINEAMIENTOS_DIR, 'proyectos', 'demo', 'proyecto.yml');
  fs.writeFileSync(yml, fs.readFileSync(yml, 'utf8').replace('tests:\n', 'tests:\n  rojos_conocidos: ["src/viejo.test.ts"]\n'));
  const raiz = await rqAbierto(env);
  const r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(corridas(), 2, 'se reintentó');
  const t = cargarEstado(raiz, 'R-1').tests;
  assert.equal(t.ok, true);
  assert.equal(t.inestables[0].clase, 'timeout');
  assert.deepEqual(t.rojos_conocidos, ['src/viejo.test.ts > caso']);
});

test('reintento: con dos comandos, el primero inestable y el segundo rojo → rechazo rojo y el inestable se conserva', async () => {
  const { env, corridas } = proyectoConVarios([['timeout', 'verde'], ['rojo']]);
  const raiz = await rqAbierto(env);
  const r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 1);
  assert.equal(corridas(0), 2);
  assert.equal(corridas(1), 1);
  const t = cargarEstado(raiz, 'R-1').tests;
  assert.deepEqual(t.rechazos, { rojo: 1 });
  assert.equal(t.inestables[0].clase, 'timeout');
});

test('reintento: desde el commit de la CLI, timeout y después verde → el commit se hace y el inestable queda en el estado commiteado', async () => {
  const { env, corridas } = proyectoCon('timeout', 'verde');
  const raiz = await rqAbierto(env);
  listoParaDesarrollo(raiz);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  const r = await correr(raiz, ['commit', 'feat: a', 'src/a.ts'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(corridas(), 2);
  assert.match(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: raiz, encoding: 'utf8' }), /feat\(R-1\): a/);
  const commiteado = execFileSync('git', ['show', 'HEAD:docs/rq/R-1/estado.yml'], { cwd: raiz, encoding: 'utf8' });
  assert.match(commiteado, /inestables:/);
});

test('reintento: la pista del rechazo trae el comando de tests relacionados del runner del repo', async () => {
  const { env } = proyectoCon('infra');
  const raiz = await rqAbierto(env);
  fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }));
  const r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 1);
  assert.match(r.out, /npx vitest related --run \{archivos\}/);
});
