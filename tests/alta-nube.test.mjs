// PLG-CLOUD: el alta en Claude Code en la nube. GitHub se verifica con `gh api user` (gh auth status falla con la
// credencial del proxy), "lineamientos al día" trae origin antes de comparar, y los plugins sincronizados desde
// claude.ai (~/.claude/plugins/synced/) cuentan como instalados.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pasosAlta } from '../plugin/scripts/lib/alta.mjs';
import { pluginsInstalados } from '../plugin/scripts/lib/plugins-instalados.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const paso = (pasos, id) => pasos.find((p) => p.id === id);

test('alta: GitHub ok con la cuenta que devuelve gh api user', () => {
  const home = tmp('home-');
  const p = pasosAlta({ cwd: tmp('ws-'), home, dirLin: tmp('lin-'), env: { ...process.env, BACG_DEV_SIN_GH: '' }, gh: () => 'nlopez-bacg' });
  assert.equal(paso(p, 'gh').estado, 'ok');
  assert.match(paso(p, 'gh').detalle, /nlopez-bacg/);
  const sin = pasosAlta({ cwd: tmp('ws-'), home, dirLin: tmp('lin-'), env: { ...process.env, BACG_DEV_SIN_GH: '' }, gh: () => null });
  assert.equal(paso(sin, 'gh').estado, 'falta');
  assert.match(paso(sin, 'gh').como, /gh api user/);
});

test('alta: "lineamientos al día" trae origin antes de comparar', () => {
  const base = tmp('lin-al-dia-');
  const semilla = path.join(base, 'semilla');
  fs.mkdirSync(semilla);
  git(semilla, 'init', '-q', '-b', 'main');
  git(semilla, 'config', 'user.email', 't@e.com');
  git(semilla, 'config', 'user.name', 'T');
  fs.mkdirSync(path.join(semilla, 'proyectos'));
  fs.writeFileSync(path.join(semilla, 'proyectos', 'x.md'), 'x');
  git(semilla, 'add', '-A');
  git(semilla, 'commit', '-qm', 'uno');
  const lin = path.join(base, 'lin');
  git(base, 'clone', '-q', semilla, lin);
  // Commit nuevo en origin que la copia todavía no trajo (sin fetch, antes daba "al día").
  fs.writeFileSync(path.join(semilla, 'proyectos', 'y.md'), 'y');
  git(semilla, 'add', '-A');
  git(semilla, 'commit', '-qm', 'dos');
  const p = pasosAlta({ cwd: tmp('ws-'), home: tmp('home-'), dirLin: lin, sinGh: true });
  assert.equal(paso(p, 'al-dia').estado, 'aviso');
  assert.match(paso(p, 'al-dia').detalle, /1 commit/);
  // Sin red (origin inexistente): no verificado, nunca "ok".
  git(lin, 'remote', 'set-url', 'origin', path.join(base, 'no-existe'));
  const sinRed = pasosAlta({ cwd: tmp('ws-'), home: tmp('home-'), dirLin: lin, sinGh: true });
  assert.equal(paso(sinRed, 'al-dia').estado, 'aviso');
  assert.match(paso(sinRed, 'al-dia').detalle, /no verificado/);
});

test('plugins instalados: cuenta installed_plugins.json y los sincronizados de claude.ai', () => {
  const home = tmp('home-plug-');
  const synced = path.join(home, '.claude', 'plugins', 'synced', 'org_cuenta');
  for (const [dir, nombre] of [['6ba53849', 'superpowers'], ['882b4d6f', 'pr-review-toolkit']]) {
    fs.mkdirSync(path.join(synced, dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(synced, dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: nombre }));
  }
  const inst = pluginsInstalados({ home, env: {} });
  assert.ok(inst.tiene('superpowers@superpowers-marketplace'));
  assert.ok(inst.tiene('pr-review-toolkit@claude-plugins-official'));
  assert.ok(!inst.tiene('claude-security@claude-plugins-official'));
  // Sin nada que leer: null (no se sabe), no "faltan todos".
  assert.equal(pluginsInstalados({ home: tmp('home-vacio-'), env: {} }), null);
});
