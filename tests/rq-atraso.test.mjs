// 0.6.1: worktree atrasado, rama integrada, proyecto que no se encuentra, título del spec y cierre sobre un
// changelog existente. Salen de regularizar un RQ atrasado con el plugin 0.6.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado, guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { leerBacklog } from '../plugin/scripts/lib/backlog.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// Copia temporal del fixture: abrir y cerrar escriben el backlog del proyecto (una por test que lo lee).
function copiaLineamientos() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-fixture-'));
  fs.cpSync(path.join(AQUI, 'fixtures', 'lineamientos'), dir, { recursive: true });
  return dir;
}
const DIR_LIN = copiaLineamientos();
const ENV = { BACG_LINEAMIENTOS_DIR: DIR_LIN, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };

async function correr(cwd, args, env = ENV) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const repoDemo = (archivos = {}) => crearRepoTemporal({ proyectoId: 'demo', archivos });
const abrirR1 = (raiz, env = ENV) => correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
const mes = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Repo demo en main con un origin (bare) del que sigue a origin/main.
function repoConOrigen(archivos = {}) {
  const raiz = repoDemo(archivos);
  git(raiz, 'branch', '-M', 'main');
  const origen = path.join(path.dirname(raiz), `origen-${path.basename(raiz)}.git`);
  git(path.dirname(raiz), 'clone', '-q', '--bare', raiz, origen);
  git(raiz, 'remote', 'add', 'origin', origen);
  git(raiz, 'fetch', '-q', 'origin');
  git(raiz, 'branch', '-q', '-u', 'origin/main');
  return { raiz, origen };
}

// Commit en main del origin hecho desde otro clon (otra sesión), y fetch en raiz.
function empujarAMain(raiz, origen, archivos, mensaje = 'otro cambio') {
  const otro = fs.mkdtempSync(path.join(os.tmpdir(), 'otro-clon-'));
  git(otro, 'clone', '-q', origen, '.');
  git(otro, 'config', 'user.name', 'Test');
  git(otro, 'config', 'user.email', 'test@example.com');
  for (const [rel, contenido] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(otro, rel)), { recursive: true });
    fs.writeFileSync(path.join(otro, rel), contenido);
  }
  git(otro, 'add', '-A');
  git(otro, 'commit', '-qm', mensaje);
  git(otro, 'push', '-q', 'origin', 'HEAD:main');
  git(raiz, 'fetch', '-q', 'origin');
}

test('estado: avisa si la rama está detrás del upstream y si el RQ figura cerrado en origin/main', async () => {
  const { raiz, origen } = repoConOrigen();
  await abrirR1(raiz);
  let r = await correr(raiz, ['estado']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /Aviso/, 'al día: sin avisos');
  // En main otra sesión cerró R-1 (etapa 6) y siguió: este checkout quedó atrás, con un ACTIVO local.
  const cerrado = fs.readFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'estado.yml'), 'utf8').replace(/^etapa: 0$/m, 'etapa: 6');
  empujarAMain(raiz, origen, { 'docs/rq/R-1/estado.yml': cerrado, 'b.txt': 'b' });
  r = await correr(raiz, ['estado']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Etapa: 0/);
  assert.match(r.out, /Aviso: la rama está 1 commit\(s\) detrás de origin\/main/);
  assert.match(r.out, /Aviso: en origin\/main el RQ R-1 figura cerrado \(etapa 6\)/);
});

test('entregar: si HEAD ya está en origin/main, dice que la rama está integrada y no pide PR', async () => {
  const { raiz } = repoConOrigen();
  await abrirR1(raiz);
  git(raiz, 'checkout', '-q', '-b', 'rq/R-1');
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'a');
  git(raiz, 'add', 'a.txt');
  git(raiz, 'commit', '-qm', 'feat(R-1): a');
  let r = await correr(raiz, ['entregar']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /integrada/);
  git(raiz, 'push', '-q', 'origin', 'HEAD:main');
  git(raiz, 'fetch', '-q', 'origin');
  r = await correr(raiz, ['entregar']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Rama integrada: HEAD ya está en origin\/main \(merge-base --is-ancestor\); no hace falta PR\./);
  assert.doesNotMatch(r.out, /no hay PR|PR y CI: sin consultar/);
});

test('entregar sin proyecto.yml en el checkout: dice dónde lo buscó y que origin/main sí lo tiene', async () => {
  // Caso real: la configuración pasó a .bacg-dev/ en main y la copia de lineamientos ya no tiene proyecto.yml.
  const env = { BACG_LINEAMIENTOS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'lin-vacio-')), BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };
  const { raiz, origen } = repoConOrigen();
  await abrirR1(raiz, env);
  empujarAMain(raiz, origen, { '.bacg-dev/proyecto.yml': 'id: demo\n' });
  const r = await correr(raiz, ['entregar'], env);
  assert.equal(r.code, 1);
  assert.match(r.err, /El proyecto demo no tiene proyecto\.yml en este checkout \(\.bacg-dev\/proyecto\.yml\) ni en .*proyectos[\\/]demo/);
  assert.match(r.err, /origin\/main sí tiene \.bacg-dev\/proyecto\.yml: la rama está 1 commit\(s\) atrás; actualizala \(git merge origin\/main\)/);
});

