import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerTranscript, normalizar, fraseDelUsuario } from '../plugin/scripts/lib/transcript.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcripts');
const f = (n) => path.join(FIX, n);

test('básico: dos textos de usuario y la skill invocada', async () => {
  const t = await leerTranscript(f('basico.jsonl'));
  assert.deepEqual(t.textosUsuario, ['Quiero armar el RQ de reportes', 'Spec aprobada, seguí']);
  assert.ok(t.skills.has('superpowers:brainstorming'));
  assert.equal(t.skills.size, 1);
});

test('los tool_result no cuentan como texto del usuario', async () => {
  const t = await leerTranscript(f('con-tool-results.jsonl'));
  assert.deepEqual(t.textosUsuario, ['Leé el archivo de aprobaciones']);
  assert.ok(!t.textosUsuario.some((x) => /aprobado/i.test(x)));
});

test('línea basura o truncada no lanza', async () => {
  const t = await leerTranscript(f('roto.jsonl'));
  assert.deepEqual(t.textosUsuario, ['mensaje bueno']);
});

test('archivo inexistente rechaza con TRANSCRIPT_NO_DISPONIBLE', async () => {
  await assert.rejects(leerTranscript(f('no-existe.jsonl')), /TRANSCRIPT_NO_DISPONIBLE/);
});

test('texto no humano no cuenta: skill isMeta, hand-back peer, api-request-blob, attachment', async () => {
  const t = await leerTranscript(f('no-humano.jsonl'));
  const todo = t.textosUsuario.join('\n');
  assert.ok(!todo.includes('Base directory'), 'cuerpo de skill');
  assert.ok(!fraseDelUsuario('Aprobado', t.textosUsuario), 'skill body / reminder con Aprobado');
  assert.ok(!fraseDelUsuario('OK PROD', t.textosUsuario), 'peer / reminder con OK PROD');
  assert.ok(!fraseDelUsuario('dale', t.textosUsuario), 'api-request-blob');
});

test('mensaje humano con <system-reminder> embebido: se quita el reminder, queda el resto', async () => {
  const t = await leerTranscript(f('no-humano.jsonl'));
  assert.equal(t.textosUsuario[0], 'Texto humano real');
  assert.ok(t.textosUsuario.some((x) => x.includes('ok, mirá') && x.includes('gracias')));
  assert.ok(!t.textosUsuario.some((x) => x.includes('system-reminder')));
  assert.ok(t.textosUsuario.includes('seguí'));
});

test('archivo grande: lee sólo los últimos maxBytes y descarta la línea parcial', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));
  const ruta = path.join(dir, 't.jsonl');
  const linea = (s) => JSON.stringify({ type: 'user', message: { role: 'user', content: s }, origin: { kind: 'human' } }) + '\n';
  fs.writeFileSync(ruta, linea('primero viejo') + linea('segundo') + linea('tercero'));
  const total = fs.statSync(ruta).size;
  const t = await leerTranscript(ruta, { maxBytes: linea('tercero').length + 10 });
  assert.deepEqual(t.textosUsuario, ['tercero']);
  const todo = await leerTranscript(ruta, { maxBytes: total });
  assert.equal(todo.textosUsuario.length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalizar: minúsculas, sin tildes, espacios colapsados', () => {
  assert.equal(normalizar('  Aprobadó   EJ\n Ñu '), 'aprobado ej nu');
});

test('fraseDelUsuario', () => {
  assert.equal(fraseDelUsuario('OK PROD', ['dale, ok   prod  ya']), true);
  assert.equal(fraseDelUsuario('Aprobado', ['aprobadó']), true);
  assert.equal(fraseDelUsuario('ok prod', ['no']), false);
});

test('fraseDelUsuario: por palabra completa y frases cortas sólo como mensaje entero', () => {
  assert.equal(fraseDelUsuario('si', ['sino']), false);
  assert.equal(fraseDelUsuario('si', ['si']), true);
  assert.equal(fraseDelUsuario('Si', ['si, dale despues']), false);
  assert.equal(fraseDelUsuario('avanza', ['Avanza']), true);
  assert.equal(fraseDelUsuario('OK PROD', ['ok, prod.']), true);
  assert.equal(fraseDelUsuario('ok prod', ['dale, ok   prod  ya']), true);
  assert.equal(fraseDelUsuario('spec aprobada', ['la spec aprobada, seguí']), true);
  assert.equal(fraseDelUsuario('aprobado', ['aprobadó']), true);
  assert.equal(fraseDelUsuario('ok prod', ['ok producto']), false);
  assert.equal(fraseDelUsuario('', ['algo']), false);
  assert.equal(fraseDelUsuario('  ', ['algo']), false);
});

test('filtros: compactación, sidechain, bash-stdout/stderr, local-command-stdout y reminder sin cerrar', async () => {
  const t = await leerTranscript(f('filtros.jsonl'));
  assert.deepEqual(t.textosUsuario, ['Mensaje humano base', 'corré tests  listo', 'sigo']);
  assert.equal(fraseDelUsuario('OK PROD', t.textosUsuario), false);
});

test('mensaje tipeado a mitad de un turno (queued_command humano) cuenta; el de otro origen o de un subagente, no', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));
  const ruta = path.join(dir, 't.jsonl');
  const cola = (prompt, extra = {}) => JSON.stringify({
    type: 'attachment',
    attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin: { kind: 'human' }, humanTurn: true, ...extra },
  });
  fs.writeFileSync(ruta, [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'Confirmo Acotado' }),
    cola('Confirmo Acotado'),
    cola('Aprobado por un agente', { origin: { kind: 'peer' } }),
    cola('/bacg-estado', { commandMode: 'bash' }),
    JSON.stringify({ type: 'attachment', isSidechain: true, attachment: { type: 'queued_command', prompt: 'Dale desde un subagente', origin: { kind: 'human' } } }),
  ].join('\n') + '\n');
  const t = await leerTranscript(ruta);
  assert.deepEqual(t.textosUsuario, ['Confirmo Acotado'], 'la queue-operation no duplica el mensaje');
});
