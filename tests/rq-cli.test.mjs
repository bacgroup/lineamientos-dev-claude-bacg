import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, bloquesHandoff } from '../plugin/scripts/rq.mjs';
import { cargarEstado, rqActivo, rqsActivos, guardarEstado as guardarEstadoTest } from '../plugin/scripts/lib/estado.mjs';
import { leerBacklog } from '../plugin/scripts/lib/backlog.mjs';
import { crearRepoTemporal, sesionDePrueba, fraseDe } from './helpers.mjs';
import { arbolTesteado } from '../plugin/scripts/lib/arbol.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// Copia temporal del fixture: abrir y cerrar escriben el backlog del proyecto.
const DIR_LIN = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-fixture-'));
fs.cpSync(path.join(AQUI, 'fixtures', 'lineamientos'), DIR_LIN, { recursive: true });
const SCRIPT = path.resolve(AQUI, '..', 'plugin', 'scripts', 'rq.mjs');

// En estos tests el usuario escribió en la sesión la frase que se registra; la verificación en sí la prueba
// tests/frase-cli.test.mjs.
const SESION = sesionDePrueba();

async function correr(cwd, args, env = { BACG_LINEAMIENTOS_DIR: DIR_LIN, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' }) {
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

const repoDemo = (archivos = {}) => crearRepoTemporal({ proyectoId: 'demo', archivos });
const abrirR1 = (raiz) => correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);

// Etapa 2 v4 de un Acotado: brainstorming registrado, ## Tareas en spec.md y la ejecución elegida por el usuario.
function listoParaDesarrollo(raiz, codigo = 'R-1') {
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', codigo), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), '# spec\n\n## Tareas\n\n- [ ] una\n');
  const e = cargarEstado(raiz, codigo);
  e.skills = [...(e.skills ?? []), { skill: 'superpowers:brainstorming', etapa: 1 }];
  e.ejecucion = { modo: 'inline', frase: 'en línea', fecha: 'f' };
  guardarEstadoTest(raiz, e);
}

// Lineamientos temporal con un proyecto cuyos tests son los comandos dados.
function lineamientosCon(tests) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  const p = path.join(dir, 'proyectos', 'demo');
  fs.mkdirSync(p, { recursive: true });
  const lineas = Object.entries(tests).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`);
  fs.writeFileSync(path.join(p, 'proyecto.yml'), `id: demo\ntests:\n${lineas.join('\n')}\n`);
  return dir;
}

test('abrir: crea estado.yml y ACTIVO, sin relevo', async () => {
  const raiz = repoDemo();
  const r = await abrirR1(raiz);
  assert.equal(r.code, 0);
  assert.match(r.out, /RQ R-1 abierto\./);
  const e = cargarEstado(raiz, 'R-1');
  assert.deepEqual(
    { c: e.codigo, t: e.tipo, cl: e.clasificacion, et: e.etapa, au: e.autonomia, ap: e.aprobaciones, te: e.tests, re: e.revision, ci: e.circuito, sa: e.saltos },
    { c: 'R-1', t: 'rq', cl: 'bounded', et: 0, au: null, ap: [], te: null, re: null, ci: [], sa: [] },
  );
  assert.equal(rqActivo(raiz), 'R-1');
  assert.equal(fs.existsSync(path.join(raiz, 'docs', 'rq', 'R-1', 'relevo.md')), false);
});

test('abrir dos veces no pisa estado y dice retomado', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  await correr(raiz, ['aprobar', '1', 'Spec aprobada']);
  await correr(raiz, ['etapa', '2']);
  fs.rmSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'));
  const r = await abrirR1(raiz);
  assert.equal(r.code, 0);
  assert.match(r.out, /RQ R-1 retomado \(etapa 2\)\./);
  const e = cargarEstado(raiz, 'R-1');
  assert.equal(e.etapa, 2);
  assert.equal(e.aprobaciones.length, 1);
  assert.equal(rqActivo(raiz), 'R-1');
});

test('abrir valida tipo, clasificación y código', async () => {
  const raiz = repoDemo();
  for (const args of [
    ['abrir', 'R-1', '--tipo', 'otro', '--clasificacion', 'bounded'],
    ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'enorme'],
    ['abrir', '../x', '--tipo', 'rq', '--clasificacion', 'bounded'],
    ['abrir', 'R-1', '--tipo', 'rq'],
  ]) {
    const r = await correr(raiz, args);
    assert.notEqual(r.code, 0, args.join(' '));
    assert.ok(r.err.length > 0);
  }
  assert.equal(rqActivo(raiz), null);
});

test('fuera de un repo con .bacg-lineamientos sale 1', async () => {
  const sin = fs.mkdtempSync(path.join(os.tmpdir(), 'sin-'));
  const r = await correr(sin, ['estado']);
  assert.equal(r.code, 1);
  assert.match(r.err, /No es un repo de un proyecto registrado .*rq\.mjs alta/);
});

test('sin RQ activo los subcomandos de estado fallan con exit 1', async () => {
  const raiz = repoDemo();
  for (const args of [['etapa', '1'], ['aprobar', '1', 'x'], ['autonomia', '3', 'x'], ['saltar', 'commit', 'x', 'm'], ['revision', 'ok', 'n'], ['cerrar']]) {
    const r = await correr(raiz, args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, /No hay RQ activo: corré rq\.mjs abrir <código> …/);
  }
  // estado sin RQ activo no falla: lo dice y lista los cerrados con pendientes.
  const r = await correr(raiz, ['estado']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /RQ activo: ninguno\./);
});

test('etapa: actualiza y valida 0-6 entero', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  assert.equal((await correr(raiz, ['etapa', '3'])).code, 0);
  assert.equal(cargarEstado(raiz, 'R-1').etapa, 3);
  for (const n of ['7', '8', '-1', '1.5', 'x']) {
    assert.equal((await correr(raiz, ['etapa', n])).code, 1, n);
  }
  assert.equal(cargarEstado(raiz, 'R-1').etapa, 3);
});

test('aprobar 1 "Spec aprobada" deja la aprobación; valida etapa y frase', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['aprobar', '1', 'Spec aprobada']);
  assert.equal(r.code, 0);
  const a = cargarEstado(raiz, 'R-1').aprobaciones;
  assert.equal(a.length, 1);
  assert.equal(a[0].etapa, 1);
  assert.equal(a[0].frase, 'Spec aprobada');
  assert.ok(!Number.isNaN(Date.parse(a[0].fecha)));
  assert.equal((await correr(raiz, ['aprobar', '9', 'x'])).code, 1);
  assert.equal((await correr(raiz, ['aprobar', '7', 'x'])).code, 1);
  assert.equal((await correr(raiz, ['aprobar', '1', ''])).code, 1);
  assert.equal((await correr(raiz, ['aprobar', '1', '   '])).code, 1);
  assert.equal(cargarEstado(raiz, 'R-1').aprobaciones.length, 1);
});

test('autonomia: hasta 1-4, nunca 5 o más', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['autonomia', '4', 'Dale, hasta el final']);
  assert.equal(r.code, 0);
  const au = cargarEstado(raiz, 'R-1').autonomia;
  assert.equal(au.hasta, 4);
  assert.equal(au.frase, 'Dale, hasta el final');
  assert.ok(au.fecha);
  for (const n of ['5', '6', '7', '0', 'x']) {
    assert.equal((await correr(raiz, ['autonomia', n, 'f'])).code, 1, n);
  }
  assert.equal((await correr(raiz, ['autonomia', '3', ''])).code, 1);
  assert.equal(cargarEstado(raiz, 'R-1').autonomia.hasta, 4);
});

test('saltar: compuerta válida con frase y motivo', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['saltar', 'commit', 'Saltá el commit', 'urgente']);
  assert.equal(r.code, 0);
  const s = cargarEstado(raiz, 'R-1').saltos;
  assert.equal(s.length, 1);
  assert.deepEqual({ c: s[0].compuerta, f: s[0].frase, m: s[0].motivo }, { c: 'commit', f: 'Saltá el commit', m: 'urgente' });
  assert.ok(s[0].fecha);
  assert.equal((await correr(raiz, ['saltar', 'deploy', 'f', 'm'])).code, 1);
  assert.equal((await correr(raiz, ['saltar', 'push', '', 'm'])).code, 1);
  assert.equal((await correr(raiz, ['saltar', 'push', 'f', ''])).code, 1);
  assert.equal(cargarEstado(raiz, 'R-1').saltos.length, 1);
});

test('revision ok|bloqueante guarda ok true/false con nota', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  listoParaDesarrollo(raiz);
  let r = await correr(raiz, ['revision', 'ok', 'sin bloqueantes']);
  assert.equal(r.code, 1, 'sin test-driven-development no hay revisión ok');
  assert.match(r.err, /falta: superpowers:test-driven-development/);
  assert.equal((await correr(raiz, ['saltar', 'skills', 'sin TDD', 'prueba'])).code, 0);
  assert.equal((await correr(raiz, ['revision', 'ok', 'sin bloqueantes'])).code, 0);
  let rev = cargarEstado(raiz, 'R-1').revision;
  assert.deepEqual({ ok: rev.ok, nota: rev.nota }, { ok: true, nota: 'sin bloqueantes' });
  assert.ok(rev.fecha);
  assert.equal((await correr(raiz, ['revision', 'bloqueante', 'falta X'])).code, 0);
  rev = cargarEstado(raiz, 'R-1').revision;
  assert.deepEqual({ ok: rev.ok, nota: rev.nota }, { ok: false, nota: 'falta X' });
  assert.equal((await correr(raiz, ['revision', 'quizas', 'n'])).code, 1);
});

test('registrar-tests: comando que sale 0 → ok true y árbol = git write-tree', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  const arbol = execFileSync('git', ['write-tree'], { cwd: raiz, encoding: 'utf8' }).trim();
  const r = await correr(raiz, ['registrar-tests']);
  assert.equal(r.code, 0);
  const t = cargarEstado(raiz, 'R-1').tests;
  assert.equal(t.ok, true);
  assert.equal(t.arbol, arbol);
  assert.deepEqual(t.comandos, ['node -e "process.exit(0)"']);
  assert.ok(t.fecha);
});

test('registrar-tests: comando que sale 1 → ok false y exit 1; corta en el primer fallo y respeta el orden', async () => {
  const lin = lineamientosCon({
    e2e: 'node -e "process.exit(0)"',
    sql: 'node -e "process.exit(0)"',
    componentes: 'node -e "process.exit(3)"',
    unit: 'node -e "process.exit(0)"',
  });
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['registrar-tests'], { BACG_LINEAMIENTOS_DIR: lin });
  assert.equal(r.code, 3);
  const t = cargarEstado(raiz, 'R-1').tests;
  assert.equal(t.ok, false);
  assert.deepEqual(t.comandos, ['node -e "process.exit(0)"', 'node -e "process.exit(3)"']);
});

test('registrar-tests: falla con exit 1 si el comando falla con 1', async () => {
  const lin = lineamientosCon({ unit: 'node -e "process.exit(1)"' });
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['registrar-tests'], { BACG_LINEAMIENTOS_DIR: lin });
  assert.equal(r.code, 1);
  assert.equal(cargarEstado(raiz, 'R-1').tests.ok, false);
});

test('registrar-tests: sin comandos definidos sale 1 con mensaje', async () => {
  const lin = lineamientosCon({ unit: '' });
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['registrar-tests'], { BACG_LINEAMIENTOS_DIR: lin });
  assert.equal(r.code, 1);
  assert.match(r.err, /El proyecto no declara comandos de tests en proyecto\.yml\./);
  // M8: sugiere el salto de commit con las palabras del usuario
  assert.ok(
    r.err.includes('Si el proyecto todavía no tiene tests, pedile al usuario que autorice `rq.mjs saltar commit "<sus palabras>" "sin tests todavía"`.'),
    r.err,
  );
  assert.equal(cargarEstado(raiz, 'R-1').tests, null);
});

test('estado imprime código, tipo, clasificación, etapa, aprobaciones, autonomía, tests, revisión y circuito', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  await correr(raiz, ['aprobar', '1', 'Spec aprobada']);
  await correr(raiz, ['revision', 'ok', 'bien']);
  await correr(raiz, ['registrar-tests']);
  const r = await correr(raiz, ['estado']);
  assert.equal(r.code, 0);
  assert.match(r.out, /R-1/);
  assert.match(r.out, /rq/);
  assert.match(r.out, /Clasificación: Acotado \(pendiente de confirmar\)/);
  assert.match(r.out, /1: Spec aprobada/);
  assert.match(r.out, /tests.*ok/i);
  assert.match(r.out, /revisi/i);
  assert.match(r.out, /circuito/i);
});

test('cerrar: etapa 6 y borra ACTIVO', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['cerrar']);
  assert.equal(r.code, 0);
  assert.match(r.out, /RQ R-1 cerrado\./);
  assert.equal(cargarEstado(raiz, 'R-1').etapa, 6);
  assert.equal(rqActivo(raiz), null);
  assert.equal(fs.existsSync(path.join(raiz, 'docs', 'rq', 'ACTIVO')), false);
});

test('subcomando desconocido o faltante sale 2 con uso', async () => {
  const raiz = repoDemo();
  for (const args of [[], ['nada'], ['aprobar', '1'], ['saltar', 'commit', 'f'], ['etapa'], ['revision', 'ok'], ['paso']]) {
    const r = await correr(raiz, args);
    assert.equal(r.code, 2, args.join(' '));
    // Sin subcomando conocido, el uso completo; con uno, sólo su sintaxis.
    const esperados = args.length === 0 || args[0] === 'nada'
      ? ['abrir', 'etapa', 'aprobar', 'autonomia', 'saltar', 'commit', 'registrar-tests', 'revision', 'paso', 'estado', 'cerrar']
      : [args[0]];
    for (const s of esperados) assert.ok(r.err.includes(s), `uso menciona ${s}`);
    if (args.length && args[0] !== 'nada') assert.ok(r.err.trim().split(/\r?\n/).length <= 6, 'uso corto');
  }
});

// R19: pasos manuales del circuito de PROD
function linConCircuito(pasos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  fs.mkdirSync(path.join(dir, 'proyectos', 'demo'), { recursive: true });
  const lineas = pasos.map((p) => `  - { paso: ${JSON.stringify(p)} }`).join('\n');
  fs.writeFileSync(path.join(dir, 'proyectos', 'demo', 'proyecto.yml'), `id: demo\ncircuito_prod:\n${lineas}\n`);
  return dir;
}

test('paso: registra manual:<texto> y sync-lineamientos del circuito, sin duplicar', async () => {
  const lin = linConCircuito(['sql:ref1', 'Manual:Publicar-en-Lovable', 'sync-lineamientos']);
  const env = { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  let r = await correr(raiz, ['paso', 'manual:publicar-en-lovable'], env);
  assert.equal(r.code, 1, 'sin RQ activo');
  assert.match(r.err, /No hay RQ activo/);
  await abrirR1(raiz);
  r = await correr(raiz, ['paso', 'manual:publicar-en-lovable'], env);
  assert.equal(r.code, 0, r.err);
  r = await correr(raiz, ['paso', 'sync-lineamientos'], env);
  assert.equal(r.code, 0, r.err);
  r = await correr(raiz, ['paso', 'manual:publicar-en-lovable'], env);
  assert.equal(r.code, 0, r.err);
  const circuito = cargarEstado(raiz, 'R-1').circuito;
  assert.deepEqual(circuito.map((c) => c.paso), ['Manual:Publicar-en-Lovable', 'sync-lineamientos']);
  assert.ok(circuito.every((c) => typeof c.fecha === 'string'));
});

test('paso: sql:/push:/merge-prs-sync: u otros se rechazan; manual fuera del circuito también', async () => {
  const lin = linConCircuito(['sql:ref1', 'manual:publicar-en-lovable']);
  const env = { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  await abrirR1(raiz);
  for (const p of ['sql:ref1', 'push:demo-app', 'merge-prs-sync:demo-app', 'otra-cosa', 'manual:']) {
    const r = await correr(raiz, ['paso', p], env);
    assert.equal(r.code, 1, p);
    assert.match(r.err, /Los pasos sql:\/push:\/merge-prs-sync: se registran solos; si los hiciste por fuera, usá paso hecho/, p);
  }
  const r = await correr(raiz, ['paso', 'manual:otra-cosa'], env);
  assert.equal(r.code, 1);
  assert.match(r.err, /no figura en circuito_prod/);
  assert.deepEqual(cargarEstado(raiz, 'R-1').circuito, []);
});

test('el script por línea de comandos funciona (child_process)', () => {
  const raiz = repoDemo();
  const env = { ...process.env, BACG_LINEAMIENTOS_DIR: DIR_LIN };
  const a = spawnSync(process.execPath, [SCRIPT, 'abrir', 'R-9', '--tipo', 'fix', '--clasificacion', 'spike'], { cwd: raiz, env, encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /RQ R-9 abierto\./);
  const b = spawnSync(process.execPath, [SCRIPT, 'aprobar', '9', 'x'], { cwd: raiz, env, encoding: 'utf8' });
  assert.equal(b.status, 1);
  const c = spawnSync(process.execPath, [SCRIPT], { cwd: raiz, env, encoding: 'utf8' });
  assert.equal(c.status, 2);
});

test('registrar-tests: cambios sin stagear en archivos trackeados → exit 1 y tests sin tocar', async () => {
  const raiz = repoDemo({ 'a.txt': 'uno\n' });
  await abrirR1(raiz);
  listoParaDesarrollo(raiz);
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'dos\n');
  const r = await correr(raiz, ['registrar-tests']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Hay cambios sin stagear en archivos trackeados: usá \$RQ commit/);
  assert.equal(cargarEstado(raiz, 'R-1').tests, null);
  execFileSync('git', ['add', 'a.txt'], { cwd: raiz });
  assert.equal((await correr(raiz, ['registrar-tests'])).code, 0);
});

test('abrir con otro RQ activo: quedan los dos activos, el nuevo es el más reciente; --rq elige', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['abrir', 'R-2', '--tipo', 'fix', '--clasificacion', 'spike']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Otros RQ activos: R-1/);
  assert.equal(rqActivo(raiz), 'R-2');
  assert.deepEqual(rqsActivos(raiz), ['R-1', 'R-2']);
  // Retomar R-1 lo pasa al final, sin duplicar.
  await abrirR1(raiz);
  assert.deepEqual(rqsActivos(raiz), ['R-2', 'R-1']);
  assert.equal((await correr(raiz, ['etapa', '3', '--rq', 'R-2'])).code, 0);
  assert.equal(cargarEstado(raiz, 'R-2').etapa, 3);
  assert.equal(cargarEstado(raiz, 'R-1').etapa, 0);
  // cerrar --rq saca sólo ese de ACTIVO.
  assert.equal((await correr(raiz, ['cerrar', '--rq', 'R-2'])).code, 0);
  assert.deepEqual(rqsActivos(raiz), ['R-1']);
  assert.equal((await correr(raiz, ['estado', '--rq', 'R-9'])).code, 1);
});

test('abrir y cerrar llevan la fila del RQ en el backlog del proyecto', async () => {
  const lin = linConCircuito(['push:demo-app', 'manual:publicar-en-lovable']);
  const env = { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  let r = await correr(raiz, ['abrir', 'R-7', '--tipo', 'rq', '--clasificacion', 'bounded', '--tarea', 'Aviso | corto', '--prioridad', 'Alta'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Backlog: fila R-7 agregada \(lineamientos y docs\/backlog\.md\)\./);
  const copia = () => fs.readFileSync(path.join(raiz, 'docs', 'backlog.md'), 'utf8');
  const fuente = () => fs.readFileSync(path.join(lin, 'proyectos', 'demo', 'backlog.md'), 'utf8');
  assert.equal(copia(), fuente());
  let filas = leerBacklog(lin, 'demo');
  assert.equal(filas.length, 1);
  assert.deepEqual(
    { c: filas[0]['Código'], t: filas[0].Tarea, p: filas[0].Prioridad, e: filas[0].Estado, l: filas[0].Link },
    { c: 'R-7', t: 'Aviso / corto', p: 'Alta', e: 'En curso', l: 'docs/rq/R-7/' },
  );
  r = await correr(raiz, ['etapa', '5'], env);
  r = await correr(raiz, ['cerrar'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Quedan pendientes .*push:demo-app, manual:publicar-en-lovable/);
  filas = leerBacklog(lin, 'demo');
  assert.equal(filas.length, 1);
  assert.match(filas[0].Estado, /^Hecho \d\d\/\d\d\/\d{4} \(falta: push:demo-app, manual:publicar-en-lovable\)$/);
  assert.equal(filas[0].Tarea, 'Aviso / corto', 'cerrar no borra la tarea');
  assert.deepEqual(cargarEstado(raiz, 'R-7').pendientes, ['push:demo-app', 'manual:publicar-en-lovable']);
});

test('paso hecho: registra un paso hecho por fuera con su evidencia; pisa una marca de no aplica', async () => {
  const lin = linConCircuito(['sql:ref1', 'push:demo-app', 'merge-prs-sync:sede']);
  const env = { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  await abrirR1(raiz);
  let r = await correr(raiz, ['paso', 'hecho', 'merge-prs-sync:sede', 'mergeado desde GitHub (#47)'], env);
  assert.equal(r.code, 0, r.err);
  r = await correr(raiz, ['paso', 'no-aplica', 'sql:ref1', 'sin SQL'], env);
  assert.equal(r.code, 0, r.err);
  r = await correr(raiz, ['paso', 'hecho', 'sql:ref1', 'la columna ya existía (sello)'], env);
  assert.equal(r.code, 0, r.err);
  const c = cargarEstado(raiz, 'R-1').circuito;
  assert.deepEqual(c.map((x) => [x.paso, x.evidencia, x.no_aplica]), [
    ['merge-prs-sync:sede', 'mergeado desde GitHub (#47)', undefined],
    ['sql:ref1', 'la columna ya existía (sello)', undefined],
  ]);
  assert.equal((await correr(raiz, ['paso', 'hecho', 'sql:ref1'], env)).code, 2);
  assert.equal((await correr(raiz, ['paso', 'hecho', 'otro:x', 'y'], env)).code, 1);
});

test('desplegar: plan con los pasos que corresponden, sin SQL si el RQ no trae migraciones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  fs.mkdirSync(path.join(dir, 'proyectos', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proyectos', 'demo', 'proyecto.yml'), [
    'id: demo',
    'cuenta_github: dueno',
    'repos:',
    '  - { nombre: demo-app, rol: padre }',
    '  - { nombre: sede-a, rol: sede, supabase_ref: refa }',
    'circuito_prod:',
    '  - { paso: "push:demo-app", despues_de: [] }',
    '  - { paso: "sql:refa", despues_de: [] }',
    '  - { paso: "merge-prs-sync:sede-a", despues_de: ["push:demo-app", "sql:refa"] }',
    '  - { paso: "manual:publish" }',
    '',
  ].join('\n'));
  const env = { BACG_LINEAMIENTOS_DIR: dir, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  await abrirR1(raiz);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  let r = await correr(raiz, ['desplegar'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Migraciones en el RQ: ninguna\./);
  assert.doesNotMatch(r.out, /sql:refa/);
  assert.match(r.out, /merge-prs-sync:sede-a: gh pr list -R dueno\/sede-a --head sync\/padre-acumulado/);
  assert.match(r.out, /manual:publish: manual/);
  // Con una migración y su handoff, el paso de SQL nombra los bloques (sin el rollback).
  fs.mkdirSync(path.join(raiz, 'supabase', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'supabase', 'migrations', '1_a.sql'), 'select 1;');
  fs.mkdirSync(path.join(raiz, 'docs', 'planes'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'planes', 'SEDE_DB_R-1.md'),
    '# H\n\n## 1. Control previo\n```sql\nselect 1;\n```\n## 2. Migración\n```sql\nalter table t add c int;\n```\n## Rollback\n```sql\ndrop x;\n```\n');
  r = await correr(raiz, ['desplegar'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /sql:refa: execute_sql del conector \(no la CLI\) con project_id refa \(sede-a\), una llamada por bloque, en orden: "1\. Control previo", "2\. Migración"/);
  assert.match(r.out, /merge-prs-sync:sede-a: .*\(antes: push:demo-app\)/);
  // Con el push hecho, lo que falta antes del merge es el SQL de su sede.
  await correr(raiz, ['paso', 'hecho', 'push:demo-app', 'pusheado'], env);
  r = await correr(raiz, ['desplegar'], env);
  assert.match(r.out, /\[x\] push:demo-app/);
  assert.match(r.out, /merge-prs-sync:sede-a: .*\(antes: sql:refa\)/);
});

test('bloquesHandoff: títulos y SQL de cada bloque, en orden', () => {
  const b = bloquesHandoff('## 1. A\n```sql\nselect 1;\n```\ntexto\n### 2. B\n```SQL\nselect 2;\nselect 3;\n```\n```ts\nno\n```\n');
  assert.deepEqual(b, [{ titulo: '1. A', sql: 'select 1;' }, { titulo: '2. B', sql: 'select 2;\nselect 3;' }]);
});

test('registrar-tests: {archivos} recibe lo que está en stage de producto; sin nada, no corre', async () => {
  const lin = lineamientosCon({ unit: 'node -e "require(\'fs\').writeFileSync(\'args.txt\', process.argv.slice(1).join(\'|\'))" {archivos}' });
  const env = { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  await abrirR1(raiz);
  listoParaDesarrollo(raiz);
  fs.writeFileSync(path.join(raiz, 'notas.md'), 'x');
  execFileSync('git', ['add', 'notas.md'], { cwd: raiz });
  let r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Sin archivos de producto en stage/);
  assert.equal(fs.existsSync(path.join(raiz, 'args.txt')), false);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a b.ts'), 'x');
  execFileSync('git', ['add', 'src/a b.ts'], { cwd: raiz });
  r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(raiz, 'args.txt'), 'utf8'), 'src/a b.ts');
});

test('registrar-tests: si sólo fallan tests de rojos_conocidos, cuenta como ok y los anota', async () => {
  const falla = (nombre) => `node -e "console.log(' FAIL  ${nombre}'); process.exit(1)"`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  fs.mkdirSync(path.join(dir, 'proyectos', 'demo'), { recursive: true });
  const yml = (unit) => `id: demo\ntests:\n  unit: ${JSON.stringify(unit)}\n  rojos_conocidos: ["src/viejo.test.ts"]\n`;
  fs.writeFileSync(path.join(dir, 'proyectos', 'demo', 'proyecto.yml'), yml(falla('src/viejo.test.ts > caso')));
  const env = { BACG_LINEAMIENTOS_DIR: dir, BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  await abrirR1(raiz);
  let r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 0, r.out + r.err);
  let t = cargarEstado(raiz, 'R-1').tests;
  assert.equal(t.ok, true);
  assert.deepEqual(t.rojos_conocidos, ['src/viejo.test.ts > caso']);
  fs.writeFileSync(path.join(dir, 'proyectos', 'demo', 'proyecto.yml'), yml(falla('src/nuevo.test.ts > caso')));
  r = await correr(raiz, ['registrar-tests'], env);
  assert.equal(r.code, 1);
  t = cargarEstado(raiz, 'R-1').tests;
  assert.equal(t.ok, false);
});


// Pasos del circuito que no corresponden a este RQ (un FIX sin SQL, un cambio sin estándares).
// Lo que el RQ publica se mide desde una base fija (estado.base), no desde el upstream: después del
// push el upstream ya tiene los commits y el diff contra él queda vacío.
const CIRCUITO_NA = ['sql:ref1', 'push:demo-app', 'sql:ref2', 'merge-prs-sync:sede', 'sync-lineamientos', 'manual:publicar-en-lovable'];
const envNA = () => ({ BACG_LINEAMIENTOS_DIR: linConCircuito(CIRCUITO_NA) });
const gitEn = (raiz, ...a) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8' }).trim();
function escribir(raiz, archivos) {
  for (const [rel, contenido] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    fs.writeFileSync(path.join(raiz, rel), contenido);
  }
}
function commitear(raiz, archivos = {}) {
  escribir(raiz, archivos);
  gitEn(raiz, 'add', '-A');
  gitEn(raiz, 'commit', '-q', '-m', 'cambio');
}
// Repo con un remoto bare de verdad (origin) y main con upstream origin/main.
function repoConRemoto() {
  const raiz = repoDemo();
  const remoto = fs.mkdtempSync(path.join(os.tmpdir(), 'remoto-'));
  gitEn(remoto, 'init', '-q', '--bare');
  gitEn(raiz, 'branch', '-M', 'main');
  gitEn(raiz, 'remote', 'add', 'origin', remoto);
  gitEn(raiz, 'push', '-q', '-u', 'origin', 'main');
  return raiz;
}

test('abrir guarda en estado.base el commit de HEAD', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  assert.equal(cargarEstado(raiz, 'R-1').base, gitEn(raiz, 'rev-parse', 'HEAD'));
});

test('paso no-aplica: registra sql:<ref> con motivo cuando el RQ no trae migraciones', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  commitear(raiz, { 'src/a.tsx': 'x\n' });
  const r = await correr(raiz, ['paso', 'no-aplica', 'SQL:Ref1', 'FIX de UI sin SQL'], envNA());
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Paso sql:ref1 marcado como no aplica\./);
  const [c] = cargarEstado(raiz, 'R-1').circuito;
  assert.deepEqual({ p: c.paso, na: c.no_aplica, m: c.motivo }, { p: 'sql:ref1', na: true, m: 'FIX de UI sin SQL' });
  assert.equal(typeof c.fecha, 'string');
});

test('paso no-aplica: sql:<ref> se rechaza con migraciones commiteadas, sueltas o sacadas de la carpeta', async () => {
  const casos = [
    [(raiz) => commitear(raiz, { 'supabase/migrations/20261024_x.sql': 's\n' }), 'supabase/migrations/20261024_x.sql'],
    [(raiz) => escribir(raiz, { 'supabase/migrations/20261024_y.sql': 's\n' }), 'supabase/migrations/20261024_y.sql'],
    [(raiz) => { fs.mkdirSync(path.join(raiz, 'otra')); gitEn(raiz, 'mv', 'supabase/migrations/vieja.sql', 'otra/vieja.sql'); commitear(raiz); },
      'supabase/migrations/vieja.sql'],
  ];
  for (const [cambiar, ruta] of casos) {
    const raiz = repoDemo({ 'supabase/migrations/vieja.sql': 'select 1;\n' });
    await abrirR1(raiz);
    cambiar(raiz);
    const r = await correr(raiz, ['paso', 'no-aplica', 'sql:ref1', 'sin SQL'], envNA());
    assert.equal(r.code, 1, ruta);
    assert.ok(r.err.includes(`sql:ref1 no puede marcarse como no aplica: el cambio trae ${ruta}.`), r.err);
    assert.deepEqual(cargarEstado(raiz, 'R-1').circuito, []);
  }
});

test('paso no-aplica: después del push sigue viendo lo que publicó el RQ', async () => {
  const raiz = repoConRemoto();
  await abrirR1(raiz);
  commitear(raiz, { 'AGENTS.md': 'x\n', 'supabase/migrations/1.sql': 's\n' });
  gitEn(raiz, 'push', '-q');
  for (const [p, ruta] of [['sync-lineamientos', 'AGENTS.md'], ['sql:ref2', 'supabase/migrations/1.sql']]) {
    const r = await correr(raiz, ['paso', 'no-aplica', p, 'm'], envNA());
    assert.equal(r.code, 1, p);
    assert.ok(r.err.includes(`${p} no puede marcarse como no aplica: el cambio trae ${ruta}.`), r.err);
  }
});

test('paso no-aplica: sync-lineamientos se rechaza si el cambio toca docs/estandares o AGENTS.md', async () => {
  for (const rel of ['docs/estandares/canon-ui.md', 'AGENTS.md']) {
    const raiz = repoDemo();
    await abrirR1(raiz);
    commitear(raiz, { [rel]: 'x\n' });
    const r = await correr(raiz, ['paso', 'no-aplica', 'sync-lineamientos', 'sin estándares'], envNA());
    assert.equal(r.code, 1, rel);
    assert.ok(r.err.includes(`sync-lineamientos no puede marcarse como no aplica: el cambio trae ${rel}.`), r.err);
  }
  const raiz = repoDemo();
  await abrirR1(raiz);
  commitear(raiz, { 'src/a.tsx': 'x\n' });
  const r = await correr(raiz, ['paso', 'no-aplica', 'sync-lineamientos', 'sin estándares'], envNA());
  assert.equal(r.code, 0, r.err);
});

test('paso no-aplica en un RQ sin base: la toma del merge-base con el upstream y la guarda', async () => {
  const raiz = repoConRemoto();
  const inicio = gitEn(raiz, 'rev-parse', 'HEAD');
  await abrirR1(raiz);
  const est = cargarEstado(raiz, 'R-1');
  delete est.base;
  guardarEstadoTest(raiz, est);
  commitear(raiz, { 'src/a.tsx': 'x\n' });
  let r = await correr(raiz, ['paso', 'no-aplica', 'sql:ref1', 'sin SQL'], envNA());
  assert.equal(r.code, 0, r.err);
  assert.equal(cargarEstado(raiz, 'R-1').base, inicio);
  const sinUp = repoDemo();
  await abrirR1(sinUp);
  const e2 = cargarEstado(sinUp, 'R-1');
  delete e2.base;
  guardarEstadoTest(sinUp, e2);
  r = await correr(sinUp, ['paso', 'no-aplica', 'sql:ref1', 'm'], envNA());
  assert.equal(r.code, 1);
  assert.match(r.err, /El RQ no tiene base y la rama no tiene upstream: no puedo ver qué se va a publicar/);
});

test('paso no-aplica: push:, merge-prs-sync:, sin motivo o fuera del circuito se rechazan', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  for (const p of ['push:demo-app', 'merge-prs-sync:sede']) {
    const r = await correr(raiz, ['paso', 'no-aplica', p, 'motivo'], envNA());
    assert.equal(r.code, 1, p);
    assert.match(r.err, /Los pasos push: y merge-prs-sync: no se pueden marcar como no aplica\./, p);
  }
  let r = await correr(raiz, ['paso', 'no-aplica', 'sql:ref1', '  '], envNA());
  assert.equal(r.code, 1);
  assert.match(r.err, /El motivo no puede estar vacío\./);
  r = await correr(raiz, ['paso', 'no-aplica', 'sql:otra', 'm'], envNA());
  assert.equal(r.code, 1);
  assert.match(r.err, /no figura en circuito_prod/);
  assert.deepEqual(cargarEstado(raiz, 'R-1').circuito, []);
});

test('paso no-aplica: manual:<texto> se marca sin chequeo de rutas y no duplica', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  commitear(raiz, { 'supabase/migrations/x.sql': 'x\n' });
  let r = await correr(raiz, ['paso', 'no-aplica', 'manual:publicar-en-lovable', 'sólo docs'], envNA());
  assert.equal(r.code, 0, r.err);
  r = await correr(raiz, ['paso', 'no-aplica', 'manual:publicar-en-lovable', 'sólo docs'], envNA());
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ya estaba registrado/);
  assert.equal(cargarEstado(raiz, 'R-1').circuito.length, 1);
});

test('paso reabrir: quita la marca de no aplica; sin marca, error', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  await correr(raiz, ['paso', 'no-aplica', 'sql:ref1', 'sin SQL'], envNA());
  await correr(raiz, ['paso', 'sync-lineamientos'], envNA());
  let r = await correr(raiz, ['paso', 'reabrir', 'SQL:REF1'], envNA());
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Paso sql:ref1 reabierto: ya no figura como no aplica\./);
  assert.deepEqual(cargarEstado(raiz, 'R-1').circuito.map((c) => c.paso), ['sync-lineamientos']);
  for (const p of ['sql:ref1', 'sync-lineamientos']) {
    r = await correr(raiz, ['paso', 'reabrir', p], envNA());
    assert.equal(r.code, 1, p);
    assert.match(r.err, new RegExp(`${p} no figura como no aplica en este RQ\\.`), p);
  }
});

test('paso no-aplica en un RQ sin base que ya pusheó: se niega, el upstream ya no muestra lo publicado', async () => {
  const raiz = repoConRemoto();
  await abrirR1(raiz);
  const est = cargarEstado(raiz, 'R-1');
  delete est.base;
  est.circuito = [{ paso: 'push:demo-app', fecha: 'f' }];
  guardarEstadoTest(raiz, est);
  const r = await correr(raiz, ['paso', 'no-aplica', 'sql:ref2', 'm'], envNA());
  assert.equal(r.code, 1);
  assert.match(r.err, /El RQ no tiene base y ya pusheó/);
});

// --- 0.5: verificar, entregar, cerrar --resumen ---

test('registrar-tests no corre el E2E; verificar lo corre y lo registra contra HEAD', async () => {
  const raiz = repoDemo();
  const marca = path.join(raiz, 'e2e-corrio.txt');
  const lin = lineamientosCon({ unit: 'node -e "process.exit(0)"', e2e: `node -e "require('fs').writeFileSync(process.argv[1],'x')" "${marca}"` });
  const env = { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  assert.equal((await correr(raiz, ['registrar-tests'], env)).code, 0);
  assert.equal(fs.existsSync(marca), false, 'registrar-tests no corre el E2E');
  const r = await correr(raiz, ['verificar'], env);
  assert.equal(r.code, 0, r.err);
  assert.ok(fs.existsSync(marca));
  const e = cargarEstado(raiz, 'R-1').e2e;
  assert.equal(e.ok, true);
  assert.match(e.head, /^[0-9a-f]{40}$/);
});

test('verificar: E2E rojo → exit distinto de 0 y ok false; sin tests.e2e → mensaje', async () => {
  const raiz = repoDemo();
  let lin = lineamientosCon({ e2e: 'node -e "process.exit(3)"' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'bug', '--clasificacion', 'bounded'], { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_ALTA: '1' });
  let r = await correr(raiz, ['verificar'], { BACG_LINEAMIENTOS_DIR: lin });
  assert.equal(r.code, 3);
  assert.equal(cargarEstado(raiz, 'R-1').e2e.ok, false);
  lin = lineamientosCon({ unit: 'node -e "0"' });
  r = await correr(raiz, ['verificar'], { BACG_LINEAMIENTOS_DIR: lin });
  assert.equal(r.code, 1);
  assert.match(r.err, /no declara tests\.e2e/);
});

test('entregar: informa rama, tests, E2E, revisión y el plan de despliegue', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['entregar']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Entrega de R-1/);
  assert.match(r.out, /sin upstream/);
  assert.match(r.out, /E2E: sin correr/);
  assert.match(r.out, /PR y CI: sin consultar/);
  assert.match(r.out, /Plan de despliegue de R-1/);
});

test('cerrar --resumen: changelog del mes, línea en docs/log/rq.jsonl y un commit de docs', async () => {
  const raiz = repoDemo({ 'src/a.ts': 'a' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--tarea', 'Aviso nuevo']);
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'b');
  execFileSync('git', ['commit', '-qam', 'feat(R-1): aviso'], { cwd: raiz });
  fs.writeFileSync(path.join(raiz, 'notas.txt'), 'ajeno');
  const r = await correr(raiz, ['cerrar', '--resumen', 'Se ve el aviso al vender.', '--alcance', 'Solo HQ']);
  assert.equal(r.code, 0, r.err);
  const mes = new Date().toISOString().slice(0, 7);
  const cl = fs.readFileSync(path.join(raiz, 'docs', 'log', 'changelog', `${mes}.md`), 'utf8');
  assert.match(cl, /### \d{4}-\d\d-\d\d · R-1 · Aviso nuevo\n- Qué cambió: Se ve el aviso al vender\.\n- Dónde: src\/a\.ts[^\n]*\n- Alcance: Solo HQ/);
  const linea = JSON.parse(fs.readFileSync(path.join(raiz, 'docs', 'log', 'rq.jsonl'), 'utf8').trim());
  assert.equal(linea.codigo, 'R-1');
  assert.equal(linea.tipo, 'rq');
  assert.equal(linea.commits.length, 1);
  assert.equal(linea.e2e, null);
  const log = execFileSync('git', ['log', '-1', '--format=%s', '--name-only'], { cwd: raiz, encoding: 'utf8' });
  assert.match(log, /^docs\(R-1\): cierre/);
  assert.match(log, /docs\/log\/rq\.jsonl/);
  assert.doesNotMatch(log, /notas\.txt/, 'el commit de cierre sólo lleva docs');
  assert.equal(rqActivo(raiz), null);
});

test('cerrar sin --resumen no escribe changelog ni log', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  const r = await correr(raiz, ['cerrar']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Sin --resumen/);
  assert.equal(fs.existsSync(path.join(raiz, 'docs', 'log')), false);
});

test('cerrar --resumen: si ACTIVO estaba commiteado y queda vacío, su borrado va en el commit de cierre', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  execFileSync('git', ['add', 'docs/rq'], { cwd: raiz });
  execFileSync('git', ['commit', '-qm', 'docs(R-1): abrir'], { cwd: raiz });
  const r = await correr(raiz, ['cerrar', '--resumen', 'Listo.']);
  assert.equal(r.code, 0, r.err);
  const log = execFileSync('git', ['log', '-1', '--format=%s', '--name-status'], { cwd: raiz, encoding: 'utf8' });
  assert.match(log, /D\s+docs\/rq\/ACTIVO/);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: raiz, encoding: 'utf8' }).trim(), '');
});

test('sede (RQ espejo): no escribe backlog y al cerrar sólo deja pendientes sus propios pasos', async () => {
  const lin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  fs.mkdirSync(path.join(lin, 'proyectos', 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(lin, 'proyectos', 'demo', 'proyecto.yml'),
    [
      'id: demo',
      'repos:',
      '  - { nombre: hq, rol: padre, push_prod: true }',
      '  - { nombre: demo-sede, rol: sede, push_prod: true }',
      'circuito_prod:',
      '  - { paso: "push:hq" }',
      '  - { paso: "push:demo-sede", despues_de: [] }',
      '  - { paso: "sync-lineamientos" }',
      '',
    ].join('\n'),
  );
  const env = { BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };
  const raiz = repoDemo();
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/duena/demo-sede.git'], { cwd: raiz });
  let r = await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /sede; el backlog vive en el repo padre/);
  assert.equal(fs.existsSync(path.join(raiz, 'docs', 'backlog.md')), false);
  assert.equal(fs.existsSync(path.join(lin, 'proyectos', 'demo', 'backlog.md')), false);
  await correr(raiz, ['etapa', '5'], env);
  r = await correr(raiz, ['cerrar'], env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(cargarEstado(raiz, 'R-1').pendientes, ['push:demo-sede']);
});

// --- 0.6: modo Lovable ---

test('agents: escribe la sección entre marcas en AGENTS.md y la reemplaza sin tocar el resto', async () => {
  const raiz = repoDemo({ 'AGENTS.md': '# Reglas propias\n\n- una regla del proyecto\n' });
  let r = await correr(raiz, ['agents']);
  assert.equal(r.code, 0, r.err);
  let t = fs.readFileSync(path.join(raiz, 'AGENTS.md'), 'utf8');
  assert.match(t, /^# Reglas propias\n\n- una regla del proyecto\n\n<!-- bacg-dev:inicio/);
  assert.match(t, /Bases de PROD: `refprod1`, `refprod2`/);
  assert.match(t, /docs\/log\/rq\.jsonl/);
  fs.writeFileSync(path.join(raiz, 'AGENTS.md'), t + '\n- regla agregada después\n');
  r = await correr(raiz, ['agents']);
  t = fs.readFileSync(path.join(raiz, 'AGENTS.md'), 'utf8');
  assert.equal((t.match(/bacg-dev:inicio/g) ?? []).length, 1, 'una sola sección');
  assert.match(t, /- regla agregada después/);
});

test('auditar: lista commits de Lovable con marcas y --cerrar mueve la marca y anota el log', async () => {
  const raiz = repoDemo();
  const commitDe = (autor, archivo) => {
    fs.mkdirSync(path.dirname(path.join(raiz, archivo)), { recursive: true });
    fs.writeFileSync(path.join(raiz, archivo), String(Math.random()));
    execFileSync('git', ['add', archivo], { cwd: raiz });
    execFileSync('git', ['-c', `user.name=${autor}`, '-c', 'user.email=bot@x.dev', 'commit', '-qm', `cambio ${archivo}`], { cwd: raiz });
  };
  commitDe('gpt-engineer-app[bot]', 'supabase/migrations/1_a.sql');
  commitDe('gpt-engineer-app[bot]', 'src/x.ts');
  commitDe('Nico', 'src/y.ts');
  let r = await correr(raiz, ['auditar']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /sin iniciar/);
  assert.match(r.out, /2 commit\(s\): 1 con migraciones, 0 en rutas sensibles, 1 con código sin tests/);
  assert.match(r.out, /cambio supabase\/migrations\/1_a\.sql\s+\[MIGRACIÓN\]/);
  assert.doesNotMatch(r.out, /src\/y\.ts/, 'sólo commits de Lovable');
  r = await correr(raiz, ['auditar', '--cerrar', 'Revisado: la migración ya está en PROD']);
  assert.equal(r.code, 0, r.err);
  const linea = JSON.parse(fs.readFileSync(path.join(raiz, 'docs', 'log', 'rq.jsonl'), 'utf8').trim());
  assert.deepEqual([linea.tipo, linea.commits, linea.migraciones], ['auditoria-lovable', 2, 1]);
  r = await correr(raiz, ['auditar']);
  assert.match(r.out, /Nada que revisar/);
  commitDe('gpt-engineer-app[bot]', 'src/z.ts');
  r = await correr(raiz, ['auditar']);
  assert.match(r.out, /1 commit\(s\)/);
});

// Verificación local con el rol real (M1): RQ que toca UI.
const SPEC_UI = '# R-1\n\n## Toca: UI [x] · sensible [ ]\n';
const rqConUi = async (extra = {}) => {
  const raiz = repoDemo({ 'docs/rq/R-1/qa/a.png': 'png', 'docs/rq/R-1/spec.md': SPEC_UI, 'docs/otro/b.png': 'png', ...extra });
  await abrirR1(raiz);
  return raiz;
};

test('verificar --local registra qué y capturas', async () => {
  const raiz = await rqConUi();
  const r = await correr(raiz, ['verificar', '--local', 'Recorrí X como gerente', 'docs/rq/R-1/qa/a.png']);
  assert.equal(r.code, 0, r.err);
  const v = cargarEstado(raiz, 'R-1').verificacion_local;
  assert.equal(v.que, 'Recorrí X como gerente');
  assert.deepEqual(v.capturas, ['docs/rq/R-1/qa/a.png']);
  assert.equal(typeof v.fecha, 'string');
});

test('verificar --local sin capturas falla', async () => {
  const raiz = await rqConUi();
  const r = await correr(raiz, ['verificar', '--local', 'Recorrí X como gerente']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /al menos una captura/);
  assert.equal(cargarEstado(raiz, 'R-1').verificacion_local, undefined);
});

test('verificar --local con captura fuera de qa/ falla', async () => {
  const raiz = await rqConUi();
  const r = await correr(raiz, ['verificar', '--local', 'Recorrí X', 'docs/otro/b.png']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /docs\/rq\/R-1\/qa\//);
  const r2 = await correr(raiz, ['verificar', '--local', 'Recorrí X', 'docs/rq/R-1/qa/../../../otro/b.png']);
  assert.notEqual(r2.code, 0);
  const r3 = await correr(raiz, ['verificar', '--local', 'Recorrí X', 'docs/rq/R-1/qa/no-existe.png']);
  assert.notEqual(r3.code, 0);
  assert.match(r3.err, /no existe/);
});

test('estado muestra "Verificación local: sin registrar" en un RQ que toca UI', async () => {
  const raiz = await rqConUi();
  const r = await correr(raiz, ['estado']);
  assert.match(r.out, /Verificación local: sin registrar/);
  await correr(raiz, ['verificar', '--local', 'Recorrí X', 'docs/rq/R-1/qa/a.png']);
  assert.match((await correr(raiz, ['estado'])).out, /Verificación local: ok/);
  const sinUi = repoDemo();
  await abrirR1(sinUi);
  assert.doesNotMatch((await correr(sinUi, ['estado'])).out, /Verificación local/);
});

test('saltar verificacion-local es una compuerta válida', async () => {
  const raiz = await rqConUi();
  const r = await correr(raiz, ['saltar', 'verificacion-local', 'sin entorno local', 'no hay datos']);
  assert.equal(r.code, 0, r.err);
});

test('M2: abrir con nombre nuevo guarda el valor interno, queda pendiente e imprime nombre e implicancias', async () => {
  const raiz = repoDemo();
  const r = await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'acotado']);
  assert.equal(r.code, 0, r.err);
  const e = cargarEstado(raiz, 'R-1');
  assert.equal(e.clasificacion, 'bounded');
  assert.equal(e.clasificacion_pendiente, true);
  assert.match(r.out, /Acotado/);
  assert.match(r.out, /\/prototype/);
  assert.match(r.out, /clasificacion confirmar/);
});

test('M2: clasificacion confirmar libera; cambiar cambia y libera; estado la muestra', async () => {
  const raiz = repoDemo();
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'acotado']);
  assert.match((await correr(raiz, ['estado'])).out, /Clasificación: Acotado \(pendiente de confirmar\)/);
  const c = await correr(raiz, ['clasificacion', 'confirmar', 'Sí, acotado']);
  assert.equal(c.code, 0, c.err);
  let e = cargarEstado(raiz, 'R-1');
  assert.equal(e.clasificacion_pendiente, false);
  assert.equal(e.clasificacion_confirmada.frase, 'Sí, acotado');
  assert.ok(e.clasificacion_confirmada.fecha);
  assert.match((await correr(raiz, ['estado'])).out, /Clasificación: Acotado\n/);

  const k = await correr(raiz, ['clasificacion', 'cambiar', 'arquitectonico', 'mejor arquitectónico']);
  assert.equal(k.code, 0, k.err);
  e = cargarEstado(raiz, 'R-1');
  assert.equal(e.clasificacion, 'arquitectonico');
  assert.equal(e.clasificacion_pendiente, false);
  assert.equal(e.clasificacion_confirmada.frase, 'mejor arquitectónico');
});

test('M2: clasificacion valida acción, valor y frase', async () => {
  const raiz = repoDemo();
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'acotado']);
  assert.equal((await correr(raiz, ['clasificacion', 'confirmar'])).code, 2);
  assert.equal((await correr(raiz, ['clasificacion', 'otra', 'x'])).code, 2);
  assert.equal((await correr(raiz, ['clasificacion', 'cambiar', 'enorme', 'frase'])).code, 1);
  assert.equal(cargarEstado(raiz, 'R-1').clasificacion_pendiente, true);
});

test('ejecucion: guarda modo, frase y fecha; acepta los nombres de las skills; valor o frase inválidos fallan', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  let r = await correr(raiz, ['ejecucion', 'subagentes', 'con subagentes']);
  assert.equal(r.code, 0, r.err);
  let e = cargarEstado(raiz, 'R-1').ejecucion;
  assert.deepEqual({ modo: e.modo, frase: e.frase }, { modo: 'subagentes', frase: 'con subagentes' });
  assert.ok(e.fecha);
  assert.equal((await correr(raiz, ['ejecucion', 'executing-plans', 'en línea'])).code, 0);
  assert.equal(cargarEstado(raiz, 'R-1').ejecucion.modo, 'inline');
  assert.equal((await correr(raiz, ['ejecucion', 'subagent-driven-development', 'subagentes dale'])).code, 0);
  assert.equal(cargarEstado(raiz, 'R-1').ejecucion.modo, 'subagentes');
  r = await correr(raiz, ['ejecucion', 'paralelo', 'frase']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Ejecución inválida: "paralelo"/);
  assert.equal((await correr(raiz, ['ejecucion', 'inline', ''])).code, 1);
  assert.equal((await correr(raiz, ['ejecucion', 'inline'])).code, 2);
  assert.equal(cargarEstado(raiz, 'R-1').ejecucion.modo, 'subagentes', 'los intentos inválidos no pisan');
});

test('ejecucion: el primer commit de código en Acotado no pide la ejecución; en Exploración tampoco', async () => {
  const raiz = repoDemo({ 'src/a.ts': 'x' });
  await abrirR1(raiz);
  listoParaDesarrollo(raiz);
  const e = cargarEstado(raiz, 'R-1');
  delete e.ejecucion;
  guardarEstadoTest(raiz, e);
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'y');
  execFileSync('git', ['add', 'src/a.ts'], { cwd: raiz });
  let r = await correr(raiz, ['registrar-tests']);
  assert.equal(r.code, 0, r.err);

  const sp = repoDemo({ 'src/a.ts': 'x' });
  await correr(sp, ['abrir', 'S-1', '--tipo', 'rq', '--clasificacion', 'spike']);
  const s1 = cargarEstado(sp, 'S-1');
  s1.skills = [{ skill: 'superpowers:brainstorming', etapa: 1 }];
  guardarEstadoTest(sp, s1);
  fs.writeFileSync(path.join(sp, 'src', 'a.ts'), 'y');
  execFileSync('git', ['add', 'src/a.ts'], { cwd: sp });
  r = await correr(sp, ['registrar-tests']);
  assert.doesNotMatch(r.err, /cómo ejecutar el plan/);
});

// ---------- M4, M5 y M7: rama por RQ, estado.yml en el mismo commit y archivos ignorados ----------

// Lineamientos con ramas_solo_pr: ["18.0-dev"] en el proyecto demo.
function linSoloPr() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-solo-pr-'));
  fs.cpSync(DIR_LIN, d, { recursive: true });
  fs.appendFileSync(path.join(d, 'proyectos', 'demo', 'proyecto.yml'), 'ramas_solo_pr: ["18.0-dev"]\n');
  return { BACG_LINEAMIENTOS_DIR: d, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };
}

// Repo en 18.0-dev con upstream en un origin bare.
function repoEn180(archivos = {}) {
  const raiz = repoDemo(archivos);
  const remoto = fs.mkdtempSync(path.join(os.tmpdir(), 'remoto-'));
  gitEn(remoto, 'init', '-q', '--bare');
  gitEn(raiz, 'branch', '-M', '18.0-dev');
  gitEn(raiz, 'remote', 'add', 'origin', remoto);
  gitEn(raiz, 'push', '-q', '-u', 'origin', '18.0-dev');
  return raiz;
}

test('abrir en una rama sólo-PR pasa a rq/<código> desde el upstream', async () => {
  const raiz = repoEn180();
  const r = await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], linSoloPr());
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Rama del RQ: rq\/R-1 \(desde origin\/18\.0-dev\)\./);
  assert.equal(gitEn(raiz, 'rev-parse', '--abbrev-ref', 'HEAD'), 'rq/R-1');
  assert.equal(rqActivo(raiz), 'R-1');
});

test('abrir: si no puede pasar a la rama del RQ lo abre igual y da el comando a mano', async () => {
  const raiz = repoEn180({ 'a.txt': 'uno\n' });
  gitEn(raiz, 'switch', '-q', '-c', 'rq/R-1');
  commitear(raiz, { 'a.txt': 'otro\n' });
  gitEn(raiz, 'switch', '-q', '18.0-dev');
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'sin commitear\n');
  const r = await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], linSoloPr());
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /RQ R-1 abierto\./);
  assert.match(r.out, /No pude pasar a rq\/R-1/);
  assert.match(r.out, /git switch rq\/R-1/);
  assert.equal(rqActivo(raiz), 'R-1');
});

test('abrir en detached HEAD con ramas_solo_pr abre el RQ sin excepción', async () => {
  const raiz = repoEn180();
  gitEn(raiz, 'switch', '-q', '--detach');
  const r = await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], linSoloPr());
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /RQ R-1 abierto\./);
});

test('commit de un archivo trackeado bajo .gitignore se commitea; uno ignorado y no trackeado da error', async () => {
  const raiz = repoDemo({ '.gitignore': 'dist/\n' });
  fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'dist', 'a.txt'), 'uno\n');
  gitEn(raiz, 'add', '-f', 'dist/a.txt');
  gitEn(raiz, 'commit', '-q', '-m', 'dist trackeado');
  await abrirR1(raiz);
  listoParaDesarrollo(raiz);
  fs.writeFileSync(path.join(raiz, 'dist', 'a.txt'), 'dos\n');
  const r = await correr(raiz, ['commit', 'fix: toca dist', 'dist/a.txt']);
  assert.equal(r.code, 0, r.err);
  assert.equal(gitEn(raiz, 'show', '--name-only', '--format=', 'HEAD').split('\n').includes('dist/a.txt'), true);

  fs.writeFileSync(path.join(raiz, 'dist', 'b.txt'), 'nuevo\n');
  const e = await correr(raiz, ['commit', 'fix: otro', 'dist/b.txt']);
  assert.equal(e.code, 1);
  assert.match(e.err, /dist\/b\.txt está en \.gitignore y no está trackeada: sacala de las rutas o forzala a mano con git add -f\./);
});

test('registrar-tests deja estado.yml en stage y el commit lo incluye sin invalidar los tests', async () => {
  const raiz = repoDemo();
  await abrirR1(raiz);
  listoParaDesarrollo(raiz);
  escribir(raiz, { 'src/a.js': 'x\n' });
  gitEn(raiz, 'add', 'src/a.js');
  const r = await correr(raiz, ['registrar-tests']);
  assert.equal(r.code, 0, r.err);
  const enStage = gitEn(raiz, 'diff', '--cached', '--name-only').split('\n');
  assert.ok(enStage.includes('docs/rq/R-1/estado.yml'), enStage.join(','));
  assert.ok(enStage.includes('docs/rq/ACTIVO'));
  const t = cargarEstado(raiz, 'R-1').tests;
  assert.equal(t.arbol, arbolTesteado(raiz));
  // Una segunda corrida no queda frenada por "cambios sin stagear" de lo que escribe la CLI.
  assert.equal((await correr(raiz, ['registrar-tests'])).code, 0);
  gitEn(raiz, 'commit', '-q', '-m', 'R-1: a');
  assert.ok(gitEn(raiz, 'show', '--name-only', '--format=', 'HEAD').includes('docs/rq/R-1/estado.yml'));
});

test('entregar e imprimirEstado en una rama sólo-PR dicen "Rama equivocada"', async () => {
  const raiz = repoEn180();
  const env = linSoloPr();
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--sin-previa'], { ...env, BACG_DEV_SIN_PREVIA: '1' });
  gitEn(raiz, 'switch', '-q', '18.0-dev');
  const r = await correr(raiz, ['entregar'], env);
  assert.match(r.out, /Rama equivocada: 18\.0-dev sólo recibe cambios por PR\./);
  const s = await correr(raiz, ['estado'], env);
  assert.match(s.out, /Rama equivocada: 18\.0-dev sólo recibe cambios por PR\./);
});

test('commit de código en una rama sólo-PR da error con git switch -c', async () => {
  const raiz = repoEn180();
  const env = linSoloPr();
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  listoParaDesarrollo(raiz);
  gitEn(raiz, 'switch', '-q', '18.0-dev');
  escribir(raiz, { 'src/a.js': 'x\n' });
  const r = await correr(raiz, ['commit', 'feat: a', 'src/a.js'], env);
  assert.equal(r.code, 1);
  assert.match(r.err, /git switch -c rq\/R-1/);
});

test('abrir en una rama sólo-PR sin upstream crea rq/<código> desde HEAD', async () => {
  const raiz = repoEn180();
  gitEn(raiz, 'branch', '--unset-upstream');
  const r = await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], linSoloPr());
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Rama del RQ: rq\/R-1 \(desde HEAD\)\./);
  assert.equal(gitEn(raiz, 'rev-parse', '--abbrev-ref', 'HEAD'), 'rq/R-1');
  assert.equal(cargarEstado(raiz, 'R-1').codigo, 'R-1');
});

test('arranque: inicio sin RQ, reanudación con RQ y no escribe nada', async () => {
  const raiz = repoDemo();
  const antes = execFileSync('git', ['status', '--porcelain'], { cwd: raiz, encoding: 'utf8' });
  const inicio = await correr(raiz, ['arranque']);
  assert.equal(inicio.code, 0);
  assert.match(inicio.out, /Arranque: inicio/);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: raiz, encoding: 'utf8' }), antes);
  assert.equal((await abrirR1(raiz)).code, 0);
  const rean = await correr(raiz, ['arranque']);
  assert.equal(rean.code, 0);
  assert.match(rean.out, /Dónde nos quedamos/);
  assert.match(rean.out, /R-1/);
  assert.equal((await correr(raiz, ['arranque', 'x'])).code, 2);
});
