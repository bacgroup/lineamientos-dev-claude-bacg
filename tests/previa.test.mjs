// PLG-PREVIA: validación previa a un RQ (fetch, atraso contra la rama de DEV, trabajo en paralelo, backlog remoto)
// y confirmación del proyecto (repo declarado en dos proyectos).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../plugin/scripts/rq.mjs';
import { validacionPrevia, ramaDev, modulosDe } from '../plugin/scripts/lib/previa.mjs';
import { buscarRepo } from '../plugin/scripts/lib/config.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function identidad(dir) {
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

function escribir(dir, archivos) {
  for (const [rel, contenido] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), contenido);
  }
}

// Origin (bare) con main y dev; la sesión es un clon en dev con el marcador del proyecto (sin commitear).
function montar() {
  const base = tmp('previa-');
  const semilla = path.join(base, 'semilla');
  fs.mkdirSync(semilla);
  git(semilla, 'init', '-q', '-b', 'main');
  identidad(semilla);
  escribir(semilla, { 'a.txt': 'a' });
  git(semilla, 'add', '-A');
  git(semilla, 'commit', '-qm', 'inicial');
  git(semilla, 'branch', 'dev');
  const origen = path.join(base, 'demo-app.git');
  git(base, 'clone', '-q', '--bare', semilla, origen);
  const raiz = path.join(base, 'demo-app');
  git(base, 'clone', '-q', '-b', 'dev', origen, raiz);
  identidad(raiz);
  fs.writeFileSync(path.join(raiz, '.bacg-lineamientos'), 'proyecto: demo\n');
  fs.appendFileSync(path.join(raiz, '.git', 'info', 'exclude'), '.bacg-lineamientos\n');
  // Otro dev: un clon aparte que pushea.
  const otro = path.join(base, 'otro');
  git(base, 'clone', '-q', origen, otro);
  identidad(otro);
  const pushear = (rama, archivos, mensaje = 'cambio') => {
    git(otro, 'checkout', '-q', '-B', rama, 'origin/dev');
    escribir(otro, archivos);
    git(otro, 'add', '-A');
    git(otro, 'commit', '-qm', mensaje);
    git(otro, 'push', '-q', 'origin', `HEAD:${rama}`);
  };
  return { raiz, origen, otro, pushear };
}

// Copia de lineamientos como clon de git con el backlog del proyecto en su upstream.
function lineamientosConBacklog(filas) {
  const base = tmp('lin-previa-');
  const semilla = path.join(base, 'semilla');
  fs.mkdirSync(semilla);
  git(semilla, 'init', '-q', '-b', 'main');
  identidad(semilla);
  escribir(semilla, {
    'proyectos/demo/proyecto.yml': 'id: demo\nnombre: Demo\nrepos:\n  - { nombre: demo-app }\nentornos:\n  dev: { tipo: rama, rama: dev }\n',
    'proyectos/demo/backlog.md': `| Código | Tarea | Prioridad | Estado | Impacto | Link |\n|---|---|---|---|---|---|\n${filas.join('\n')}\n`,
  });
  git(semilla, 'add', '-A');
  git(semilla, 'commit', '-qm', 'inicial');
  const dirLin = path.join(base, 'lin');
  git(base, 'clone', '-q', semilla, dirLin);
  return { dirLin, semilla };
}

const PROYECTO = { id: 'demo', nombre: 'Demo', repos: [{ nombre: 'demo-app' }], entornos: { dev: { tipo: 'rama', rama: 'dev' } } };
const ENV = { ...process.env, BACG_DEV_SIN_GH: '1' };

test('ramaDev: rama_dev del repo, entornos.dev.rama, ramas_solo_pr; null sin nada', () => {
  assert.equal(ramaDev({ entornos: { dev: { tipo: 'rama', rama: '18.0-dev' } } }, null), '18.0-dev');
  assert.equal(ramaDev({ entornos: { dev: { tipo: 'url', rama: 'x' } }, ramas_solo_pr: ['dev'] }, null), 'dev');
  assert.equal(ramaDev({ entornos: { dev: { rama: 'a' } } }, { rama_dev: 'b' }), 'b');
  assert.equal(ramaDev({}, null), null);
});

test('modulosDe: primer segmento, sin repetir, con tope', () => {
  assert.deepEqual(modulosDe([{ path: 'mod_a/models/x.py' }, { path: 'mod_a/views/y.xml' }, { path: 'mod_b/__init__.py' }]), ['mod_a', 'mod_b']);
  assert.deepEqual(modulosDe(['a/1', 'b/1', 'c/1'], 2), ['a', 'b', '+1']);
});

