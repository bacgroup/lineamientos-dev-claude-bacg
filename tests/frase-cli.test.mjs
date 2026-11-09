// rq.mjs verifica las frases del usuario contra la transcripción de la sesión (aprobar, autonomia, saltar,
// clasificacion, ejecucion): la red de texto de compuerta-bash es la primera barrera, no el único control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../plugin/scripts/rq.mjs';
import { crearRepoTemporal, sesionDePrueba } from './helpers.mjs';
import { registrarSesion, transcripcionRegistrada, dirSesiones } from '../plugin/scripts/lib/sesiones.mjs';
import { escrituraProhibida } from '../plugin/scripts/lib/compuerta-edicion.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_LIN = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-fixture-'));
fs.cpSync(path.join(AQUI, 'fixtures', 'lineamientos'), DIR_LIN, { recursive: true });
const SCRIPT = path.resolve(AQUI, '..', 'plugin', 'scripts', 'rq.mjs');
const BASE = { BACG_LINEAMIENTOS_DIR: DIR_LIN, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };
const FRASE = 'dale nomás, aprobado';
const NO_DIJO = (f) => `La frase "${f}" no aparece en lo que escribió el usuario en esta sesión (tiene que ser un mensaje o una oración enteros). Registrá sólo palabras literales del usuario.\n`;

// Sin las variables de Claude Code del proceso que corre los tests (si corre dentro de Claude Code, las hereda).
const { CLAUDE_CODE_SESSION_ID: _, CLAUDECODE: _c, CLAUDE_CODE_ENTRYPOINT: _e, ...ENV_PROCESO } = process.env;

async function correr(cwd, args, { sesion = null, env = {}, tty = false, tipea = null } = {}) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    env: { ...ENV_PROCESO, ...BASE, ...(sesion?.env ?? {}), ...env },
    home: sesion?.home ?? os.tmpdir(),
    tty,
    leerLinea: async () => { if (tipea === null) throw new Error('sin respuesta'); return tipea; },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

async function rqAbierto() {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  assert.equal((await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'])).code, 0);
  return raiz;
}
const estadoYml = (raiz) => fs.readFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'estado.yml'), 'utf8');

// Cada comando que registra una frase, con la frase en su lugar.
const COMANDOS = {
  aprobar: (f) => ['aprobar', '1', f],
  'saltar e2e': (f) => ['saltar', 'e2e', f, 'sin superficie de app'],
  autonomia: (f) => ['autonomia', '4', f],
  'clasificacion confirmar': (f) => ['clasificacion', 'confirmar', f],
  'clasificacion cambiar': (f) => ['clasificacion', 'cambiar', 'arquitectonico', f],
  ejecucion: (f) => ['ejecucion', 'inline', f],
};

for (const [nombre, comando] of Object.entries(COMANDOS)) {
  test(`${nombre}: la frase que escribió el usuario se registra; otra, no y no se guarda nada`, async () => {
    const raiz = await rqAbierto();
    const sesion = sesionDePrueba('Mirá el diseño', FRASE);
    const antes = estadoYml(raiz);
    const mal = await correr(raiz, comando('otra cosa distinta'), { sesion });
    assert.equal(mal.code, 1);
    assert.equal(mal.err, NO_DIJO('otra cosa distinta'));
    assert.equal(estadoYml(raiz), antes, 'nada escrito en estado.yml');
    const bien = await correr(raiz, comando(FRASE), { sesion });
    assert.equal(bien.code, 0, bien.err);
    assert.match(estadoYml(raiz), /dale nomás, aprobado/);
  });
}

test('la traducción v3 (aprobar 6 → 5) también verifica la frase', async () => {
  const raiz = await rqAbierto();
  const f = path.join(raiz, 'docs', 'rq', 'R-1', 'estado.yml');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^version_ciclo: 4\r?\n/m, ''));
  const antes = estadoYml(raiz);
  const r = await correr(raiz, ['aprobar', '6', 'Publicalo a producción'], { sesion: sesionDePrueba(FRASE) });
  assert.equal(r.code, 1);
  assert.match(r.err, /La frase "Publicalo a producción" no aparece/);
  assert.equal(estadoYml(raiz), antes);
});

test('id de sesión que no es un UUID (con ../) se rechaza', async () => {
  const raiz = await rqAbierto();
  const sesion = sesionDePrueba(FRASE);
  // Una transcripción "válida" alcanzable con ../ desde projects/<carpeta>/: igual se rechaza.
  fs.writeFileSync(path.join(sesion.home, '.claude', 'evil.jsonl'), `${JSON.stringify({ type: 'user', message: { content: FRASE } })}\n`);
  const antes = estadoYml(raiz);
  for (const id of ['../evil', '../../.claude/evil', `${sesion.id}/../${sesion.id}`, sesion.id.toUpperCase().replace(/[0-9]/g, 'G')]) {
    const r = await correr(raiz, ['aprobar', '1', FRASE], { sesion, env: { CLAUDE_CODE_SESSION_ID: id } });
    assert.equal(r.code, 1, id);
    assert.match(r.err, /no se puede verificar la frase/, id);
  }
  assert.equal(estadoYml(raiz), antes);
});

