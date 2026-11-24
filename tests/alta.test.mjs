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
import { sesionDePrueba } from './helpers.mjs';

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
  assert.deepEqual(pasos.map((p) => p.id), ['node', 'gh', 'lineamientos', 'al-dia', 'plugins', 'mcp', 'repo', 'repos', 'tests', 'e2e', 'local', 'revisor-pr']);
  const b = bloqueante(pasos);
  assert.equal(b.id, 'tests');
  assert.match(b.como, /"pf": \{\s+"tests"/);
  assert.equal(pasos.find((p) => p.id === 'repos').estado, 'aviso', 'pf-bi no está clonado al lado');
  assert.match(formatoAlta(pasos), /Próximo paso \(obligatorio\): 9\. Tests del proyecto pf en esta PC/);
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
  const sesion = sesionDePrueba();
  const correr = async (args) => {
    let out = '';
    let err = '';
    const code = await main(args, { cwd: m.repo, home: sesion.home, env: { ...process.env, CLAUDE_CODE_SESSION_ID: sesion.id, HOME: m.home, USERPROFILE: m.home, BACG_LINEAMIENTOS_DIR: m.lin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '' },
      stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } });
    return { code, out, err };
  };
  const a = await correr(['alta']);
  assert.equal(a.code, 1);
  assert.match(a.out, /Alta de lineamientos-dev-claude-bacg/);
  const r = await correr(['abrir', 'PF-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Antes del primer RQ falta completar el alta de esta PC: "Tests del proyecto pf en esta PC"/);
  // PLG-CLOUD: saltear el alta pide la frase del usuario.
  sesion.dijo('Abrilo igual sin terminar el alta');
  const s = await correr(['abrir', 'PF-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--sin-alta', '--frase', 'Abrilo igual sin terminar el alta']);
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

// ---------- PLG-PRREV: revisor independiente recomendado ----------

test('PLG-PRREV: sin el workflow del revisor, el alta lo recomienda con el comando, el secret y la protección de rama', () => {
  const m = montar();
  const p = pasosAlta(opts(m)).find((x) => x.id === 'revisor-pr');
  assert.ok(p, 'falta el paso revisor-pr');
  assert.equal(p.obligatorio, false);
  assert.equal(p.estado, 'aviso');
  assert.match(p.como, /rq\.mjs" revisor-pr/);
  assert.match(p.como, /ANTHROPIC_API_KEY/);
  assert.match(p.como, /protecci[oó]n de la rama/);
  fs.mkdirSync(path.join(m.repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(m.repo, '.github', 'workflows', 'bacg-revisor.yml'), 'name: Revisor BACG\n');
  assert.equal(pasosAlta(opts(m)).find((x) => x.id === 'revisor-pr').estado, 'ok');
});

// ---------- PLG-DEPS: plugins requeridos obligatorios, con los comandos exactos; MCP recomendados ----------

function conPlugins(home, ids) {
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  const datos = { version: 2, plugins: Object.fromEntries(ids.map((p) => [p, [{ scope: 'user' }]])) };
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify(datos));
}

test('PLG-DEPS: si falta un plugin del núcleo, el paso plugins es obligatorio, bloquea y da el comando exacto', async () => {
  const { PLUGINS_NUCLEO } = await import('../plugin/scripts/lib/plugins-requeridos.mjs');
  const m = montar();
  conPlugins(m.home, PLUGINS_NUCLEO.filter((p) => !p.startsWith('feature-dev')));
  const pasos = pasosAlta(opts(m));
  const p = pasos.find((x) => x.id === 'plugins');
  assert.equal(p.obligatorio, true);
  assert.equal(p.estado, 'falta');
  assert.match(p.como, /claude plugin install feature-dev@claude-plugins-official/);
  assert.match(p.como, /claude\.ai/);
  assert.equal(bloqueante(pasos).id, 'plugins');
});

test('PLG-DEPS: con el núcleo instalado el paso plugins está ok; sin poder leer lo instalado, avisa y no bloquea', async () => {
  const { PLUGINS_NUCLEO } = await import('../plugin/scripts/lib/plugins-requeridos.mjs');
  const m = montar();
  conPlugins(m.home, PLUGINS_NUCLEO);
  assert.equal(pasosAlta(opts(m)).find((x) => x.id === 'plugins').estado, 'ok');
  const sinLeer = pasosAlta(opts(montar())).find((x) => x.id === 'plugins');
  assert.equal(sinLeer.estado, 'aviso');
  assert.equal(sinLeer.obligatorio, false);
});

test('PLG-DEPS: el paso mcp recomienda codebase-memory-mcp y context7 si no están, sin bloquear', () => {
  const m = montar();
  const sin = pasosAlta(opts(m)).find((x) => x.id === 'mcp');
  assert.ok(sin, 'falta el paso mcp');
  assert.equal(sin.obligatorio, false);
  assert.equal(sin.estado, 'aviso');
  assert.match(sin.detalle, /codebase-memory-mcp/);
  assert.match(sin.como, /claude mcp add context7/);
  fs.writeFileSync(path.join(m.home, '.claude.json'), JSON.stringify({ mcpServers: { context7: {}, 'codebase-memory-mcp': {} } }));
  assert.equal(pasosAlta(opts(m)).find((x) => x.id === 'mcp').estado, 'ok');
});

// PLG-TEST-REL: tests.unit sin {archivos} corre la suite entera en cada commit.
test('PLG-TEST-REL: tests.unit sin {archivos} → aviso no obligatorio con el comando de tests relacionados del stack', () => {
  const m = montar({ unit: 'npm test' });
  fs.writeFileSync(path.join(m.repo, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }));
  const pasos = pasosAlta(opts(m));
  const p = pasos.find((x) => x.id === 'tests-rel');
  assert.equal(p.obligatorio, false);
  assert.equal(p.estado, 'aviso');
  assert.match(p.detalle, /cada commit corre la suite entera/);
  assert.match(p.como, /npx vitest related --run \{archivos\}/);
  assert.equal(pasos.findIndex((x) => x.id === 'tests-rel'), pasos.findIndex((x) => x.id === 'tests') + 1, 'va después del paso de tests');
});

test('PLG-TEST-REL: con jest sugiere --findRelatedTests; con pytest o sin stack reconocido, sin comando', () => {
  const m = montar({ unit: 'npm test' });
  fs.writeFileSync(path.join(m.repo, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29.0.0' } }));
  assert.match(pasosAlta(opts(m)).find((x) => x.id === 'tests-rel').como, /npx jest --findRelatedTests \{archivos\}/);
  const m2 = montar({ unit: 'pytest' });
  fs.writeFileSync(path.join(m2.repo, 'pytest.ini'), '[pytest]\n');
  // pytest con las fuentes en stage no corre sus tests (sale 5, "no tests ran"): no hay equivalente a "related".
  assert.doesNotMatch(pasosAlta(opts(m2)).find((x) => x.id === 'tests-rel').como, /pytest \{archivos\}/);
  const m3 = montar({ unit: 'make test' });
  const como = pasosAlta(opts(m3)).find((x) => x.id === 'tests-rel').como;
  assert.doesNotMatch(como, /npx|pytest/);
  assert.match(como, /\{archivos\}/);
});

test('PLG-TEST-REL: con {archivos} el paso está ok; sin comando de tests no aparece', () => {
  const ok = montar({ unit: 'npx vitest related --run {archivos}' });
  assert.equal(pasosAlta(opts(ok)).find((x) => x.id === 'tests-rel').estado, 'ok');
  assert.equal(pasosAlta(opts(montar())).some((x) => x.id === 'tests-rel'), false);
});

test('PLG-TEST-REL: con {archivos} el arranque no muestra el aviso', async () => {
  const m = montar();
  fs.mkdirSync(path.join(m.home, '.claude'));
  fs.writeFileSync(path.join(m.home, '.claude', 'bacg-dev.json'), JSON.stringify({ proyectos: { pf: { tests: { unit: 'npx vitest related --run {archivos}' } } } }));
  const r = await sessionStart({ cwd: m.repo }, { dirLin: m.lin, home: m.home, pluginRoot: null, env: { BACG_DEV_SIN_GH: '1' } });
  assert.doesNotMatch(r?.hookSpecificOutput?.additionalContext ?? '', /cada commit corre la suite entera/);
});

test('PLG-TEST-REL: el arranque muestra el aviso aunque el alta esté completa', async () => {
  const m = montar();
  fs.mkdirSync(path.join(m.home, '.claude'));
  fs.writeFileSync(path.join(m.home, '.claude', 'bacg-dev.json'), JSON.stringify({ proyectos: { pf: { tests: { unit: 'npm test' } } } }));
  const r = await sessionStart({ cwd: m.repo }, { dirLin: m.lin, home: m.home, pluginRoot: null, env: { BACG_DEV_SIN_GH: '1' } });
  assert.match(r.hookSpecificOutput.additionalContext, /Aviso: cada commit corre la suite entera/);
});

// PLG-E2E-ALC: tests.e2e sin {specs} corre la suite E2E completa en cada verificar.
function conE2e(m, e2e) {
  fs.mkdirSync(path.join(m.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(m.home, '.claude', 'bacg-dev.json'), JSON.stringify({ proyectos: { pf: { tests: { unit: 'npx vitest related --run {archivos}', e2e } } } }));
}

test('PLG-E2E-ALC: tests.e2e sin {specs} → aviso no obligatorio con el ejemplo; con {specs}, ok', () => {
  const m = montar();
  conE2e(m, 'npx playwright test');
  let pasos = pasosAlta(opts(m));
  const p = pasos.find((x) => x.id === 'tests-e2e-alcance');
  assert.equal(p.obligatorio, false);
  assert.equal(p.estado, 'aviso');
  assert.match(p.detalle, /cada verificar corre la suite E2E completa/);
  assert.match(p.como, /npx playwright test \{specs\}/);
  assert.equal(pasos.findIndex((x) => x.id === 'tests-e2e-alcance'), pasos.findIndex((x) => x.id === 'e2e') + 1);
  conE2e(m, 'npx playwright test {specs}');
  pasos = pasosAlta(opts(m));
  assert.equal(pasos.find((x) => x.id === 'tests-e2e-alcance').estado, 'ok');
});

test('PLG-E2E-ALC: sin tests.e2e no aparece el paso de alcance', () => {
  const m = montar({ unit: 'npm test {archivos}' });
  assert.equal(pasosAlta(opts(m)).some((x) => x.id === 'tests-e2e-alcance'), false);
});

test('PLG-E2E-ALC: el arranque avisa el E2E sin {specs} y calla con él', async () => {
  const m = montar();
  conE2e(m, 'npx playwright test');
  const arr = (mm) => sessionStart({ cwd: mm.repo }, { dirLin: mm.lin, home: mm.home, pluginRoot: null, env: { BACG_DEV_SIN_GH: '1' } });
  let r = await arr(m);
  assert.match(r.hookSpecificOutput.additionalContext, /tests\.e2e corre la suite completa en cada verificar: agregá \{specs\}/);
  conE2e(m, 'npx playwright test {specs}');
  r = await arr(m);
  assert.doesNotMatch(r?.hookSpecificOutput?.additionalContext ?? '', /suite completa en cada verificar/);
});

// PLG-CI-MIN: el arranque suma los avisos de los workflows.
test('PLG-CI-MIN: el arranque avisa un workflow on: push sin filtro de docs', async () => {
  const m = montar();
  fs.mkdirSync(path.join(m.repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(m.repo, '.github', 'workflows', 'ci.yml'), 'name: CI\non: push\njobs: {}\n');
  const r = await sessionStart({ cwd: m.repo }, { dirLin: m.lin, home: m.home, pluginRoot: null, env: { BACG_DEV_SIN_GH: '1' } });
  assert.match(r.hookSpecificOutput.additionalContext, /cada commit de docs del ciclo corre el workflow CI/);
});
