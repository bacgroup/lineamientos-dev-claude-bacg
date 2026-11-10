// PLG-CTX (4.2.0): el hook PostToolUse compacta salidas largas de Bash/PowerShell y guarda el original.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { comandoCompactable, compactarSalida, compactadorActivo } from '../plugin/scripts/lib/hooks/compactador.mjs';
import { crearRepoTemporal, correrHook } from './helpers.mjs';

const homeVacio = () => fs.mkdtempSync(path.join(os.tmpdir(), 'home ctx-'));
const logLargo = (n = 3000, error = 1500) =>
  Array.from({ length: n }, (_, i) => (i === error ? 'ERROR pf.tests: FAIL: test_totales' : `INFO paso ${i} ${'·'.repeat(i % 9)} listo`)).join('\n');

test('comandoCompactable: logs, docker, gh y tests sí; lectura de código, diffs, búsquedas y rq.mjs no', () => {
  for (const c of [
    'docker logs powerfy-local-odoo-1',
    'cd /x && docker compose logs odoo',
    'node qa/odoo-test.mjs addons/pf',
    'gh api repos/o/r/commits',
    'npm test',
    'npx playwright test',
  ]) assert.ok(comandoCompactable(c), c);
  for (const c of [
    'cat plugin/scripts/rq.mjs',
    'sed -n 1,200p a.py',
    'git diff HEAD~1',
    'git show abc',
    'git log -p',
    'git -C ../powerfy-addons diff 18.0-dev',
    'git --literal-pathspecs -c core.pager=cat show HEAD',
    'grep -rn foo .',
    'docker logs x | tail -50',
    'node "C:/p/rq.mjs" estado',
    'RQ="node x/rq.mjs"; $RQ verificar',
    'Get-Content a.py',
    'FOO=1 head -n 50 a.txt',
  ]) assert.ok(!comandoCompactable(c), c);
});

test('compactarSalida: una salida corta no se toca', () => {
  const r = compactarSalida({ tool: 'Bash', input: { command: 'docker logs x' }, resp: { stdout: 'hola', stderr: '' } }, { home: homeVacio() });
  assert.equal(r, null);
});

test('compactarSalida: un log largo se compacta, conserva el error y guarda el original completo', () => {
  const home = homeVacio();
  const stdout = logLargo();
  const r = compactarSalida(
    { tool: 'Bash', input: { command: 'docker logs powerfy-local-odoo-1' }, resp: { stdout, stderr: '', interrupted: false }, toolUseId: 'toolu_1' },
    { home },
  );
  assert.ok(r);
  assert.equal(r.interrupted, false);
  assert.ok(r.stdout.includes('ERROR pf.tests: FAIL: test_totales'));
  assert.ok(r.stdout.length < stdout.length / 3);
  const m = r.stdout.match(/Original completo: (.+?) —/);
  assert.ok(m, r.stdout.slice(-300));
  assert.ok(fs.readFileSync(m[1], 'utf8').includes(stdout));
  assert.ok(m[1].startsWith(path.join(home, '.claude', 'bacg-dev', 'salidas')));
});

test('compactarSalida: un comando excluido no se toca aunque sea largo', () => {
  const r = compactarSalida({ tool: 'Bash', input: { command: 'cat log.txt' }, resp: { stdout: logLargo(), stderr: '' } }, { home: homeVacio() });
  assert.equal(r, null);
});

test('compactarSalida: si ahorra poco, no se toca', () => {
  const variado = Array.from({ length: 100 }, (_, i) => `${i} ${Math.random().toString(36).repeat(3)}`).join('\n');
  assert.ok(variado.length > 4000);
  const r = compactarSalida({ tool: 'Bash', input: { command: 'docker ps -a' }, resp: { stdout: variado, stderr: '' } }, { home: homeVacio() });
  assert.equal(r, null);
});

test('compactarSalida: sin poder guardar el original, no compacta', () => {
  const home = homeVacio();
  fs.mkdirSync(path.join(home, '.claude', 'bacg-dev'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'bacg-dev', 'salidas'), 'no soy una carpeta');
  const r = compactarSalida({ tool: 'Bash', input: { command: 'docker logs x' }, resp: { stdout: logLargo(), stderr: '' } }, { home });
  assert.equal(r, null);
});

test('compactadorActivo: en un repo del plugin sí; fuera, no; con compactar: false en bacg-dev.json o BACG_DEV_SIN_COMPACTAR, no', () => {
  const repo = crearRepoTemporal({ proyectoId: 'demo' });
  const home = homeVacio();
  assert.equal(compactadorActivo(repo, { home, env: {} }), true);
  assert.equal(compactadorActivo(fs.mkdtempSync(path.join(os.tmpdir(), 'ajena-')), { home, env: {} }), false);
  assert.equal(compactadorActivo(repo, { home, env: { BACG_DEV_SIN_COMPACTAR: '1' } }), false);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'bacg-dev.json'), JSON.stringify({ compactar: false }));
  assert.equal(compactadorActivo(repo, { home, env: {} }), false);
});

test('compactadorActivo: en la carpeta que agrupa los repos de un proyecto, sí', () => {
  const repo = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  assert.equal(compactadorActivo(path.dirname(repo), { home: homeVacio(), env: {} }), true);
});

test('hook PostToolUse: en un repo del plugin devuelve updatedToolOutput con la salida compactada', () => {
  const repo = crearRepoTemporal({ proyectoId: 'demo' });
  const home = homeVacio();
  const r = correrHook(
    'post-tool',
    {
      hook_event_name: 'PostToolUse', cwd: repo, session_id: 's', transcript_path: '', tool_use_id: 'toolu_x',
      tool_name: 'Bash', tool_input: { command: 'docker logs odoo' }, tool_response: { stdout: logLargo(), stderr: '', interrupted: false },
    },
    { HOME: home, USERPROFILE: home },
  );
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.ok(out.hookSpecificOutput.updatedToolOutput.stdout.includes('ERROR pf.tests: FAIL: test_totales'));
  assert.match(out.hookSpecificOutput.updatedToolOutput.stdout, /salida compactada/);
});

test('hook PostToolUse: fuera de un repo del plugin no responde nada', () => {
  const home = homeVacio();
  const r = correrHook(
    'post-tool',
    {
      hook_event_name: 'PostToolUse', cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'ajena-')), session_id: 's', transcript_path: '',
      tool_name: 'Bash', tool_input: { command: 'docker logs odoo' }, tool_response: { stdout: logLargo(), stderr: '' },
    },
    { HOME: home, USERPROFILE: home },
  );
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});
