// PLG-CTX (4.2.0): el hook PreCompact le dice a la compactación qué conservar del RQ.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { instruccionesCompactacion } from '../plugin/scripts/lib/hooks/pre-compact.mjs';
import { guardarEstado, guardarActivos } from '../plugin/scripts/lib/estado.mjs';
import { crearRepoTemporal, correrHook } from './helpers.mjs';

function repoConRq() {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  guardarEstado(raiz, {
    codigo: 'R-9', tipo: 'rq', clasificacion: 'bounded', tarea: 'Panel de ventas', etapa: 2,
    aprobaciones: [{ etapa: 1, frase: 'OK el diseño', fecha: '2026-11-10' }],
    tests: { ok: false }, e2e: { ok: true }, saltos: [], circuito: [], skills: [],
  });
  guardarActivos(raiz, ['R-9']);
  return raiz;
}

test('instruccionesCompactacion: reglas de qué conservar y el estado de cada RQ abierto', () => {
  const raiz = repoConRq();
  const t = instruccionesCompactacion({ cwd: raiz });
  assert.match(t, /Conservá textual/);
  assert.match(t, /R-9/);
  assert.match(t, /Acotado/);
  assert.match(t, /Panel de ventas/);
  assert.match(t, /etapa \d/);
  assert.match(t, /«OK el diseño»/);
  assert.match(t, /Tests: en rojo/);
  assert.match(t, /bacg-dev\/salidas/);
  assert.ok(t.length < 10000);
});

test('instruccionesCompactacion: desde la carpeta que agrupa los repos también encuentra el RQ', () => {
  const raiz = repoConRq();
  assert.match(instruccionesCompactacion({ cwd: path.dirname(raiz) }), /R-9/);
});

test('instruccionesCompactacion: fuera de un repo del plugin no dice nada', () => {
  assert.equal(instruccionesCompactacion({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'ajena-')) }), '');
});

test('hook PreCompact: imprime las instrucciones como texto plano y sale 0', () => {
  const raiz = repoConRq();
  const r = correrHook('pre-compact', { hook_event_name: 'PreCompact', cwd: raiz, trigger: 'auto', custom_instructions: null });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /R-9/);
  assert.throws(() => JSON.parse(r.stdout));
});

test('hook PreCompact: con entrada inválida no imprime nada y sale 0', () => {
  const r = correrHook('pre-compact', 'no es json');
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});
