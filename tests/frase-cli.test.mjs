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

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_LIN = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-fixture-'));
fs.cpSync(path.join(AQUI, 'fixtures', 'lineamientos'), DIR_LIN, { recursive: true });
const SCRIPT = path.resolve(AQUI, '..', 'plugin', 'scripts', 'rq.mjs');
const BASE = { BACG_LINEAMIENTOS_DIR: DIR_LIN, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };
const FRASE = 'dale nomás, aprobado';
const NO_DIJO = (f) => `La frase "${f}" no aparece en lo que escribió el usuario en esta sesión. Registrá sólo palabras literales del usuario.\n`;

// Sin la variable de sesión del proceso que corre los tests (si corre dentro de Claude Code, la hereda).
const { CLAUDE_CODE_SESSION_ID: _, ...ENV_PROCESO } = process.env;

async function correr(cwd, args, { sesion = null, env = {}, tty = false } = {}) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    env: { ...ENV_PROCESO, ...BASE, ...(sesion?.env ?? {}), ...env },
    home: sesion?.home ?? os.tmpdir(),
    tty,
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
  r = await correr(raiz, ['aprobar', '1', FRASE], { env: { CLAUDE_CODE_SESSION_ID: '' } });
  assert.equal(r.code, 1, 'una sesión vacía cuenta como ausente');
  assert.equal(estadoYml(raiz), antes);
  r = await correr(raiz, ['aprobar', '1', FRASE], { tty: true });
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

test('como proceso: la sesión de la variable de entorno y la transcripción del home del usuario', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const sesion = sesionDePrueba(FRASE);
  const env = { ...ENV_PROCESO, ...BASE, ...sesion.env };
  const correrProc = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: raiz, env, encoding: 'utf8' });
  assert.equal(correrProc('abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded').status, 0);
  const mal = correrProc('aprobar', '1', 'otra cosa distinta');
  assert.equal(mal.status, 1);
  assert.match(mal.stderr, /no aparece en lo que escribió el usuario/);
  const bien = correrProc('aprobar', '1', FRASE);
  assert.equal(bien.status, 0, bien.stderr);
});
