import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { enRamaProtegida, pasarARamaDelRq, ramaActual } from '../plugin/scripts/lib/ramas.mjs';
import { crearRepoTemporal } from './helpers.mjs';

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

// Repo con origin (bare local) y la rama 18.0-dev publicada.
function repoConOrigin() {
  const dir = crearRepoTemporal({ archivos: { 'a.txt': 'a' } });
  git(dir, 'branch', '-M', '18.0-dev');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'origen-')) + path.sep + 'app.git';
  git(os.tmpdir(), 'init', '-q', '--bare', bare);
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', '-u', 'origin', '18.0-dev');
  return dir;
}

const commitear = (dir, rel, msg) => {
  fs.writeFileSync(path.join(dir, rel), msg);
  git(dir, 'add', rel);
  git(dir, 'commit', '-q', '-m', msg);
};

test('pasarARamaDelRq crea desde el upstream si HEAD sólo está atrás', () => {
  const dir = repoConOrigin();
  commitear(dir, 'b.txt', 'b');
  git(dir, 'push', '-q');
  git(dir, 'reset', '-q', '--hard', 'HEAD~1');
  assert.deepEqual(pasarARamaDelRq(dir, 'R-1'), { rama: 'rq/R-1', creada: true, desde: 'origin/18.0-dev' });
  assert.equal(ramaActual(dir), 'rq/R-1');
  assert.equal(fs.existsSync(path.join(dir, 'b.txt')), true);
});

test('pasarARamaDelRq crea desde HEAD si hay commits propios', () => {
  const dir = repoConOrigin();
  commitear(dir, 'local.txt', 'local');
  const sha = git(dir, 'rev-parse', 'HEAD');
  const r = pasarARamaDelRq(dir, 'R-1');
  assert.equal(r.desde, 'HEAD');
  assert.equal(r.creada, true);
  assert.equal(git(dir, 'rev-parse', 'rq/R-1'), sha);
});

test('pasarARamaDelRq toma la rama existente', () => {
  const dir = repoConOrigin();
  git(dir, 'branch', 'rq/R-1');
  const r = pasarARamaDelRq(dir, 'R-1');
  assert.equal(r.creada, false);
  assert.equal(r.rama, 'rq/R-1');
  assert.equal(ramaActual(dir), 'rq/R-1');
});

test('enRamaProtegida: protegida, rama del RQ y detached HEAD', () => {
  const dir = repoConOrigin();
  const proyecto = { ramas_solo_pr: ['18.0-dev'] };
  assert.equal(enRamaProtegida(dir, proyecto), '18.0-dev');
  git(dir, 'switch', '-q', '-c', 'rq/R-1');
  assert.equal(enRamaProtegida(dir, proyecto), null);
  git(dir, 'switch', '-q', '--detach');
  assert.equal(ramaActual(dir), null);
  assert.equal(enRamaProtegida(dir, proyecto), null);
});
