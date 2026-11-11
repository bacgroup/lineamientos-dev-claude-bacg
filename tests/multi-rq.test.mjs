// 4.3.0: varios RQ en una sesión. Aprobación de lote, autonomía de sesión, skills de la sesión, ACTIVO después de un
// merge, `verificar` con rutas absolutas y capturas de otros RQ, la compuerta de Bash con `--clasificacion` y el commit
// de un merge que trae código ya publicado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado, guardarEstado, rqsActivos } from '../plugin/scripts/lib/estado.mjs';
import { evaluarBash } from '../plugin/scripts/lib/compuerta-bash.mjs';
import { reglaMergeEnAjustes } from '../plugin/scripts/lib/alta.mjs';
import { crearRepoTemporal, sesionDePrueba, fraseDe } from './helpers.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(AQUI, 'fixtures', 'lineamientos');
const DIR_LIN = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-fixture-'));
fs.cpSync(FIXTURES, DIR_LIN, { recursive: true });

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

async function correr(sesion, cwd, args, { lin = DIR_LIN, decir = true } = {}) {
  let out = '';
  let err = '';
  const frase = fraseDe(args);
  if (frase && decir) sesion.dijo(frase);
  const code = await main(args, {
    cwd,
    home: sesion.home,
    env: { ...process.env, ...sesion.env, BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const spec = (raiz, codigo, texto) => {
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', codigo), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), texto);
};
const CON_DISENO = (c) => `# ${c}\n\n## Diseño\nun cambio chico\n\n## Tareas\n- [ ] una\n`;
const aprobadas = (raiz, codigo) => (cargarEstado(raiz, codigo).aprobaciones ?? []).map((a) => [a.etapa, a.via ?? null]);

async function dosRq(sesion, codigos = ['APP-UI-VENTAS', 'APP-UI-STOCK']) {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  for (const c of codigos) {
    assert.equal((await correr(sesion, raiz, ['abrir', c, '--tipo', 'rq', '--clasificacion', 'bounded'])).code, 0);
    spec(raiz, c, CON_DISENO(c));
  }
  return raiz;
}

// ---- lote aprobar ----

test('lote aprobar: una frase que nombra los dos RQ confirma la clasificación y aprueba el diseño de cada uno', async () => {
  const s = sesionDePrueba();
  const raiz = await dosRq(s);
  const frase = 'Confirmo y apruebo los diseños de VENTAS y STOCK';
  s.dijo(frase);
  const r = await correr(s, raiz, ['lote', 'aprobar', frase, 'APP-UI-VENTAS', 'APP-UI-STOCK']);
  assert.equal(r.code, 0, r.err);
  for (const c of ['APP-UI-VENTAS', 'APP-UI-STOCK']) {
    const e = cargarEstado(raiz, c);
    assert.equal(e.clasificacion_pendiente, false);
    assert.equal(e.clasificacion_confirmada.via, 'lote');
    assert.deepEqual(aprobadas(raiz, c), [[1, 'lote']]);
  }
});

test('lote aprobar: "todos" alcanza; sin nombrarlos ni hablar del conjunto, no registra nada', async () => {
  const s = sesionDePrueba();
  const raiz = await dosRq(s);
  s.dijo('Aprobado');
  const no = await correr(s, raiz, ['lote', 'aprobar', 'Aprobado', 'APP-UI-VENTAS', 'APP-UI-STOCK']);
  assert.equal(no.code, 1);
  assert.match(no.err, /no nombra/);
  assert.deepEqual(aprobadas(raiz, 'APP-UI-VENTAS'), []);
  s.dijo('Apruebo todos los planes');
  assert.equal((await correr(s, raiz, ['lote', 'aprobar', 'Apruebo todos los planes', 'APP-UI-VENTAS', 'APP-UI-STOCK'])).code, 0);
  assert.deepEqual(aprobadas(raiz, 'APP-UI-STOCK'), [[1, 'lote']]);
});

test('lote aprobar: la frase tiene que ser del usuario, y un RQ sin ## Diseño frena todo el lote', async () => {
  const s = sesionDePrueba();
  const raiz = await dosRq(s);
  const inventada = await correr(s, raiz, ['lote', 'aprobar', 'Apruebo ambos', 'APP-UI-VENTAS', 'APP-UI-STOCK']);
  assert.equal(inventada.code, 1);
  assert.match(inventada.err, /no aparece/);
  spec(raiz, 'APP-UI-STOCK', '# sin diseño\n');
  s.dijo('Apruebo ambos');
  const r = await correr(s, raiz, ['lote', 'aprobar', 'Apruebo ambos', 'APP-UI-VENTAS', 'APP-UI-STOCK']);
  assert.equal(r.code, 1);
  assert.match(r.err, /APP-UI-STOCK: falta ## Diseño/);
  assert.deepEqual(aprobadas(raiz, 'APP-UI-VENTAS'), []);
});

test('lote aprobar: un RQ que vive en otra rama queda para correr ahí con la misma frase', async () => {
  const s = sesionDePrueba();
  const raiz = await dosRq(s, ['APP-UI-VENTAS']);
  s.dijo('Apruebo los dos: VENTAS y STOCK');
  const r = await correr(s, raiz, ['lote', 'aprobar', 'Apruebo los dos: VENTAS y STOCK', 'APP-UI-VENTAS', 'APP-UI-STOCK']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /No están en este checkout: APP-UI-STOCK/);
  assert.deepEqual(aprobadas(raiz, 'APP-UI-VENTAS'), [[1, 'lote']]);
});

// ---- autonomía de sesión ----

test('autonomia sesion: cubre los RQ activos y los que se abren después en la sesión, nunca PROD', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(s, raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  spec(raiz, 'R-1', CON_DISENO('R-1'));
  const frase = 'Dejo mi aprobación para avanzar con los planes de manera autónoma';
  const r = await correr(s, raiz, ['autonomia', 'sesion', frase]);
  assert.equal(r.code, 0, r.err);
  let e = cargarEstado(raiz, 'R-1');
  assert.equal(e.clasificacion_pendiente, false);
  assert.deepEqual(e.autonomia && [e.autonomia.hasta, e.autonomia.via], [4, 'sesion']);
  assert.deepEqual(aprobadas(raiz, 'R-1'), [[1, 'sesion']]);

  // Un RQ nuevo en la misma sesión: clasificación confirmada al abrir; el diseño, cuando está escrito.
  const r2 = await correr(s, raiz, ['abrir', 'R-2', '--tipo', 'bug', '--clasificacion', 'bounded']);
  assert.equal(r2.code, 0, r2.err);
  assert.match(r2.out, /Falta ## Diseño y ## Tareas/);
  assert.equal(cargarEstado(raiz, 'R-2').clasificacion_pendiente, false);
  assert.deepEqual(aprobadas(raiz, 'R-2'), []);
  spec(raiz, 'R-2', CON_DISENO('R-2'));
  assert.equal((await correr(s, raiz, ['autonomia', 'aplicar', '--rq', 'R-2'])).code, 0);
  assert.deepEqual(aprobadas(raiz, 'R-2'), [[1, 'sesion']]);
  // La frase de la sesión no sirve como OK de PROD.
  const prod = await correr(s, raiz, ['aprobar', '5', frase, '--rq', 'R-2'], { decir: false });
  assert.equal(prod.code, 1);
  e = cargarEstado(raiz, 'R-2');
  assert.ok(!(e.aprobaciones ?? []).some((a) => a.etapa === 5));
});

test('autonomia sesion: en Arquitectónico confirma la clasificación pero el diseño lo sigue aprobando el usuario', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(s, raiz, ['abrir', 'A-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  spec(raiz, 'A-1', CON_DISENO('A-1'));
  const r = await correr(s, raiz, ['autonomia', 'sesion', 'Avanzá solo con todo hasta DEV']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Arquitectónico lo aprueba el usuario/);
  assert.equal(cargarEstado(raiz, 'A-1').clasificacion_pendiente, false);
  assert.deepEqual(aprobadas(raiz, 'A-1'), []);
});

test('autonomia aplicar sin autonomía de sesión registrada: error; otra sesión no la hereda', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(s, raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  const r = await correr(s, raiz, ['autonomia', 'aplicar']);
  assert.equal(r.code, 1);
  assert.match(r.err, /no tiene autonomía registrada/);
  await correr(s, raiz, ['autonomia', 'sesion', 'Avanzá en automático']);
  const otra = { ...sesionDePrueba(), home: s.home };
  otra.env = { ...otra.env, HOME: s.home, USERPROFILE: s.home };
  const r2 = await correr(otra, raiz, ['autonomia', 'aplicar']);
  assert.equal(r2.code, 1);
});

// ---- skills de la sesión ----

const cargoSkill = (s, skill) => s.entrada({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Skill', input: { skill } }] } });
const skillsDelRq = (raiz, c) => (cargarEstado(raiz, c).skills ?? []).map((x) => x.skill);

test('skills: las cargadas en la sesión se anotan al abrir otro RQ y con skills importar', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  cargoSkill(s, 'superpowers:brainstorming');
  await correr(s, raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.deepEqual(skillsDelRq(raiz, 'R-1'), ['superpowers:brainstorming']);
  cargoSkill(s, 'superpowers:test-driven-development');
  const r = await correr(s, raiz, ['skills', 'importar']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(skillsDelRq(raiz, 'R-1'), ['superpowers:brainstorming', 'superpowers:test-driven-development']);
  assert.equal(cargarEstado(raiz, 'R-1').skills[1].via, 'sesion');
  await correr(s, raiz, ['abrir', 'R-2', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.deepEqual(skillsDelRq(raiz, 'R-2'), ['superpowers:brainstorming', 'superpowers:test-driven-development']);
});

// ---- ACTIVO ----

test('activo reparar: saca marcas de conflicto y RQ cerrados, suma los abiertos del árbol', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(s, raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  await correr(s, raiz, ['abrir', 'R-2', '--tipo', 'rq', '--clasificacion', 'bounded']);
  const e = cargarEstado(raiz, 'R-1');
  e.etapa = 6;
  guardarEstado(raiz, e);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), '<<<<<<< HEAD\nR-1\n=======\nR-9\n>>>>>>> origin/dev\n');
  assert.deepEqual(rqsActivos(raiz), ['R-1', 'R-9']);
  const est = await correr(s, raiz, ['estado', '--rq', 'R-2']);
  assert.match(est.out, /marcas de conflicto/);
  const r = await correr(s, raiz, ['activo', 'reparar']);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'utf8'), 'R-2\n');
  assert.match(r.out, /Quitados .*R-1, R-9/);
});

// ---- verificar ----

function lineamientosE2e(qa) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  const p = path.join(dir, 'proyectos', 'demo');
  fs.mkdirSync(p, { recursive: true });
  const script = path.join(qa, 'e2e.mjs').replace(/\\/g, '/');
  fs.writeFileSync(path.join(p, 'proyecto.yml'), `id: demo\ntests:\n  unit: "node -e \\"process.exit(0)\\""\n  e2e: ${JSON.stringify(`node "${script}" {specs}`)}\n`);
  return dir;
}

test('verificar: un spec con ruta absoluta va relativo a la carpeta del runner; las capturas de otros RQ vuelven a como estaban', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'docs/rq/OTRO/qa/a.png': 'original' } });
  const qa = fs.mkdtempSync(path.join(os.tmpdir(), 'qa '));
  const marca = path.join(qa, 'args.json');
  fs.writeFileSync(path.join(qa, 'e2e.mjs'), `
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(marca)}, JSON.stringify(args));
fs.writeFileSync('docs/rq/OTRO/qa/a.png', 'regenerada');
fs.writeFileSync('docs/rq/OTRO/qa/b.png', 'nueva');
if (args.some((a) => a.includes('nada'))) { console.log('Error: No tests found'); process.exit(1); }
`);
  const lin = lineamientosE2e(qa);
  await correr(s, raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], { lin });
  const absoluto = path.join(qa, 'e2e', 'r-1.spec.ts');
  const r = await correr(s, raiz, ['verificar', absoluto], { lin });
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(marca, 'utf8')), ['e2e/r-1.spec.ts']);
  assert.match(r.out, /Capturas de otros RQ .*: 2/);
  assert.equal(fs.readFileSync(path.join(raiz, 'docs', 'rq', 'OTRO', 'qa', 'a.png'), 'utf8'), 'original');
  assert.equal(fs.existsSync(path.join(raiz, 'docs', 'rq', 'OTRO', 'qa', 'b.png')), false);
  assert.equal(cargarEstado(raiz, 'R-1').e2e.ok, true);

  const nada = await correr(s, raiz, ['verificar', 'e2e/nada.spec.ts'], { lin });
  assert.equal(nada.code, 1);
  assert.match(nada.err, /No tests found/);
  assert.equal(cargarEstado(raiz, 'R-1').e2e.ok, true, 'una ruta mal pasada no registra un E2E fallido');
});