test('cerrar sin estado.tarea: toma el título del # de spec.md (y Prioridad/Impacto si los dice) para backlog y changelog', async () => {
  const lin = copiaLineamientos();
  const env = { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  await abrirR1(raiz, env);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'spec.md'), '# R-1 · Aviso que se entienda\n\nPrioridad: Media\n**Impacto:** UX\n');
  const r = await correr(raiz, ['cerrar', '--resumen', 'Listo.'], env);
  assert.equal(r.code, 0, r.err);
  const fila = leerBacklog(lin, 'demo', raiz).find((f) => f['Código'] === 'R-1');
  assert.equal(fila.Tarea, 'Aviso que se entienda');
  assert.equal(fila.Prioridad, 'Media');
  assert.equal(fila.Impacto, 'UX');
  assert.doesNotMatch(r.err, /quedó sin/);
  const cl = fs.readFileSync(path.join(raiz, 'docs', 'log', 'changelog', `${mes()}.md`), 'utf8');
  assert.match(cl, /· R-1 · Aviso que se entienda\n/);
});

test('cerrar: no pisa la Tarea ni la Prioridad vigentes del backlog y avisa lo que quedó vacío', async () => {
  const lin = copiaLineamientos();
  const env = { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--tarea', 'La vigente', '--prioridad', 'Alta'], env);
  const { tarea, ...sinTarea } = cargarEstado(raiz, 'R-1');
  assert.equal(tarea, 'La vigente');
  guardarEstado(raiz, sinTarea);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'spec.md'), '# R-1: Otro título\n');
  const r = await correr(raiz, ['cerrar'], env);
  assert.equal(r.code, 0, r.err);
  assert.equal(cargarEstado(raiz, 'R-1').tarea, 'La vigente', 'la tarea sale de la fila antes que del spec');
  const fila = leerBacklog(lin, 'demo', raiz).find((f) => f['Código'] === 'R-1');
  assert.equal(fila.Tarea, 'La vigente');
  assert.equal(fila.Prioridad, 'Alta');
  assert.match(r.err, /la fila de R-1 en el backlog quedó sin Impacto: completala/);
});

test('cerrar --resumen con una entrada del código en el changelog: no agrega otra; --sin-changelog escribe sólo el log', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  const cl = path.join(raiz, 'docs', 'log', 'changelog', '2026-09.md');
  fs.mkdirSync(path.dirname(cl), { recursive: true });
  fs.writeFileSync(cl, '# Changelog 2026-09\n\n### 2026-09-30 · R-1 · Escrita a mano\n- Qué cambió: algo\n');
  let r = await correr(raiz, ['cerrar', '--resumen', 'Listo.']);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.existsSync(path.join(raiz, 'docs', 'log', 'changelog', `${mes()}.md`)), false);
  assert.match(r.out, /Changelog: ya tenía una entrada de R-1 \(docs\/log\/changelog\/2026-09\.md\): no se agrega otra/);
  assert.equal(fs.readFileSync(path.join(raiz, 'docs', 'log', 'rq.jsonl'), 'utf8').trim().split('\n').length, 1);

  const raiz2 = repoDemo();
  await abrirR1(raiz2);
  r = await correr(raiz2, ['cerrar', '--resumen', 'Listo.', '--sin-changelog']);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.existsSync(path.join(raiz2, 'docs', 'log', 'changelog')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(raiz2, 'docs', 'log', 'rq.jsonl'), 'utf8')).codigo, 'R-1');
  assert.match(r.out, /Changelog: no se escribió \(--sin-changelog\)/);
  assert.match(git(raiz2, 'log', '-1', '--format=%s'), /^docs\(R-1\): cierre/);
});

test('cerrar --resumen: commits y "Dónde" del log son los del código del RQ, no los ajenos que trajo un merge de main', async () => {
  const { raiz, origen } = repoConOrigen({ 'src/a.ts': 'a' });
  await abrirR1(raiz);
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'b');
  git(raiz, 'commit', '-qam', 'feat(R-1): aviso');
  empujarAMain(raiz, origen, { 'lib/ajeno.ts': 'x' }, 'feat(R-10): ajeno');
  git(raiz, 'merge', '-q', '--no-edit', 'origin/main');
  const r = await correr(raiz, ['cerrar', '--resumen', 'Listo.']);
  assert.equal(r.code, 0, r.err);
  const linea = JSON.parse(fs.readFileSync(path.join(raiz, 'docs', 'log', 'rq.jsonl'), 'utf8').trim());
  assert.equal(linea.commits.length, 1, JSON.stringify(linea.commits));
  assert.equal(linea.donde, 'src/a.ts');
});