test('sesión sin transcripción: falla cerrada', async () => {
  const raiz = await rqAbierto();
  const sesion = sesionDePrueba(FRASE);
  const id = '00000000-0000-4000-8000-000000000000';
  const r = await correr(raiz, ['aprobar', '1', FRASE], { sesion, env: { CLAUDE_CODE_SESSION_ID: id } });
  assert.equal(r.code, 1);
  assert.equal(r.err, `No se encontró la transcripción de la sesión ${id}: no se puede verificar la frase.\n`);
});

test('sin sesión: sólo desde una terminal interactiva', async () => {
  const raiz = await rqAbierto();
  const antes = estadoYml(raiz);
  let r = await correr(raiz, ['aprobar', '1', FRASE]);
  assert.equal(r.code, 1);
  assert.equal(r.err, 'Sin sesión de Claude Code ni terminal interactiva: la frase sólo la puede registrar el usuario desde su terminal.\n');
  r = await correr(raiz, ['aprobar', '1', FRASE], { env: { CLAUDE_CODE_SESSION_ID: '' }, tty: true, tipea: FRASE });
  assert.equal(r.code, 1, 'una sesión vacía no cuenta como ausente');
  assert.match(r.err, /Id de sesión inválido/);
  r = await correr(raiz, ['aprobar', '1', FRASE], { env: { CLAUDECODE: '1' }, tty: true, tipea: FRASE });
  assert.equal(r.code, 1, 'dentro de Claude Code sin id');
  assert.equal(r.err, 'Dentro de Claude Code sin id de sesión: no se puede verificar la frase.\n');
  r = await correr(raiz, ['aprobar', '1', FRASE], { tty: true });
  assert.equal(r.code, 1, 'terminal sin nadie que tipee');
  assert.equal(r.err, 'No se tipeó la frase: no se registra nada.\n');
  r = await correr(raiz, ['aprobar', '1', FRASE], { tty: true, tipea: 'otra cosa' });
  assert.equal(r.code, 1);
  assert.equal(r.err, 'La frase tipeada no coincide: no se registra nada.\n');
  assert.equal(estadoYml(raiz), antes);
  r = await correr(raiz, ['aprobar', '1', FRASE], { tty: true, tipea: 'Dale nomas aprobado' });
  assert.equal(r.code, 0, r.err);
});

test('subagente, mensaje meta, resultado de herramienta y resumen de compactación con la frase no cuentan', async () => {
  const raiz = await rqAbierto();
  const sesion = sesionDePrueba('hola');
  sesion.entrada({ type: 'user', isSidechain: true, message: { content: FRASE } });
  sesion.entrada({ type: 'user', isCompactSummary: true, message: { content: FRASE } });
  sesion.entrada({ type: 'user', isMeta: true, message: { content: FRASE } });
  sesion.entrada({ type: 'user', origin: { kind: 'peer' }, message: { content: FRASE } });
  sesion.entrada({ type: 'user', message: { content: [{ type: 'tool_result', content: FRASE }, { type: 'text', text: FRASE }] } });
  sesion.entrada({ type: 'assistant', message: { content: [{ type: 'text', text: FRASE }] } });
  const r = await correr(raiz, ['aprobar', '1', FRASE], { sesion });
  assert.equal(r.code, 1);
  assert.equal(r.err, NO_DIJO(FRASE));
});

test('como proceso: HOME y USERPROFILE no cambian dónde se busca la transcripción', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  // Transcripción armada en un home falso con la frase: rq.mjs la ignora porque busca en el home real del usuario.
  const sesion = sesionDePrueba(FRASE);
  const env = { ...ENV_PROCESO, ...BASE, ...sesion.env };
  const correrProc = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: raiz, env, encoding: 'utf8' });
  assert.equal(correrProc('abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded').status, 0);
  const r = correrProc('aprobar', '1', FRASE);
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`No se encontró la transcripción de la sesión ${sesion.id}`));
});

test('un tramo de una oración no vale: mensaje entero u oración entera', async () => {
  const raiz = await rqAbierto();
  const sesion = sesionDePrueba('Exceso de demora, analizar y resolver', 'Mirá esto. Aprobado el diseño. Seguí.');
  for (const f of ['Exceso de demora,', 'analizar y resolver', 'Aprobado el']) {
    const r = await correr(raiz, ['aprobar', '1', f], { sesion });
    assert.equal(r.code, 1, f);
    assert.equal(r.err, NO_DIJO(f));
  }
  assert.equal((await correr(raiz, ['aprobar', '1', 'Aprobado el diseño'], { sesion })).code, 0);
});

