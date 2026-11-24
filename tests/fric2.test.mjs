// PLG-FRIC2: fricciones del ciclo vistas en R-QA-CI2 (PunAPP), puntos 2.3, 2.4, 2.6 y 2.7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado, guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { crearRepoTemporal, sesionDePrueba } from './helpers.mjs';

const SESION = sesionDePrueba();

async function correr(cwd, args, env) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    home: SESION.home,
    env: { ...process.env, ...SESION.env, BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_GH: '1', ...env },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

/** Repo con la configuración en .bacg-dev/; `unit` es el comando de tests (un script que anota sus argumentos). */
function repo({ conArchivos = true, extra = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fric2-'));
  const args = path.join(dir, 'args.txt');
  const script = path.join(dir, 'unit.mjs');
  // Además anota qué versión de src/arreglo.ts vio (para saber si corrió contra el stage o contra el working tree).
  fs.writeFileSync(script, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(args)}, process.argv.slice(2).join('\\n'));\nif (fs.existsSync('src/arreglo.ts')) fs.writeFileSync(${JSON.stringify(args + '.visto')}, fs.readFileSync('src/arreglo.ts', 'utf8'));\n`);
  const unit = `node "${script}"${conArchivos ? ' {archivos}' : ''}`;
  const yml = `id: demo\nnombre: Demo\ncuenta_github: orgx\ntests:\n  unit: ${JSON.stringify(unit)}\n${extra}`;
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { '.bacg-dev/proyecto.yml': yml, 'docs/backlog.md': '# Backlog\n\n| Código | Tarea | Prioridad | Estado | Impacto | Link |\n|---|---|---|---|---|---|\n' } });
  const recibidos = () => (fs.existsSync(args) ? fs.readFileSync(args, 'utf8').split('\n').filter(Boolean) : null);
  const visto = () => (fs.existsSync(`${args}.visto`) ? fs.readFileSync(`${args}.visto`, 'utf8') : null);
  return { raiz, recibidos, visto };
}

const abrir = (raiz, ...extra) => correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded', ...extra]);
const enStage = (raiz) => git(raiz, 'diff', '--cached', '--name-only');

test('2.3: si la compuerta frena el commit, lo que agregó la CLI sale del stage', async () => {
  const { raiz } = repo();
  await abrir(raiz);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  const r = await correr(raiz, ['commit', 'feat: a', 'src/a.ts']);
  assert.equal(r.code, 1, 'sin skills de desarrollo la compuerta frena');
  assert.equal(enStage(raiz), '', 'el stage quedó como estaba');
  assert.match(r.err, /Saqué del stage lo que había agregado: src\/a\.ts/);
});

test('2.3: lo que ya estaba en stage antes del commit frenado se queda', async () => {
  const { raiz } = repo();
  await abrir(raiz);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'previo.ts'), 'x');
  git(raiz, 'add', 'src/previo.ts');
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  await correr(raiz, ['commit', 'feat: a', 'src/a.ts']);
  assert.equal(enStage(raiz), 'src/previo.ts');
});

test('2.4: un commit de sólo tests corre esos tests cuando tests.unit usa {archivos}', async () => {
  const { raiz, recibidos } = repo();
  await abrir(raiz);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.test.ts'), 'x');
  const r = await correr(raiz, ['commit', 'test: a', 'src/a.test.ts']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(recibidos(), ['src/a.test.ts']);
  assert.match(r.out, /tests ok/);
});

test('2.4: sin {archivos}, un commit de sólo tests lo dice y no corre la suite', async () => {
  const { raiz, recibidos } = repo({ conArchivos: false });
  await abrir(raiz);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.test.ts'), 'x');
  const r = await correr(raiz, ['commit', 'test: a', 'src/a.test.ts']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(recibidos(), null);
  assert.match(r.out, /tests\.unit no usa \{archivos\}/);
});

test('2.4: un spec E2E (e2e/) no cuenta como test unitario', async () => {
  const { raiz, recibidos } = repo();
  await abrir(raiz);
  fs.mkdirSync(path.join(raiz, 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'e2e', 'a.spec.ts'), 'x');
  const r = await correr(raiz, ['commit', 'test: e2e', 'e2e/a.spec.ts']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(recibidos(), null);
});

/** `gh` falso en el PATH: responde `salida` (JSON) a cualquier `gh api …`, o sale 1 con `error`. */
function ghEnPath({ salida = '[]', error = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-falso-'));
  const log = path.join(dir, 'llamadas.txt');
  const anotar = `require('fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`;
  const cuerpo = error ? `process.stderr.write(${JSON.stringify(error)}); process.exit(1);` : `process.stdout.write(${JSON.stringify(salida)});`;
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env node\n${anotar}\n${cuerpo}\n`, { mode: 0o755 });
  const env = { PATH: `${dir}${path.delimiter}${process.env.PATH}`, BACG_DEV_SIN_GH: '' };
  Object.defineProperty(env, 'llamadas', { enumerable: false, value: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') });
  return env;
}

const CIRCUITO_SYNC = 'circuito_prod:\n  - { paso: "push:demo" }\n  - { paso: "merge-prs-sync:sede-x" }\n';
function conPushHecho(raiz) {
  const e = cargarEstado(raiz, 'R-1');
  e.circuito = [{ paso: 'push:demo', fecha: '2026-11-24T10:00:00Z' }];
  guardarEstado(raiz, e);
}
const noAplicaSync = (raiz, env) => correr(raiz, ['paso', 'no-aplica', 'merge-prs-sync:sede-x', 'el cambio no viaja a sedes'], env);

test('2.6: merge-prs-sync: no aplica, con el push hecho y sin PR de sync abierto en la sede', async () => {
  const { raiz } = repo({ extra: CIRCUITO_SYNC });
  await abrir(raiz);
  conPushHecho(raiz);
  const gh = ghEnPath({ salida: '[]' });
  const r = await noAplicaSync(raiz, gh);
  assert.equal(r.code, 0, r.out + r.err);
  const marca = cargarEstado(raiz, 'R-1').circuito.find((c) => c.paso === 'merge-prs-sync:sede-x');
  assert.equal(marca.no_aplica, true);
  assert.match(gh.llamadas(), /api repos\/orgx\/sede-x\/pulls\?state=open.*head=orgx%3A/, 'consulta los PR abiertos de la sede, desde la rama de sync');
});

test('2.6: con un PR de sync abierto en la sede, no se puede marcar', async () => {
  const { raiz } = repo({ extra: CIRCUITO_SYNC });
  await abrir(raiz);
  conPushHecho(raiz);
  const r = await noAplicaSync(raiz, ghEnPath({ salida: JSON.stringify([{ number: 3, title: 'sync', user: { login: 'bot' }, head: { ref: 'sync' }, base: { ref: 'main' } }]) }));
  assert.equal(r.code, 1);
  assert.match(r.err, /hay un PR de sync abierto en sede-x/);
});

test('2.6: si no se pueden consultar los PR de sync, falla cerrada', async () => {
  const { raiz } = repo({ extra: CIRCUITO_SYNC });
  await abrir(raiz);
  conPushHecho(raiz);
  let r = await noAplicaSync(raiz, ghEnPath({ error: 'HTTP 404' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /No pude consultar los PR de sync de sede-x/);
  r = await noAplicaSync(raiz, { BACG_DEV_SIN_GH: '1' });
  assert.equal(r.code, 1);
});

test('2.6: antes del push no se puede marcar (el PR de sync lo crea el push)', async () => {
  const { raiz } = repo({ extra: CIRCUITO_SYNC });
  await abrir(raiz);
  const r = await noAplicaSync(raiz, ghEnPath({ salida: '[]' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /primero el push/);
});

test('2.6: push: sigue sin poder marcarse como no aplica', async () => {
  const { raiz } = repo({ extra: CIRCUITO_SYNC });
  await abrir(raiz);
  const r = await correr(raiz, ['paso', 'no-aplica', 'push:demo', 'x']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Un paso push: no se puede marcar como no aplica/);
});

test('2.7: abrir --prioridad e --impacto completa la fila del backlog y el estado', async () => {
  const { raiz } = repo();
  const r = await abrir(raiz, '--tarea', 'Algo', '--prioridad', 'alta', '--impacto', 'Tests · CI');
  assert.equal(r.code, 0, r.out + r.err);
  const e = cargarEstado(raiz, 'R-1');
  assert.equal(e.prioridad, 'Alta');
  assert.equal(e.impacto, 'Tests · CI');
  assert.match(fs.readFileSync(path.join(raiz, 'docs', 'backlog.md'), 'utf8'), /\| R-1 \| Algo \| Alta \| [^|]+ \| Tests · CI \|/);
});

test('2.7: una prioridad fuera de Alta, Media o Baja se rechaza', async () => {
  const { raiz } = repo();
  const r = await abrir(raiz, '--prioridad', 'Urgente');
  assert.equal(r.code, 1);
  assert.match(r.err, /Alta, Media o Baja/);
});

test('2.3: con los tests en rojo, lo que agregó la CLI también sale del stage', async () => {
  const { raiz } = repo({ extra: '' });
  await abrir(raiz);
  const yml = path.join(raiz, '.bacg-dev', 'proyecto.yml');
  fs.writeFileSync(yml, fs.readFileSync(yml, 'utf8').replace(/unit: .*/, 'unit: "node -e process.exit(1) {archivos}"'));
  git(raiz, 'add', '.bacg-dev/proyecto.yml');
  git(raiz, 'commit', '-q', '-m', 'config');
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.test.ts'), 'x');
  const r = await correr(raiz, ['commit', 'test: a', 'src/a.test.ts']);
  assert.notEqual(r.code, 0);
  assert.equal(enStage(raiz), '');
});

test('2.4: el commit de sólo tests deja aparte lo que no está en stage mientras corre', async () => {
  const { raiz, recibidos, visto } = repo();
  await abrir(raiz);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'arreglo.ts'), 'v1');
  git(raiz, 'add', 'src/arreglo.ts');
  git(raiz, 'commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(raiz, 'src', 'arreglo.ts'), 'v2 sin stagear');
  fs.writeFileSync(path.join(raiz, 'src', 'a.test.ts'), 'x');
  const r = await correr(raiz, ['commit', 'test: a', 'src/a.test.ts']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(recibidos(), ['src/a.test.ts']);
  assert.equal(visto(), 'v1', 'los tests corrieron contra lo que va en el commit');
  assert.equal(fs.readFileSync(path.join(raiz, 'src', 'arreglo.ts'), 'utf8'), 'v2 sin stagear', 'el cambio sin stagear vuelve a su lugar');
});

test('2.4: un segundo comando sin {archivos} no corre la suite en un commit de sólo tests', async () => {
  const { raiz, recibidos } = repo({ extra: '' });
  await abrir(raiz);
  const marca = path.join(raiz, '..', `suite-${path.basename(raiz)}.txt`);
  const yml = path.join(raiz, '.bacg-dev', 'proyecto.yml');
  fs.writeFileSync(yml, fs.readFileSync(yml, 'utf8').replace(/(  unit: .*\n)/, `$1  componentes: ${JSON.stringify(`node -e "require('fs').writeFileSync(${JSON.stringify(marca)}, 'x')"`)}\n`));
  git(raiz, 'add', '.bacg-dev/proyecto.yml');
  git(raiz, 'commit', '-q', '-m', 'config');
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.test.ts'), 'x');
  const r = await correr(raiz, ['commit', 'test: a', 'src/a.test.ts']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(recibidos(), ['src/a.test.ts']);
  assert.equal(fs.existsSync(marca), false, 'el comando sin {archivos} no corrió');
});

test('2.7: cerrar completa Prioridad e Impacto desde estado.yml', async () => {
  const { raiz } = repo();
  await abrir(raiz, '--tarea', 'Algo', '--prioridad', 'Media', '--impacto', 'DX');
  const bk = path.join(raiz, 'docs', 'backlog.md');
  fs.writeFileSync(bk, fs.readFileSync(bk, 'utf8').replace(/\| R-1 \| Algo \| Media \| ([^|]+) \| DX \|/, '| R-1 | Algo |  | $1 |  |'));
  const r = await correr(raiz, ['cerrar']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(fs.readFileSync(bk, 'utf8'), /\| R-1 \| Algo \| Media \| [^|]+ \| DX \|/);
});

test('2.7: abrir con --prioridad sobre un RQ que ya existe la guarda', async () => {
  const { raiz } = repo();
  await abrir(raiz);
  await abrir(raiz, '--prioridad', 'baja');
  assert.equal(cargarEstado(raiz, 'R-1').prioridad, 'Baja');
});
