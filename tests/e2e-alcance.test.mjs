// PLG-E2E-ALC: verificar dice si corrió la suite completa y cuánto tardó, cuenta las corridas completas y suma los
// specs de tests.e2e_mapa a los del diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado } from '../plugin/scripts/lib/estado.mjs';
import { crearRepoTemporal, sesionDePrueba } from './helpers.mjs';

const SESION = sesionDePrueba();

async function correr(cwd, args, env) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    home: SESION.home,
    env: { ...process.env, ...SESION.env, ...env },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

/** Proyecto cuyo E2E es un script que anota los specs que recibió en args.txt y sale 0. */
function proyecto({ conSpecs = true, mapa = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-e2e-'));
  fs.mkdirSync(path.join(dir, 'proyectos', 'demo'), { recursive: true });
  const args = path.join(dir, 'args.txt');
  const script = path.join(dir, 'e2e.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(args)}, process.argv.slice(2).join('\\n'));\n`);
  const e2e = `node "${script}"${conSpecs ? ' {specs}' : ''}`;
  const lineas = ['id: demo', 'tests:', '  unit: "node -e 0"', `  e2e: ${JSON.stringify(e2e)}`, '  e2e_chequear_url: false'];
  if (mapa) {
    lineas.push('  e2e_mapa:');
    for (const [glob, specs] of Object.entries(mapa)) lineas.push(`    ${JSON.stringify(glob)}: ${JSON.stringify(specs)}`);
  }
  fs.writeFileSync(path.join(dir, 'proyectos', 'demo', 'proyecto.yml'), `${lineas.join('\n')}\n`);
  const recibidos = () => (fs.existsSync(args) ? fs.readFileSync(args, 'utf8').split('\n').filter(Boolean) : null);
  return { env: { BACG_LINEAMIENTOS_DIR: dir, BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_GH: '1' }, recibidos };
}

async function rqAbierto(env, archivos = {}) {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  return raiz;
}

test('verificar sin {specs}: dice que corrió la suite completa por falta del placeholder y cuánto tardó', async () => {
  const { env } = proyecto({ conSpecs: false });
  const raiz = await rqAbierto(env);
  const r = await correr(raiz, ['verificar'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /suite completa: tests\.e2e no usa \{specs\}/);
  assert.match(r.out, /en \d+(?:m \d+)?s|en \d+ ms/);
});

test('verificar con {specs}: toda corrida dice su duración', async () => {
  const { env } = proyecto();
  const raiz = await rqAbierto(env, { 'e2e/a.spec.ts': 'x' });
  const r = await correr(raiz, ['verificar', 'e2e/a.spec.ts'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /en \d+(?:m \d+)?s|en \d+ ms/);
  assert.doesNotMatch(r.out, /no usa \{specs\}/);
});

test('verificar --completo suma e2e_completos y estado avisa con más de uno antes de la etapa 5', async () => {
  const { env } = proyecto();
  const raiz = await rqAbierto(env);
  await correr(raiz, ['verificar', '--completo'], env);
  assert.equal(cargarEstado(raiz, 'R-1').e2e_completos, 1);
  let r = await correr(raiz, ['estado'], env);
  assert.doesNotMatch(r.out, /suite E2E completa \d+ veces/);
  await correr(raiz, ['verificar', '--completo'], env);
  assert.equal(cargarEstado(raiz, 'R-1').e2e_completos, 2);
  r = await correr(raiz, ['estado'], env);
  assert.match(r.out, /Corriste la suite E2E completa 2 veces: va una sola, justo antes de pedir el OK de PROD/);
});

test('verificar sin {specs} no cuenta e2e_completos (no hay otra forma de correrlo)', async () => {
  const { env } = proyecto({ conSpecs: false });
  const raiz = await rqAbierto(env);
  await correr(raiz, ['verificar'], env);
  await correr(raiz, ['verificar'], env);
  assert.equal(cargarEstado(raiz, 'R-1').e2e_completos, undefined);
});

test('tests.e2e_mapa: los specs de los globs que tocan el RQ se suman a los del diff', async () => {
  const { env, recibidos } = proyecto({ mapa: { 'src/pantallas/**': ['e2e/lista.spec.ts', 'e2e/no-existe.spec.ts'] } });
  const raiz = await rqAbierto(env, { 'e2e/lista.spec.ts': 'x', 'e2e/otra.spec.ts': 'x' });
  fs.mkdirSync(path.join(raiz, 'src', 'pantallas'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'pantallas', 'Lista.tsx'), 'x');
  git(raiz, 'add', 'src/pantallas/Lista.tsx');
  git(raiz, 'commit', '-q', '-m', 'feat(R-1): lista');
  const r = await correr(raiz, ['verificar'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(recibidos(), ['e2e/lista.spec.ts'], 'sólo el del mapa que existe; no la suite ni otros specs');
});

test('sin specs del RQ ni mapa: el error sugiere el spec de la pantalla o el mapa antes que --completo', async () => {
  const { env } = proyecto();
  const raiz = await rqAbierto(env);
  const r = await correr(raiz, ['verificar'], env);
  assert.equal(r.code, 1);
  assert.match(r.err, /spec de la pantalla que tocaste/);
  assert.match(r.err, /tests\.e2e_mapa/);
});