test('cada vez que el usuario la dijo vale para un solo registro', async () => {
  const raiz = await rqAbierto();
  const sesion = sesionDePrueba('Dale, aprobado');
  assert.equal((await correr(raiz, ['aprobar', '1', 'Dale, aprobado'], { sesion })).code, 0);
  const r = await correr(raiz, ['autonomia', '4', 'Dale, aprobado'], { sesion });
  assert.equal(r.code, 1);
  assert.equal(r.err, 'La frase "Dale, aprobado" ya está registrada en el RQ: cada vez que el usuario la escribe vale para un solo registro. Si su mensaje trae varias decisiones (clasificación, aprobar 1, ejecución), registrá cada una con su propio tramo: una oración entera, separada por . ; salto de línea o " + ".\n');
  sesion.dijo('dale aprobado');
  assert.equal((await correr(raiz, ['autonomia', '4', 'Dale, aprobado'], { sesion })).code, 0, 'la segunda vez que lo dijo');
});

test('dos transcripciones con el mismo id: falla cerrada', async () => {
  const raiz = await rqAbierto();
  const sesion = sesionDePrueba(FRASE);
  const otra = path.join(sesion.home, '.claude', 'projects', 'otra-carpeta');
  fs.mkdirSync(otra, { recursive: true });
  fs.copyFileSync(sesion.ruta, path.join(otra, `${sesion.id}.jsonl`));
  const r = await correr(raiz, ['aprobar', '1', FRASE], { sesion });
  assert.equal(r.code, 1);
  assert.equal(r.err, `Hay más de una transcripción de la sesión ${sesion.id}: no se puede verificar la frase.\n`);
});

test('eventos del sistema y de la app con la frase no cuentan como texto del usuario', async () => {
  const raiz = await rqAbierto();
  const sesion = sesionDePrueba('hola');
  for (const tag of ['ci-monitor-event', 'side-sessions-event', 'task-notification', 'agent-message', 'launch-selected-element']) {
    sesion.dijo(`<${tag} id="x">${FRASE}</${tag}>`);
  }
  sesion.dijo(`[Request interrupted by user] ${FRASE}`);
  const r = await correr(raiz, ['aprobar', '1', FRASE], { sesion });
  assert.equal(r.code, 1);
  assert.equal(r.err, NO_DIJO(FRASE));
});

// Otra cuenta de Claude en la misma PC (CLAUDE_CONFIG_DIR): la transcripción vive fuera de ~/.claude/projects y el
// hook PreToolUse la anota en el registro de sesiones del home real.
test('otra cuenta (CLAUDE_CONFIG_DIR): la transcripción anotada por el hook vale', async () => {
  const raiz = await rqAbierto();
  const sesion = sesionDePrueba();
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'cuenta2-'));
  const ruta = path.join(config, 'projects', 'C--repo', `${sesion.id}.jsonl`);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, `${JSON.stringify({ type: 'user', message: { content: FRASE } })}\n`);
  fs.rmSync(sesion.ruta); // en el home real no hay transcripción de esta sesión
  let r = await correr(raiz, ['aprobar', '1', FRASE], { sesion });
  assert.equal(r.code, 1, 'sin registro no la encuentra');
  assert.match(r.err, /No se encontró la transcripción/);
  assert.equal(registrarSesion({ session_id: sesion.id, transcript_path: ruta }, { home: sesion.home }), true);
  assert.equal(registrarSesion({ session_id: sesion.id, transcript_path: ruta }, { home: sesion.home }), false, 'ya anotada');
  r = await correr(raiz, ['aprobar', '1', FRASE], { sesion });
  assert.equal(r.code, 0, r.err);
});

test('registro de sesiones: sólo anota transcripciones con forma válida y fuera del home', () => {
  const sesion = sesionDePrueba();
  const id = sesion.id;
  const otra = (n) => path.join(os.tmpdir(), 'cfg', 'projects', 'x', n);
  assert.equal(registrarSesion({ session_id: id, transcript_path: sesion.ruta }, { home: sesion.home }), false, 'en el home: no hace falta');
  assert.equal(registrarSesion({ session_id: 'no-uuid', transcript_path: otra('no-uuid.jsonl') }, { home: sesion.home }), false);
  assert.equal(registrarSesion({ session_id: id, transcript_path: otra('otro.jsonl') }, { home: sesion.home }), false, 'nombre distinto del id');
  assert.equal(registrarSesion({ session_id: id, transcript_path: path.join(os.tmpdir(), 'x', `${id}.jsonl`) }, { home: sesion.home }), false, 'fuera de projects/');
  assert.equal(registrarSesion({ session_id: id, transcript_path: `cfg/projects/x/${id}.jsonl` }, { home: sesion.home }), false, 'relativa');
  // Un registro editado a mano que apunta a otro archivo no se usa.
  const archivo = path.join(sesion.home, '.claude', 'bacg-dev', 'sesiones', `${id}.json`);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify({ transcript: path.join(sesion.home, 'falsa.jsonl') }));
  assert.equal(transcripcionRegistrada(id, { home: sesion.home }), null);
});

test('el registro de sesiones y las transcripciones de CLAUDE_CONFIG_DIR no se editan', () => {
  assert.match(escrituraProhibida(path.join(dirSesiones(), '0000.json')), /transcript/i);
  const antes = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(os.tmpdir(), 'cuenta2');
  try {
    assert.match(escrituraProhibida(path.join(os.tmpdir(), 'cuenta2', 'projects', 'x', 'a.jsonl')), /transcript/i);
  } finally {
    if (antes === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = antes;
  }
});
