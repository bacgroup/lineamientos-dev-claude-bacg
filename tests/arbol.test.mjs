import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { arbolTesteado, arbolCompleto, testsValenParaStage, esPropioDeLaCli } from '../plugin/scripts/lib/arbol.mjs';
import { crearRepoTemporal } from './helpers.mjs';

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function escribir(dir, rel, txt) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), txt);
}

test('arbolTesteado ignora estado.yml; arbolCompleto no', () => {
  const dir = crearRepoTemporal({});
  escribir(dir, 'src/a.js', 'uno');
  git(dir, 'add', 'src/a.js');
  const testeado = arbolTesteado(dir);
  const completo = arbolCompleto(dir);
  escribir(dir, 'docs/rq/R-1/estado.yml', 'codigo: R-1\n');
  git(dir, 'add', 'docs/rq/R-1/estado.yml');
  assert.equal(arbolTesteado(dir), testeado);
  assert.notEqual(arbolCompleto(dir), completo);
});

test('arbolTesteado no toca el índice real', () => {
  const dir = crearRepoTemporal({});
  escribir(dir, 'src/a.js', 'uno');
  escribir(dir, 'docs/rq/R-1/estado.yml', 'codigo: R-1\n');
  git(dir, 'add', 'src/a.js', 'docs/rq/R-1/estado.yml');
  const antes = git(dir, 'diff', '--cached', '--name-only');
  arbolTesteado(dir);
  assert.equal(git(dir, 'diff', '--cached', '--name-only'), antes);
  assert.match(antes, /estado\.yml/);
});

test('testsValenParaStage acepta el árbol completo viejo', () => {
  const dir = crearRepoTemporal({});
  escribir(dir, 'src/a.js', 'uno');
  git(dir, 'add', 'src/a.js');
  assert.equal(testsValenParaStage({ ok: true, arbol: arbolCompleto(dir) }, dir), true);
  assert.equal(testsValenParaStage({ ok: true, arbol: arbolTesteado(dir) }, dir), true);
  assert.equal(testsValenParaStage({ ok: false, arbol: arbolCompleto(dir) }, dir), false);
  assert.equal(testsValenParaStage({ ok: true, arbol: '0'.repeat(40) }, dir), false);
  assert.equal(testsValenParaStage(undefined, dir), false);
});

test('esPropioDeLaCli', () => {
  for (const rel of ['docs/rq/X/estado.yml', 'docs/rq/ACTIVO', 'sub/docs/backlog.md']) assert.equal(esPropioDeLaCli(rel), true, rel);
  assert.equal(esPropioDeLaCli('docs/rq/X/spec.md'), false);
});

test('arbolTesteado tolera estado.yml modificado en el working tree tras el stage', () => {
  const dir = crearRepoTemporal({});
  escribir(dir, 'src/a.js', 'uno');
  git(dir, 'add', 'src/a.js');
  const sinEstado = arbolTesteado(dir);
  escribir(dir, 'docs/rq/R-1/estado.yml', 'codigo: R-1\n');
  git(dir, 'add', 'docs/rq/R-1/estado.yml');
  escribir(dir, 'docs/rq/R-1/estado.yml', 'codigo: R-1\ntests: ok\n');
  assert.equal(arbolTesteado(dir), sinEstado);
});
