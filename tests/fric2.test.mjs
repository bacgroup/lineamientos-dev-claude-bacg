// PLG-FRIC2: fricciones del ciclo vistas en R-QA-CI2 (PunAPP), puntos 2.3, 2.4, 2.6 y 2.7.
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
  fs.writeFileSync(script, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(args)}, process.argv.slice(2).join('\\n'));\n`);
  const unit = `node "${script}"${conArchivos ? ' {archivos}' : ''}`;
  const yml = `id: demo\nnombre: Demo\ncuenta_github: orgx\ntests:\n  unit: ${JSON.stringify(unit)}\n${extra}`;
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { '.bacg-dev/proyecto.yml': yml, 'docs/backlog.md': '# Backlog\n\n| Código | Tarea | Prioridad | Estado | Impacto | Link |\n|---|---|---|---|---|---|\n' } });
  const recibidos = () => (fs.existsSync(args) ? fs.readFileSync(args, 'utf8').split('\n').filter(Boolean) : null);
  return { raiz, recibidos };
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

test('2.6: merge-prs-sync: se puede marcar como no aplica con motivo; push: sigue sin poder', async () => {
  const { raiz } = repo({ extra: 'circuito_prod:\n  - { paso: "push:demo" }\n  - { paso: "merge-prs-sync:sede-x" }\n' });
  await abrir(raiz);
  let r = await correr(raiz, ['paso', 'no-aplica', 'merge-prs-sync:sede-x', 'el cambio no viaja a sedes']);
  assert.equal(r.code, 0, r.out + r.err);
  const marca = cargarEstado(raiz, 'R-1').circuito.find((c) => c.paso === 'merge-prs-sync:sede-x');
  assert.equal(marca.no_aplica, true);
  assert.equal(marca.sin_verificar, true, 'sin gh no se pudieron consultar los PR de sync');
  r = await correr(raiz, ['paso', 'no-aplica', 'push:demo', 'x']);
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