// ---- compuerta de Bash ----

test('compuerta de Bash: RQ= asignado y abrir con --clasificacion no es una frase ilegible', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const comando = `RQ='node "C:/x/rq.mjs"'; $RQ abrir R-1 --tipo rq --clasificacion acotado --tarea "algo" && git status`;
  assert.equal(evaluarBash({ comando, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'allow');
  // Un subcomando con frase sigue pasando por la verificación de la frase.
  const conFrase = `RQ='node "C:/x/rq.mjs"'; $RQ abrir R-1 --tipo rq --clasificacion acotado && $RQ aprobar 1 "dale"`;
  assert.equal(evaluarBash({ comando: conFrase, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'deny');
  assert.equal(evaluarBash({ comando: conFrase, cwd: raiz, ctx: { textosUsuario: ['dale'] }, dirLin: FIXTURES }).decision, 'allow');
});

test('compuerta de Bash: lote aprobar pide la frase del usuario; autonomia aplicar no trae frase', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const lote = 'node "C:/x/rq.mjs" lote aprobar "Apruebo los dos" R-1 R-2';
  assert.equal(evaluarBash({ comando: lote, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'deny');
  assert.equal(evaluarBash({ comando: lote, cwd: raiz, ctx: { textosUsuario: ['Apruebo los dos'] }, dirLin: FIXTURES }).decision, 'allow');
  const aplicar = 'node "C:/x/rq.mjs" autonomia aplicar --rq R-2';
  assert.equal(evaluarBash({ comando: aplicar, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'allow');
  const sesion = 'node "C:/x/rq.mjs" autonomia sesion "seguí solo"';
  assert.equal(evaluarBash({ comando: sesion, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'deny');
});

test('compuerta de Bash: el commit de un merge de una rama publicada no cuenta el código que trae', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'src/a.ts': 'a' } });
  const remoto = fs.mkdtempSync(path.join(os.tmpdir(), 'remoto-'));
  git(remoto, 'init', '-q', '--bare');
  git(raiz, 'remote', 'add', 'origin', remoto);
  const base = git(raiz, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(raiz, 'push', '-q', 'origin', base);
  git(raiz, 'switch', '-q', '-c', 'dev');
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'de dev');
  git(raiz, 'commit', '-q', '-am', 'código en dev');
  git(raiz, 'push', '-q', 'origin', 'dev');
  git(raiz, 'switch', '-q', '-c', 'local-sin-publicar');
  fs.writeFileSync(path.join(raiz, 'src', 'b.ts'), 'b');
  git(raiz, 'add', 'src/b.ts');
  git(raiz, 'commit', '-q', '-m', 'local');
  git(raiz, 'switch', '-q', base);
  git(raiz, 'switch', '-q', '-c', 'rq/R-1');
  fs.mkdirSync(path.join(raiz, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'n.md'), 'nota');
  git(raiz, 'add', 'docs/n.md');
  git(raiz, 'commit', '-q', '-m', 'docs');

  git(raiz, 'merge', '-q', '--no-ff', '--no-commit', 'origin/dev');
  fs.writeFileSync(path.join(raiz, 'docs', 'n.md'), 'nota 2');
  const comando = 'git add docs/n.md && git commit --no-edit';
  assert.equal(evaluarBash({ comando, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'allow');
  git(raiz, 'merge', '--abort');

  git(raiz, 'merge', '-q', '--no-ff', '--no-commit', 'local-sin-publicar');
  assert.equal(evaluarBash({ comando, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'deny');
  git(raiz, 'merge', '--abort');
});

// ---- alta ----

test('alta: la regla de permisos de gh pr merge se busca en los settings de la carpeta y de la cuenta', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carpeta-'));
  const env = {};
  assert.equal(reglaMergeEnAjustes([dir], env, home), null);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(gh pr merge:*)'] } }));
  assert.match(reglaMergeEnAjustes([path.join(dir, 'repo')], env, home), /gh pr merge/);
});

// ---- Arreglos de la revisión ----

test('compuerta de Bash: un subcomando con guion delante sigue contando; sólo se descuenta --clasificacion <valor>', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const oculto = `node -e "require('child_process').execFileSync('node',['C:/x/rq.mjs','-aprobar'.slice(1),'5','Aprobado PROD'])"`;
  assert.equal(evaluarBash({ comando: oculto, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'deny');
  const opcion = `RQ='node "C:/x/rq.mjs"'; $RQ abrir R-1 --tipo rq --clasificacion --aprobar`;
  assert.equal(evaluarBash({ comando: opcion, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'deny');
});

test('compuerta de Bash: fijar CLAUDE_CODE_SESSION_ID se niega (otra sesión no presta frases, autonomía ni skills)', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const id = '0f0e0d0c-0b0a-0908-0706-050403020100';
  for (const comando of [
    `CLAUDE_CODE_SESSION_ID=${id} node C:/x/rq.mjs autonomia aplicar`,
    `export CLAUDE_CODE_SESSION_ID=${id}; node C:/x/rq.mjs skills importar`,
    `$env:CLAUDE_CODE_SESSION_ID = '${id}'; node C:/x/rq.mjs abrir X-1 --tipo rq --clasificacion acotado`,
    `env -u CLAUDE_CODE_SESSION_ID node C:/x/rq.mjs aprobar 1 "dale"`,
  ]) {
    assert.equal(evaluarBash({ comando, cwd: raiz, ctx: { textosUsuario: ['dale'] }, dirLin: FIXTURES }).decision, 'deny', comando);
  }
  assert.equal(evaluarBash({ comando: 'echo $CLAUDE_CODE_SESSION_ID', cwd: raiz, ctx: { textosUsuario: [] }, dirLin: FIXTURES }).decision, 'allow');
});

test('autonomia sesion: una frase ya registrada en un RQ para otra decisión no se vuelve aprobación general', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(s, raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.equal((await correr(s, raiz, ['clasificacion', 'confirmar', 'Dale'])).code, 0);
  spec(raiz, 'R-1', CON_DISENO('R-1'));
  const r = await correr(s, raiz, ['autonomia', 'sesion', 'Dale'], { decir: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /ya está registrada en R-1/);
  assert.deepEqual(aprobadas(raiz, 'R-1'), []);
});