test('previa: dice el proyecto, trae origin y avisa el atraso contra la rama de DEV', () => {
  const { raiz, pushear } = montar();
  pushear('dev', { 'b.txt': 'b' });
  const { lineas, bloqueos } = validacionPrevia({ repo: { raiz, proyectoId: 'demo' }, proyecto: PROYECTO, codigo: 'R-1', env: ENV, dirLin: tmp('lin-vacio-') });
  const t = lineas.join('\n');
  assert.match(t, /Proyecto: demo \(Demo\) · repo demo-app · detectado por el marcador del repo/);
  assert.match(t, /demo-app \(dev\): 1 commit\(s\) detrás de origin\/dev/);
  assert.match(t, /Backlog remoto: la copia de lineamientos no es un clon de git/);
  assert.deepEqual(bloqueos, []);
});

test('previa: lista ramas en paralelo y bloquea un RQ nuevo si una rama nombra el código (no si se retoma)', () => {
  const { raiz, pushear } = montar();
  pushear('rq/R-9', { 'mod/x.py': 'x' }, 'feat(R-9): x');
  pushear('rq/R-10', { 'mod/y.py': 'y' }, 'feat(R-10): y');
  const correr = (codigo, nuevo) => validacionPrevia({ repo: { raiz, proyectoId: 'demo' }, proyecto: PROYECTO, codigo, nuevo, env: ENV, dirLin: tmp('lin-vacio-') });
  let r = correr('R-9', true);
  assert.match(r.lineas.join('\n'), /rama rq\/R-9 · Test · \d{4}-\d\d-\d\d · 1 commit\(s\) que dev no tiene/);
  assert.match(r.lineas.join('\n'), /rama rq\/R-10/);
  assert.equal(r.bloqueos.length, 1);
  assert.match(r.bloqueos[0], /ya existe la rama origin\/rq\/R-9/);
  r = correr('R-9', false);
  assert.deepEqual(r.bloqueos, [], 'retomar no bloquea');
  r = correr('R-1', true);
  assert.deepEqual(r.bloqueos, [], 'R-1 no lo nombra ninguna rama (R-10 no es R-1)');
});

test('previa: ignora ramas ya integradas en DEV y las de PROD', () => {
  const { raiz, otro, pushear } = montar();
  pushear('rq/R-3', { 'z.txt': 'z' });
  git(otro, 'push', '-q', 'origin', 'HEAD:dev');
  const { lineas } = validacionPrevia({ repo: { raiz, proyectoId: 'demo' }, proyecto: { ...PROYECTO, ramas_prod: ['main'] }, codigo: 'R-4', env: ENV, dirLin: tmp('lin-vacio-') });
  const t = lineas.join('\n');
  assert.doesNotMatch(t, /rama main/);
  assert.match(t, /Trabajo en paralelo: ninguna rama ni PR/);
});

