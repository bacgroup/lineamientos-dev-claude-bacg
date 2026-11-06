// Stepper de alta: pasos en orden, qué bloquea el primer RQ y cómo lo avisan la CLI y el arranque.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pasosAlta, formatoAlta, bloqueante, lineaAlta, scriptDelComando } from '../plugin/scripts/lib/alta.mjs';
import { limpiarCacheOdoo } from '../plugin/scripts/lib/odoo-skills.mjs';
import { main } from '../plugin/scripts/rq.mjs';
import { handler as sessionStart } from '../plugin/scripts/lib/hooks/session-start.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function montar({ unit = '' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-alta-'));
  const lin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-alta-'));
  fs.mkdirSync(path.join(lin, 'proyectos', 'pf'), { recursive: true });
  fs.writeFileSync(path.join(lin, 'proyectos', 'pf', 'proyecto.yml'),
    `id: pf\ncuenta_github: orgx\nrepos:\n  - { nombre: pf-app }\n  - { nombre: pf-bi }\ntests:\n  unit: "${unit}"\n`);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-alta-'));
  const repo = path.join(ws, 'pf-app');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/orgx/pf-app.git');
  git(repo, 'config', 'user.email', 't@e.com');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'i');
  return { home, lin, ws, repo };
}
const opts = (m, extra = {}) => ({ cwd: m.repo, home: m.home, dirLin: m.lin, env: {}, version: '22.3.0', gh: () => true, ...extra });

test('alta: en orden, sin tests en la PC bloquea con el JSON para declararlos', () => {
  const m = montar();
  const pasos = pasosAlta(opts(m));
  assert.deepEqual(pasos.map((p) => p.id), ['node', 'gh', 'lineamientos', 'al-dia', 'plugins', 'repo', 'repos', 'tests', 'e2e', 'local']);
  const b = bloqueante(pasos);
  assert.equal(b.id, 'tests');
  assert.match(b.como, /"pf": \{\s+"tests"/);
  assert.equal(pasos.find((p) => p.id === 'repos').estado, 'aviso', 'pf-bi no está clonado al lado');
  assert.match(formatoAlta(pasos), /Próximo paso \(obligatorio\): 8\. Tests del proyecto pf en esta PC/);
  assert.match(lineaAlta(pasos), /Alta incompleta .*\/bacg-alta/);
});

test('alta: node viejo, gh sin login o sin lineamientos bloquean primero', () => {
  const m = montar();
  assert.equal(bloqueante(pasosAlta(opts(m, { version: '20.1.0' }))).id, 'node');
  assert.equal(bloqueante(pasosAlta(opts(m, { gh: () => false }))).id, 'gh');
  const sinLin = pasosAlta(opts(m, { dirLin: path.join(m.lin, 'no-existe') }));
  assert.equal(bloqueante(sinLin).id, 'lineamientos');
  assert.match(bloqueante(sinLin).como, /gh repo clone bacgroup\/lineamientos-dev-claude-bacg/);
});

test('alta: con tests en ~/.claude/bacg-dev.json y su script presente, nada obligatorio falta', () => {
  const m = montar();
  const script = path.join(m.ws, 'qa', 'odoo-test.mjs');
  fs.mkdirSync(path.dirname(script));
  fs.writeFileSync(script, '');
  fs.mkdirSync(path.join(m.home, '.claude'));
  const cfg = (unit) => fs.writeFileSync(path.join(m.home, '.claude', 'bacg-dev.json'), JSON.stringify({ proyectos: { pf: { tests: { unit } } } }));
  cfg(`node "${script}" {archivos}`);
  let pasos = pasosAlta(opts(m));
  assert.equal(bloqueante(pasos), null);
  assert.equal(pasos.find((p) => p.id === 'tests').detalle, 'de ~/.claude/bacg-dev.json');
  assert.equal(lineaAlta(pasos), null);
  cfg(`node "${path.join(m.ws, 'qa', 'otro.mjs')}" {archivos}`);
  pasos = pasosAlta(opts(m));
  assert.equal(bloqueante(pasos).id, 'tests-script', 'ruta equivocada al script');
});

test('alta: fuera de un repo de proyecto, el paso del repo bloquea y no sigue', () => {
  const m = montar();
  const pasos = pasosAlta(opts(m, { cwd: os.tmpdir() }));
  assert.equal(pasos.at(-1).id, 'repo');
  assert.equal(bloqueante(pasos).id, 'repo');
});

test('scriptDelComando: ruta entre comillas o token con extensión', () => {
  assert.equal(scriptDelComando('node "C:/Mi Carpeta/qa/t.mjs" {archivos}'), 'C:/Mi Carpeta/qa/t.mjs');
  assert.equal(scriptDelComando('python3 tests/run.py -q'), 'tests/run.py');
  assert.equal(scriptDelComando('npx vitest related --run {archivos}'), null);
});

test('rq.mjs: alta sale 1 si falta algo obligatorio; abrir se frena hasta completar el alta (o --sin-alta)', async () => {
  const m = montar();
  const correr = async (args) => {
    let out = '';
    let err = '';
    const code = await main(args, { cwd: m.repo, env: { ...process.env, HOME: m.home, USERPROFILE: m.home, BACG_LINEAMIENTOS_DIR: m.lin, BACG_DEV_SIN_GH: '1' },
      stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } });
    return { code, out, err };
  };
  const a = await correr(['alta']);
  assert.equal(a.code, 1);
  assert.match(a.out, /Alta de lineamientos-dev-claude-bacg/);
  const r = await correr(['abrir', 'PF-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Antes del primer RQ falta completar el alta de esta PC: "Tests del proyecto pf en esta PC"/);
  const s = await correr(['abrir', 'PF-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--sin-alta']);
  assert.equal(s.code, 0, s.err);
});

test('arranque: avisa el alta incompleta en un repo; recién instalado sin lineamientos, también', async () => {
  const m = montar();
  const r = await sessionStart({ cwd: m.repo }, { dirLin: m.lin, home: m.home, pluginRoot: null, env: { BACG_DEV_SIN_GH: '1' } });
  assert.match(r.hookSpecificOutput.additionalContext, /Alta incompleta .*"Tests del proyecto pf en esta PC"/);
  const vacio = await sessionStart({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'nada-')) }, { dirLin: path.join(m.lin, 'no'), home: m.home, pluginRoot: null, env: {} });
  assert.match(vacio.hookSpecificOutput.additionalContext, /alta pendiente.*\/bacg-alta/s);
  const otro = await sessionStart({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'nada-')) }, { dirLin: m.lin, home: m.home, pluginRoot: null, env: {} });
  assert.equal(otro, null, 'con lineamientos y fuera de un proyecto: silencio');
});

test('alta: sin addons en ningún repo del proyecto no ofrece odoo-skills; con addons (sin motor declarado) sí', () => {
  const m = montar();
  assert.ok(!pasosAlta(opts(m)).some((p) => p.id === 'odoo-skills'), 'sin manifiesto, ni rastro de Odoo');
  fs.mkdirSync(path.join(m.repo, 'addons', 'x'), { recursive: true });
  fs.writeFileSync(path.join(m.repo, 'addons', 'x', '__manifest__.py'), '{}');
  limpiarCacheOdoo();
  assert.ok(pasosAlta(opts(m)).some((p) => p.id === 'odoo-skills'));
});