// ---------- 0.6.2: el diff del RQ no cuenta los commits ajenos que trajo actualizar la rama con main ----------

const MIG_AJENA = 'supabase/migrations/20261027_ajena.sql';

test('desplegar: una migración ajena que llegó por merge o fast-forward de main no cuenta; sql: no aplica se puede marcar', async () => {
  for (const modo of ['merge', 'ff']) {
    const { raiz, origen } = repoConOrigen({ 'src/a.ts': 'a' });
    await abrirR1(raiz);
    if (modo === 'merge') {
      fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'b');
      git(raiz, 'commit', '-qam', 'feat(R-1): aviso');
    }
    empujarAMain(raiz, origen, { [MIG_AJENA]: 'select 1;' }, 'feat(R-10): migración ajena');
    git(raiz, 'merge', '-q', '--no-edit', 'origin/main');
    const r = await correr(raiz, ['desplegar']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Migraciones en el RQ: ninguna\./, `${modo}: ${r.out}`);
    assert.doesNotMatch(r.out, /sql:refprod1/, modo);
    const n = await correr(raiz, ['paso', 'no-aplica', 'sql:refprod1', 'Sin SQL propio']);
    assert.equal(n.code, 0, `${modo}: ${n.err}`);
  }
});

test('desplegar: las migraciones propias siguen contando, sin pushear (aunque no nombren el código) y ya en main (nombrándolo)', async () => {
  const { raiz, origen } = repoConOrigen();
  await abrirR1(raiz);
  fs.mkdirSync(path.join(raiz, 'supabase', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'supabase', 'migrations', 'propia.sql'), 'select 2;');
  git(raiz, 'add', '-A');
  git(raiz, 'commit', '-qm', 'wip');
  empujarAMain(raiz, origen, { [MIG_AJENA]: 'select 1;' }, 'feat(R-10): migración ajena');
  git(raiz, 'merge', '-q', '--no-edit', 'origin/main');
  let r = await correr(raiz, ['desplegar']);
  assert.match(r.out, /Migraciones en el RQ: supabase\/migrations\/propia\.sql\./, r.out);

  // Publicada en main: cuenta porque nombra el código (después del push el upstream ya la tiene).
  const { raiz: raiz2, origen: origen2 } = repoConOrigen();
  await abrirR1(raiz2);
  fs.mkdirSync(path.join(raiz2, 'supabase', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(raiz2, 'supabase', 'migrations', 'propia.sql'), 'select 2;');
  git(raiz2, 'add', '-A');
  git(raiz2, 'commit', '-qm', 'feat(R-1): migración');
  git(raiz2, 'push', '-q', 'origin', 'HEAD:main');
  empujarAMain(raiz2, origen2, { [MIG_AJENA]: 'select 1;' }, 'feat(R-10): migración ajena');
  git(raiz2, 'merge', '-q', '--ff-only', 'origin/main');
  r = await correr(raiz2, ['desplegar']);
  assert.match(r.out, /Migraciones en el RQ: supabase\/migrations\/propia\.sql\./, r.out);
  const n = await correr(raiz2, ['paso', 'no-aplica', 'sql:refprod1', 'x']);
  assert.equal(n.code, 1);
  assert.match(n.err, /el cambio trae supabase\/migrations\/propia\.sql/);

  // Publicada en main sin nombrar el código: cuenta porque se creó en este checkout (reflog)…
  const { raiz: raiz3, origen: origen3 } = repoConOrigen();
  await abrirR1(raiz3);
  fs.mkdirSync(path.join(raiz3, 'supabase', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(raiz3, 'supabase', 'migrations', 'propia.sql'), 'select 2;');
  git(raiz3, 'add', '-A');
  git(raiz3, 'commit', '-qm', 'wip');
  git(raiz3, 'push', '-q', 'origin', 'HEAD:main');
  empujarAMain(raiz3, origen3, { [MIG_AJENA]: 'select 1;' }, 'feat(R-10): migración ajena');
  git(raiz3, 'merge', '-q', '--ff-only', 'origin/main');
  r = await correr(raiz3, ['desplegar']);
  assert.match(r.out, /Migraciones en el RQ: supabase\/migrations\/propia\.sql\./, r.out);

  // …y en un clon nuevo (sin ese reflog) la migración que no nombra el código ya no se distingue de una ajena,
  // pero la de un commit que lo nombra sí cuenta.
  const clon = fs.mkdtempSync(path.join(os.tmpdir(), 'clon-nuevo-'));
  git(clon, 'clone', '-q', origen2, '.');
  fs.writeFileSync(path.join(clon, '.bacg-lineamientos'), 'proyecto: demo\n');
  guardarEstado(clon, cargarEstado(raiz2, 'R-1'));
  fs.writeFileSync(path.join(clon, 'docs', 'rq', 'ACTIVO'), 'R-1\n');
  r = await correr(clon, ['desplegar']);
  assert.match(r.out, /Migraciones en el RQ: supabase\/migrations\/propia\.sql\./, r.out);
});
