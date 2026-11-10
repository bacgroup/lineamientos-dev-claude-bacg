// PLG-CTX: higiene de plugins (los que duplican skills de este o no se usan en la carpeta), en el alta y el arranque.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { higienePlugins, componentesPlugin, usoEnSesiones, dirTranscripciones, bloqueApagar, textoCandidato, PROPIO } from '../plugin/scripts/lib/higiene.mjs';
import { pasosAlta } from '../plugin/scripts/lib/alta.mjs';
import { handler as sessionStart } from '../plugin/scripts/lib/hooks/session-start.mjs';

function plugin(dir, skills, comandos = []) {
  for (const s of skills) {
    fs.mkdirSync(path.join(dir, 'skills', s), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: ${'x'.repeat(200)}\n---\n\ncuerpo largo que no cuenta\n`);
  }
  fs.mkdirSync(path.join(dir, 'commands'), { recursive: true });
  for (const c of comandos) fs.writeFileSync(path.join(dir, 'commands', `${c}.md`), `---\ndescription: comando ${c}\n---\n`);
  return dir;
}

function montar({ sesiones = 0, usa = [] } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-hig-'));
  const base = path.join(home, '.claude');
  const cache = path.join(base, 'plugins', 'cache');
  const propio = plugin(path.join(cache, 'propio'), ['ciclo-rq', 'diseno-frontend', 'decision-arq']);
  const paralelo = plugin(path.join(cache, 'paralelo'), ['ciclo-rq', 'diseno-frontend'], ['dff-rq']);
  const ajeno = plugin(path.join(cache, 'ajeno'), ['otra-cosa']);
  const usado = plugin(path.join(cache, 'usado'), ['algo']);
  const req = plugin(path.join(cache, 'req'), ['requerida']);
  const inst = (p) => [{ scope: 'user', installPath: p }];
  fs.writeFileSync(path.join(base, 'plugins', 'installed_plugins.json'), JSON.stringify({
    plugins: { [PROPIO]: inst(propio), 'dev-fullflow@dev-fullflow': inst(paralelo), 'ajeno@mk': inst(ajeno), 'usado@mk': inst(usado), 'req@mk': inst(req), 'apagado@mk': inst(ajeno) },
  }));
  fs.writeFileSync(path.join(base, 'settings.json'), JSON.stringify({
    enabledPlugins: { [PROPIO]: true, 'dev-fullflow@dev-fullflow': true, 'ajeno@mk': true, 'usado@mk': true, 'req@mk': true, 'apagado@mk': false },
  }));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-hig-'));
  const tr = dirTranscripciones(cwd, base);
  fs.mkdirSync(tr, { recursive: true });
  for (let i = 0; i < sesiones; i++) {
    const linea = i === 0 ? usa.map((n) => JSON.stringify({ input: { skill: `${n}:algo` } })).join('\n') : '{"type":"user"}';
    fs.writeFileSync(path.join(tr, `s${i}.jsonl`), linea.replace(/"skill": "/g, '"skill":"'));
  }
  return { home, cwd, propio, paralelo, opts: { cwd, home, env: {}, requeridos: ['req@mk'], dirPropio: propio } };
}

test('componentesPlugin: cuenta skills, comandos y el tamaño del listado (sin el cuerpo)', () => {
  const m = montar();
  const c = componentesPlugin(m.paralelo);
  assert.deepEqual(c.skills.sort(), ['ciclo-rq', 'diseno-frontend']);
  assert.equal(c.otros, 1);
  assert.ok(c.tokens > 100 && c.tokens < 200, String(c.tokens));
});

test('duplicados: el plugin paralelo se detecta aunque no haya sesiones; requeridos, propio y apagados nunca', () => {
  const m = montar();
  const r = higienePlugins(m.opts);
  assert.deepEqual(r.candidatos.map((c) => c.id), ['dev-fullflow@dev-fullflow']);
  assert.equal(r.candidatos[0].motivo, 'duplica');
  assert.deepEqual(r.candidatos[0].duplicadas.sort(), ['ciclo-rq', 'diseno-frontend']);
  assert.equal(r.archivo, path.join(m.cwd, '.claude', 'settings.local.json'));
  assert.match(textoCandidato(r.candidatos[0], 0), /duplica 2 skills/);
});

test('sin uso: con sesiones suficientes, los que no aparecen en ninguna; los usados quedan', () => {
  const m = montar({ sesiones: 6, usa: ['usado'] });
  const r = higienePlugins(m.opts);
  assert.equal(r.sesiones, 6);
  assert.deepEqual(r.candidatos.map((c) => `${c.id}:${c.motivo}`).sort(), ['ajeno@mk:sin-uso', 'dev-fullflow@dev-fullflow:duplica']);
  assert.ok(r.tokens > 0);
  // soloDuplicados (arranque): no lee transcripciones
  assert.deepEqual(higienePlugins({ ...m.opts, soloDuplicados: true }).candidatos.map((c) => c.id), ['dev-fullflow@dev-fullflow']);
});

test('sin uso: con pocas sesiones no se juzga', () => {
  const m = montar({ sesiones: 3 });
  assert.deepEqual(higienePlugins(m.opts).candidatos.map((c) => c.id), ['dev-fullflow@dev-fullflow']);
});

test('lo ya apagado en la carpeta (.claude/settings.local.json) no se vuelve a proponer', () => {
  const m = montar({ sesiones: 6, usa: ['usado'] });
  fs.mkdirSync(path.join(m.cwd, '.claude'));
  fs.writeFileSync(path.join(m.cwd, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'dev-fullflow@dev-fullflow': false, 'ajeno@mk': false } }));
  assert.deepEqual(higienePlugins(m.opts).candidatos, []);
});

test('usoEnSesiones: reconoce skill, subagente, MCP y comando del plugin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'));
  fs.writeFileSync(path.join(dir, 'a.jsonl'), '{"subagent_type":"pr-review-toolkit:code-reviewer"}\n{"name":"mcp__plugin_desktop-commander_desktop-commander__read_file"}\n<command-name>/feature-dev:feature-dev</command-name>');
  const r = usoEnSesiones(dir, ['pr-review-toolkit', 'desktop-commander', 'feature-dev', 'claude-security']);
  assert.deepEqual([...r.usados].sort(), ['desktop-commander', 'feature-dev', 'pr-review-toolkit']);
});

test('sin installed_plugins.json: null (no se puede saber)', () => {
  assert.equal(higienePlugins({ cwd: os.tmpdir(), home: fs.mkdtempSync(path.join(os.tmpdir(), 'h-')), env: {} }), null);
});

test('bloqueApagar: JSON listo para sumar a settings.local.json', () => {
  assert.deepEqual(JSON.parse(bloqueApagar([{ id: 'a@b' }])), { enabledPlugins: { 'a@b': false } });
});

test('alta: el paso de higiene aparece tras los plugins, como recomendado, con el bloque para apagarlos', () => {
  const m = montar();
  const pasos = pasosAlta({ cwd: m.cwd, home: m.home, env: {}, version: '22.3.0', gh: () => true, dirLin: path.join(m.home, 'sin-lin') });
  const ids = pasos.map((p) => p.id);
  assert.equal(ids.indexOf('higiene'), ids.indexOf('plugins') + 1);
  const h = pasos.find((p) => p.id === 'higiene');
  assert.equal(h.estado, 'aviso');
  assert.equal(h.obligatorio, false);
  assert.match(h.como, /"dev-fullflow@dev-fullflow": false/);
  assert.match(h.como, /settings\.local\.json/);
});

test('arranque fuera de un repo: avisa el plugin que repite skills', async () => {
  const m = montar();
  // Un repo registrado debajo de la carpeta, para que el arranque hable.
  const lin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-hig-'));
  fs.mkdirSync(path.join(lin, 'proyectos', 'pf'), { recursive: true });
  fs.writeFileSync(path.join(lin, 'proyectos', 'pf', 'proyecto.yml'), 'id: pf\nrepos:\n  - { nombre: pf-app }\n');
  const repo = path.join(m.cwd, 'pf-app');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, '.bacg-lineamientos'), 'proyecto: pf\n');
  const r = await sessionStart({ cwd: m.cwd }, { dirLin: lin, home: m.home, pluginRoot: null, env: {} });
  const texto = r?.hookSpecificOutput?.additionalContext ?? '';
  assert.match(texto, /repiten skills de este: dev-fullflow@dev-fullflow \(ciclo-rq, diseno-frontend\)/);
});
