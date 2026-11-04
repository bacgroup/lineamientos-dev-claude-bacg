// RQ multi-repo (PLG-MULTI): un RQ con el mismo código en dos repos del proyecto comparte aprobaciones y skills.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado } from '../plugin/scripts/lib/estado.mjs';
import { reposHermanos } from '../plugin/scripts/lib/multi-repo.mjs';
import { correrHook } from './helpers.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function montar() {
  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-multi-'));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'pf'), { recursive: true });
  fs.writeFileSync(path.join(dirLin, 'proyectos', 'pf', 'proyecto.yml'), [
    'id: pf', 'nombre: PF',
    'repos:', '  - { nombre: pf-addons, rol: addons, push_prod: true }', '  - { nombre: pf-bi, rol: addons, push_prod: true }',
    'entornos: {}', 'circuito_prod:', '  - { paso: "push:pf-addons" }', 'ui: { patrones: [] }', 'sensible: { rutas: [] }', 'tests: {}', '',
  ].join('\n'));
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-multi-'));
  const repo = (nombre, proyecto = 'pf') => {
    const dir = path.join(base, nombre);
    fs.mkdirSync(dir);
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'config', 'user.email', 't@e.com');
    git(dir, 'remote', 'add', 'origin', `https://github.com/org/${nombre}.git`);
    fs.writeFileSync(path.join(dir, '.bacg-lineamientos'), `proyecto: ${proyecto}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'i');
    return dir;
  };
  return { dirLin, base, a: repo('pf-addons'), b: repo('pf-bi'), otro: repo('pf-addons-copia'), ajeno: repo('pf-ajeno', 'otro') };
}

async function rq(cwd, dirLin, args) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    env: { ...process.env, BACG_LINEAMIENTOS_DIR: dirLin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

test('reposHermanos: sólo repos declarados del mismo proyecto, distintos del propio', () => {
  const { a, b } = montar();
  const proyecto = { repos: [{ nombre: 'pf-addons' }, { nombre: 'pf-bi' }] };
  assert.deepEqual(reposHermanos(a, 'pf', proyecto).map((x) => path.basename(x)), ['pf-bi']);
  assert.deepEqual(reposHermanos(a, 'pf', { repos: [] }), [], 'sin repos declarados no se vincula nada');
});

test('abrir en el segundo repo hereda aprobaciones; aprobar después se replica en los dos', async () => {
  const { dirLin, a, b } = montar();
  assert.equal((await rq(a, dirLin, ['abrir', 'PF-X', '--tipo', 'rq', '--clasificacion', 'bounded'])).code, 0);
  assert.equal((await rq(a, dirLin, ['aprobar', '1', 'Diseño aprobado'])).code, 0);
  const r = await rq(b, dirLin, ['abrir', 'PF-X', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /vinculado con pf-addons/);
  assert.deepEqual(cargarEstado(b, 'PF-X').aprobaciones.map((x) => x.frase), ['Diseño aprobado']);

  const r2 = await rq(b, dirLin, ['aprobar', '3', 'Plan ok']);
  assert.match(r2.out, /también en pf-addons/);
  assert.deepEqual(cargarEstado(a, 'PF-X').aprobaciones.map((x) => x.frase), ['Diseño aprobado', 'Plan ok']);
});

test('una skill cargada en un repo queda en el RQ vinculado del otro, sin duplicar', async () => {
  const { dirLin, a, b } = montar();
  await rq(a, dirLin, ['abrir', 'PF-S', '--tipo', 'rq', '--clasificacion', 'bounded']);
  await rq(b, dirLin, ['abrir', 'PF-S', '--tipo', 'rq', '--clasificacion', 'bounded']);
  const entrada = { cwd: a, session_id: 's1', tool_name: 'Skill', tool_input: { skill: 'superpowers:writing-plans' }, tool_response: {} };
  correrHook('post-tool', entrada, { BACG_LINEAMIENTOS_DIR: dirLin });
  correrHook('post-tool', entrada, { BACG_LINEAMIENTOS_DIR: dirLin });
  for (const r of [a, b]) {
    assert.deepEqual(cargarEstado(r, 'PF-S').skills.map((s) => s.skill), ['superpowers:writing-plans'], path.basename(r));
  }
});

test('repos no declarados o de otro proyecto no se vinculan', async () => {
  const { dirLin, a, otro } = montar();
  await rq(a, dirLin, ['abrir', 'PF-N', '--tipo', 'rq', '--clasificacion', 'bounded']);
  await rq(a, dirLin, ['aprobar', '1', 'ok']);
  const r = await rq(otro, dirLin, ['abrir', 'PF-N', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.doesNotMatch(r.out, /vinculado/);
  assert.deepEqual(cargarEstado(otro, 'PF-N').aprobaciones, []);
});

test('PLG-NUBE: {raiz} y {repo:<nombre>} se resuelven en el comando de tests', async () => {
  const { conRutas } = await import('../plugin/scripts/lib/cli.mjs');
  const { a, b } = montar();
  const res = (n) => (n === 'pf-bi' ? b : null);
  assert.equal(conRutas('node "{repo:pf-bi}/qa/t.mjs" --en "{raiz}"', a, res), `node "${b}/qa/t.mjs" --en "${a}"`);
  assert.equal(conRutas('node x.mjs', a, res), 'node x.mjs');
  assert.throws(() => conRutas('node "{repo:pf-docker}/qa/t.mjs"', a, res), /No encuentro el repo pf-docker/);
  assert.equal(conRutas('{raiz}', String.raw`C:\Mi Carpeta\repo`), 'C:/Mi Carpeta/repo');
  assert.throws(() => conRutas('{raiz}', '/tmp/a;rm -rf x'), /sin riesgo/);
});

test('PLG-NUBE: commit corre los tests con la ruta del repo hermano', async () => {
  const { dirLin, a, b } = montar();
  const py = path.join(dirLin, 'proyectos', 'pf', 'proyecto.yml');
  fs.writeFileSync(py, fs.readFileSync(py, 'utf8').replace('tests: {}', 'tests:\n  unit: "node \\"{repo:pf-bi}/qa.mjs\\""'));
  fs.writeFileSync(path.join(b, 'qa.mjs'), 'process.exit(0)\n');
  await rq(a, dirLin, ['abrir', 'PF-T', '--tipo', 'rq', '--clasificacion', 'spike']);
  const r = await rq(a, dirLin, ['registrar-tests']);
  assert.doesNotMatch(r.err, /No encuentro/);
  fs.rmSync(b, { recursive: true, force: true });
  const r2 = await rq(a, dirLin, ['registrar-tests']);
  assert.match(r2.err + r2.out, /No encuentro el repo pf-bi/);
});