test('previa: PR abiertos contra DEV con sus módulos; bloquea si el PR nombra el código', () => {
  const { raiz } = montar();
  const llamadas = [];
  const gh = (args) => {
    llamadas.push(args);
    return { datos: [{ number: 7, title: 'feat(R-7): algo', author: { login: 'ana' }, headRefName: 'feature-x', files: [{ path: 'mod_a/models/a.py' }, { path: 'mod_b/views/b.xml' }] }] };
  };
  const proyecto = { ...PROYECTO, cuenta_github: 'OrgX' };
  const { lineas, bloqueos } = validacionPrevia({ repo: { raiz, proyectoId: 'demo' }, proyecto, codigo: 'R-7', env: { ...process.env }, dirLin: tmp('lin-vacio-'), gh });
  assert.deepEqual(llamadas[0].slice(0, 6), ['pr', 'list', '-R', 'OrgX/demo-app', '--base', 'dev']);
  assert.match(lineas.join('\n'), /PR #7 feat\(R-7\): algo · ana · feature-x · toca mod_a, mod_b/);
  assert.match(bloqueos.join('\n'), /PR abierto del código: #7 \(ana\)/);
});

test('previa: backlog remoto (upstream de la copia de lineamientos), atraso de la copia y otras filas En curso', () => {
  const { raiz } = montar();
  const { dirLin, semilla } = lineamientosConBacklog([
    '| R-5 | Algo de otro | Alta | En curso | x | docs/rq/R-5/ |',
    '| R-6 | Hecho viejo | Baja | Hecho 01/11/2026 | x | |',
  ]);
  // Commit nuevo en el upstream que la copia no tiene: suma R-8 En curso.
  fs.appendFileSync(path.join(semilla, 'proyectos/demo/backlog.md'), '| R-8 | Lo de Juan | Media | En curso | x | |\n');
  git(semilla, 'commit', '-qam', 'R-8');
  const correr = (codigo) => validacionPrevia({ repo: { raiz, proyectoId: 'demo' }, proyecto: PROYECTO, codigo, env: ENV, dirLin });
  let r = correr('R-5');
  const t = r.lineas.join('\n');
  assert.match(t, /tu copia de lineamientos está 1 commit\(s\) atrás/);
  assert.match(t, /Backlog remoto: R-5 figura "En curso"/);
  assert.match(t, /- R-8: Lo de Juan/);
  assert.match(r.bloqueos.join('\n'), /R-5 ya figura "En curso" en el backlog remoto/);
  r = correr('R-6');
  assert.match(r.bloqueos.join('\n'), /R-6 ya figura "Hecho 01\/11\/2026"/);
  r = correr('R-11');
  assert.match(r.lineas.join('\n'), /R-11 no figura \(código libre\)/);
  assert.deepEqual(r.bloqueos, []);
});

async function correrCli(cwd, args, env) {
  let out = '';
  let err = '';
  const code = await main(args, { cwd, env: { ...process.env, ...env }, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } });
  return { code, out, err };
}

test('abrir: corre la previa, frena un código tomado y --sin-previa lo deja pasar', async () => {
  const { raiz, pushear } = montar();
  pushear('rq/R-2', { 'q.txt': 'q' });
  const { dirLin } = lineamientosConBacklog([]);
  const env = { BACG_LINEAMIENTOS_DIR: dirLin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_PREVIA: '' };
  let r = await correrCli(raiz, ['abrir', 'R-2', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  assert.equal(r.code, 1);
  assert.match(r.out, /Validación previa:\nProyecto: demo/);
  assert.match(r.err, /No abro R-2: parece que ya se está trabajando\.\n- en demo-app ya existe la rama origin\/rq\/R-2/);
  assert.equal(fs.existsSync(path.join(raiz, 'docs', 'rq', 'R-2', 'estado.yml')), false);
  r = await correrCli(raiz, ['abrir', 'R-2', '--tipo', 'rq', '--clasificacion', 'bounded', '--sin-previa'], env);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /Validación previa/);
  assert.match(r.out, /RQ R-2 abierto/);
});

test('previa (subcomando): muestra el informe y sale 1 si el código está tomado', async () => {
  const { raiz, pushear } = montar();
  pushear('rq/R-12', { 'w.txt': 'w' });
  const { dirLin } = lineamientosConBacklog([]);
  const env = { BACG_LINEAMIENTOS_DIR: dirLin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_PREVIA: '' };
  let r = await correrCli(raiz, ['previa'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /rama rq\/R-12/);
  r = await correrCli(raiz, ['previa', 'R-12'], env);
  assert.equal(r.code, 1);
  assert.match(r.out, /No abro R-12/);
});

test('repo declarado en dos proyectos: buscarRepo lo marca ambiguo y abrir pide confirmar el proyecto', async () => {
  const dirLin = tmp('lin-ambiguo-');
  for (const id of ['uno', 'dos']) {
    escribir(dirLin, { [`proyectos/${id}/proyecto.yml`]: `id: ${id}\ncuenta_github: OrgX\nrepos:\n  - { nombre: compartido }\n` });
  }
  const raiz = path.join(tmp('ws-ambiguo-'), 'compartido');
  fs.mkdirSync(raiz);
  git(raiz, 'init', '-q');
  identidad(raiz);
  git(raiz, 'remote', 'add', 'origin', 'https://github.com/orgx/compartido.git');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'inicial');
  const repo = buscarRepo(raiz, { dirLin });
  assert.deepEqual(repo.ambiguos, ['dos', 'uno']);
  for (const sinPrevia of ['', '1']) {
    const r = await correrCli(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], { BACG_LINEAMIENTOS_DIR: dirLin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_PREVIA: sinPrevia });
    assert.equal(r.code, 1, `con BACG_DEV_SIN_PREVIA="${sinPrevia}"`);
    assert.match(r.err, /figura en varios proyectos \(dos, uno\)/);
  }
});
