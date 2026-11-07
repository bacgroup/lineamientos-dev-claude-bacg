import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from '../plugin/scripts/vendor/js-yaml.mjs';
import { crearRepoTemporal, correrHook } from './helpers.mjs';
import { responder } from '../plugin/scripts/lib/salida.mjs';
import { avisoCuentaGh } from '../plugin/scripts/lib/hooks/session-start.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const DIR_LIN = path.join(AQUI, 'fixtures', 'lineamientos');
const PLUGIN = path.join(RAIZ, 'plugin');
const TRANSCRIPT = path.join(AQUI, 'fixtures', 'transcripts', 'basico.jsonl');
const SB = 'mcp__c57e95c1-9b90-4ee5-a961-dcd94156bdf7__';

const tmp = (prefijo) => fs.mkdtempSync(path.join(os.tmpdir(), prefijo));

function homeCon(plugins) {
  const home = tmp('home como-');
  if (plugins) {
    fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
    const datos = { version: 2, plugins: Object.fromEntries(plugins.map((p) => [p, [{ scope: 'user' }]])) };
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify(datos));
  }
  return home;
}

const HOME = homeCon([]);
const ENV = { BACG_LINEAMIENTOS_DIR: DIR_LIN, CLAUDE_PLUGIN_ROOT: PLUGIN, HOME, USERPROFILE: HOME, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };

const repoDemo = (archivos = {}) => crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app', archivos });

// Con `v3: true`, un estado.yml como lo escribía 3.x (sin version_ciclo): se lee convertido a v4.
function abrirRq(raiz, { v3 = false, ...estado } = {}) {
  const codigo = estado.codigo ?? 'R-T1';
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', codigo), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), `${codigo}\n`);
  const completo = {
    codigo, tipo: 'rq', clasificacion: 'bounded', etapa: 2, autonomia: null,
    aprobaciones: [], saltos: [], circuito: [], actualizado: new Date().toISOString(), ...(v3 ? {} : { version_ciclo: 4 }), ...estado,
  };
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', codigo, 'estado.yml'), yaml.dump(completo));
  return codigo;
}

const leerEstado = (raiz, codigo = 'R-T1') =>
  yaml.load(fs.readFileSync(path.join(raiz, 'docs', 'rq', codigo, 'estado.yml'), 'utf8'));

const json = (r) => {
  assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  return r.stdout.trim() === '' ? null : JSON.parse(r.stdout);
};

const decision = (out) => out?.hookSpecificOutput?.permissionDecision;

const preTool = (entrada, env = ENV) =>
  json(correrHook('pre-tool', { hook_event_name: 'PreToolUse', session_id: 's', transcript_path: TRANSCRIPT, ...entrada }, env));

// --- pre-tool: Edit ---

test('pre-tool Edit sin RQ → deny', () => {
  const raiz = repoDemo();
  const out = preTool({ cwd: raiz, tool_name: 'Edit', tool_input: { file_path: path.join(raiz, 'src', 'app.ts') } });
  assert.equal(decision(out), 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /No hay RQ activo/);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
});

test('pre-tool Edit de un archivo libre → sin salida', () => {
  const raiz = repoDemo();
  const out = preTool({ cwd: raiz, tool_name: 'Write', tool_input: { file_path: path.join(raiz, 'docs', 'nota.md') } });
  assert.equal(out, null);
});

test('pre-tool Edit fuera de un repo registrado → sin salida', () => {
  const dir = tmp('suelto como-');
  const out = preTool({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'app.ts') } });
  assert.equal(out, null);
});

test('M11: pre-tool Write/Edit sobre el transcript (~/.claude/projects/*.jsonl) → deny aunque no haya repo', () => {
  const dir = tmp('suelto como-');
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    const out = preTool({ cwd: dir, tool_name: tool, tool_input: { file_path: path.join(HOME, '.claude', 'projects', 'p', 's.jsonl') } });
    assert.equal(decision(out), 'deny', tool);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /transcript/);
  }
  const otro = preTool({ cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(HOME, '.claude', 'projects', 'p', 'notas.md') } });
  assert.equal(otro, null);
});

test('pre-tool Edit de un archivo de un repo registrado con cwd no registrado → deny', () => {
  const raiz = repoDemo();
  const cwd = tmp('suelto como-');
  const out = preTool({ cwd, tool_name: 'MultiEdit', tool_input: { file_path: path.join(raiz, 'src', 'app.ts') } });
  assert.equal(decision(out), 'deny');
});

test('pre-tool NotebookEdit usa notebook_path', () => {
  const raiz = repoDemo();
  const out = preTool({ cwd: raiz, tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(raiz, 'src', 'a.ipynb') } });
  assert.equal(decision(out), 'deny');
});

// I4: el transcript sólo puede habilitar; si no se puede leer, queda el deny de la primera pasada.
test('pre-tool Edit sin RQ con transcript inexistente → deny de la primera pasada', () => {
  const raiz = repoDemo();
  const out = preTool({
    cwd: raiz,
    transcript_path: path.join(raiz, 'no-existe.jsonl'),
    tool_name: 'Edit',
    tool_input: { file_path: path.join(raiz, 'src', 'app.ts') },
  });
  assert.equal(decision(out), 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /No hay RQ activo/);
});

test('pre-tool commit con tests en rojo y transcript inexistente → deny', () => {
  const raiz = repoDemo({ 'src/a.ts': 'x' });
  abrirRq(raiz, { tests: { ok: false, arbol: 'x' } });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'y');
  spawnSync('git', ['add', 'src/a.ts'], { cwd: raiz });
  const out = preTool({
    cwd: raiz,
    transcript_path: path.join(raiz, 'no-existe.jsonl'),
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m x' },
  });
  assert.equal(decision(out), 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /registrar-tests/);
});

// --- pre-tool: terminales de MCP (pasan por la compuerta de Bash) ---

test('pre-tool terminales MCP: git commit de código sin tests → deny; un comando inocuo → allow', () => {
  const raiz = repoDemo({ 'src/a.ts': 'x' });
  abrirRq(raiz, { tests: { ok: false, arbol: 'x' } });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'y');
  spawnSync('git', ['add', 'src/a.ts'], { cwd: raiz });
  const terminales = [
    ['mcp__terminal__run_in_terminal', 'command'],
    ['mcp__plugin_desktop-commander_desktop-commander__start_process', 'command'],
    ['mcp__plugin_desktop-commander_desktop-commander__interact_with_process', 'input'],
    ['mcp__otro-servidor__execute_command', 'command'],
  ];
  for (const [tool, campo] of terminales) {
    const out = preTool({ cwd: raiz, tool_name: tool, tool_input: { [campo]: 'git commit -m x' } });
    assert.equal(decision(out), 'deny', tool);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /registrar-tests/, tool);
    assert.equal(preTool({ cwd: raiz, tool_name: tool, tool_input: { [campo]: 'ls -la' } }), null, tool);
  }
  // Si el handler no carga, un push desde una terminal de MCP es crítico como desde Bash.
  const push = JSON.stringify({ cwd: os.tmpdir(), tool_name: 'mcp__terminal__run_in_terminal', tool_input: { command: 'git push origin main' } });
  assert.equal(decision(json(correrCrudo('pre-tool', push, { ...ENV, COMO_TRABAJO_FALLAR_IMPORT: '1' }))), 'deny');
  // Un campo que no es texto no cambia nada: sigue por la compuerta de MCP.
  assert.equal(preTool({ cwd: raiz, tool_name: 'mcp__terminal__run_in_terminal', tool_input: { command: ['git', 'commit'] } }), null);
});

// --- pre-tool: Bash ---

test('pre-tool Bash git push con transcript inexistente → deny (falla cerrada)', () => {
  const raiz = repoDemo();
  const out = preTool({
    cwd: raiz,
    transcript_path: path.join(raiz, 'no-existe.jsonl'),
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
  });
  assert.equal(decision(out), 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /No hay RQ activo/);
});

test('pre-tool Bash sin git → sin salida', () => {
  const raiz = repoDemo();
  const out = preTool({ cwd: raiz, tool_name: 'Bash', tool_input: { command: 'ls -la' } });
  assert.equal(out, null);
});

test('pre-tool Bash git push sin RQ → deny', () => {
  const raiz = repoDemo();
  const out = preTool({ cwd: raiz, tool_name: 'Bash', tool_input: { command: 'git push' } });
  assert.equal(decision(out), 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /No hay RQ activo/);
});

// --- pre-tool: MCP ---

test('pre-tool MCP desde cwd no registrado: escritura a refprod1 → deny; lectura → sin deny', () => {
  const cwd = tmp('suelto como-');
  const escritura = preTool({ cwd, tool_name: SB + 'execute_sql', tool_input: { project_id: 'refprod1', query: 'delete from t' } });
  assert.equal(decision(escritura), 'deny');
  assert.match(escritura.hookSpecificOutput.permissionDecisionReason, /refprod1/);
  const lectura = preTool({ cwd, tool_name: SB + 'execute_sql', tool_input: { project_id: 'refprod1', query: 'select * from t' } });
  assert.notEqual(decision(lectura), 'deny');
});

test('pre-tool MCP desde cwd no registrado usa el estado del repo padre (ruta_local), también de un RQ abierto con 3.x', () => {
  const raiz = repoDemo();
  // 3.x: el OK de PROD era la etapa 6; se lee como 5 y se sigue comprobando contra la sesión.
  abrirRq(raiz, { v3: true, etapa: 6, aprobaciones: [{ etapa: 6, frase: 'Spec aprobada, seguí', fecha: '2026-10-23T12:00:00Z' }] });
  const lin = tmp('lin como-');
  fs.cpSync(DIR_LIN, lin, { recursive: true });
  const archivo = path.join(lin, 'proyectos', 'demo', 'proyecto.yml');
  const p = yaml.load(fs.readFileSync(archivo, 'utf8'));
  p.repos[0].ruta_local = raiz;
  fs.writeFileSync(archivo, yaml.dump(p));
  const cwd = tmp('suelto como-');
  const out = preTool(
    { cwd, tool_name: SB + 'apply_migration', tool_input: { project_id: 'refprod1', name: 'm', query: 'create table t()' } },
    { ...ENV, BACG_LINEAMIENTOS_DIR: lin },
  );
  assert.equal(out, null);
});

test('pre-tool MCP no gateado → sin salida', () => {
  const raiz = repoDemo();
  const out = preTool({ cwd: raiz, tool_name: SB + 'list_tables', tool_input: { project_id: 'refprod1' } });
  assert.equal(out, null);
});

// --- política de falla con stdin inválido ---

function correrCrudo(nombre, texto, env = ENV, plugin = PLUGIN) {
  const script = path.join(plugin, 'scripts', 'hooks', `${nombre}.mjs`);
  const r = spawnSync(process.execPath, [script], { input: texto, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('pre-tool con JSON inválido que menciona git push → deny', () => {
  const out = json(correrCrudo('pre-tool', '{"tool_name":"Bash","tool_input":{"command":"git push origin main"'));
  assert.equal(decision(out), 'deny');
});

test('pre-tool con JSON inválido que menciona execute_sql → deny', () => {
  const out = json(correrCrudo('pre-tool', '{"tool_name":"mcp__x__execute_sql", roto'));
  assert.equal(decision(out), 'deny');
});

test('pre-tool con JSON inválido sin operación crítica → allow con aviso', () => {
  const out = json(correrCrudo('pre-tool', '{"tool_name":"Edit", roto'));
  assert.equal(decision(out), undefined);
  assert.match(out.systemMessage, /^Aviso: compuerta no evaluada/);
});

// --- entradas: junctions, fallas de carga y criticidad ---

const FALLAR = { ...ENV, COMO_TRABAJO_FALLAR_IMPORT: '1' };
const bash = (command, cwd = os.tmpdir()) =>
  JSON.stringify({ hook_event_name: 'PreToolUse', cwd, transcript_path: TRANSCRIPT, tool_name: 'Bash', tool_input: { command } });

test('pre-tool corrido a través de una junction/symlink sigue aplicando la compuerta', () => {
  const raiz = repoDemo();
  const enlace = path.join(tmp('enlace como-'), 'plugin');
  fs.symlinkSync(PLUGIN, enlace, process.platform === 'win32' ? 'junction' : 'dir');
  const entrada = JSON.stringify({ cwd: raiz, transcript_path: TRANSCRIPT, tool_name: 'Edit', tool_input: { file_path: path.join(raiz, 'src', 'app.ts') } });
  let out;
  try {
    out = json(correrCrudo('pre-tool', entrada, ENV, enlace));
  } finally {
    fs.unlinkSync(enlace); // quitar el enlace: borrar la carpeta temporal con él adentro vaciaría plugin/
  }
  assert.equal(decision(out), 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /No hay RQ activo/);
});

test('falla al cargar el handler: deny si es crítica, aviso si no', () => {
  const critica = json(correrCrudo('pre-tool', bash('git push origin main'), FALLAR));
  assert.equal(decision(critica), 'deny');
  assert.match(critica.hookSpecificOutput.permissionDecisionReason, /^Compuerta de PROD no pudo evaluarse \(.+\)\. Se bloquea por seguridad\.$/);
  const mcp = json(correrCrudo('pre-tool', JSON.stringify({ cwd: os.tmpdir(), tool_name: SB + 'EXECUTE_SQL', tool_input: {} }), FALLAR));
  assert.equal(decision(mcp), 'deny');
  const edit = json(correrCrudo('pre-tool', JSON.stringify({ cwd: os.tmpdir(), tool_name: 'Edit', tool_input: { file_path: 'x' } }), FALLAR));
  assert.match(edit.systemMessage, /^Aviso: compuerta no evaluada/);
  for (const n of ['post-tool', 'session-start', 'user-prompt']) {
    const out = json(correrCrudo(n, '{}', FALLAR));
    assert.match(out.systemMessage, /^Aviso: compuerta no evaluada/, n);
  }
});

test('criticidad: comillas, barras y mayúsculas no esconden un push', () => {
  for (const c of ['"g"it push', "g''it push", 'Git push', 'g\\it pu\\sh', "gh pr 'mer'ge 3"]) {
    assert.equal(decision(json(correrCrudo('pre-tool', bash(c), FALLAR))), 'deny', c);
  }
  // Un comando que no nombra git, gh, push, merge, el CLI ni archivos protegidos pasa por el atajo, sin cargar nada.
  assert.equal(json(correrCrudo('pre-tool', bash('ls -la'), FALLAR)), null);
  // Con escapes de shell no se toma el atajo.
  assert.equal(decision(json(correrCrudo('pre-tool', bash("$'\\x67it' push"), FALLAR))), 'deny');
});

test('proyecto.yml corrupto no cuenta como no registrado: SQL de escritura a su ref → deny', () => {
  const lin = tmp('lin como-');
  fs.cpSync(DIR_LIN, lin, { recursive: true });
  fs.appendFileSync(path.join(lin, 'proyectos', 'demo', 'proyecto.yml'), '\nroto: [sin cerrar\n');
  const out = preTool(
    { cwd: tmp('suelto como-'), tool_name: SB + 'execute_sql', tool_input: { project_id: 'refprod1', query: 'delete from t' } },
    { ...ENV, BACG_LINEAMIENTOS_DIR: lin },
  );
  assert.equal(decision(out), 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /no pudo evaluarse/);
});

test('herramientas de ramas sin proyecto resuelto: PROD si algún proyecto tiene refs de PROD', () => {
  const cwd = tmp('suelto como-');
  for (const t of ['merge_branch', 'reset_branch']) {
    const out = preTool({ cwd, tool_name: SB + t, tool_input: { branch_id: 'b1' } });
    assert.equal(decision(out), 'deny', t);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /sin RQ activo/);
  }
  const lin = tmp('lin como-');
  fs.mkdirSync(path.join(lin, 'proyectos', 'chico'), { recursive: true });
  fs.writeFileSync(path.join(lin, 'proyectos', 'chico', 'proyecto.yml'), 'id: chico\nrepos: []\n');
  assert.equal(preTool({ cwd, tool_name: SB + 'merge_branch', tool_input: { branch_id: 'b1' } }, { ...ENV, BACG_LINEAMIENTOS_DIR: lin }), null);
});

test('ruta_local de otro proyecto no aporta estado → deny', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'otro', nombre: 'demo-app' });
  abrirRq(raiz, { etapa: 5, aprobaciones: [{ etapa: 5, frase: 'Spec aprobada, seguí', fecha: '2026-10-23T12:00:00Z' }] });
  const lin = tmp('lin como-');
  fs.cpSync(DIR_LIN, lin, { recursive: true });
  const archivo = path.join(lin, 'proyectos', 'demo', 'proyecto.yml');
  const p = yaml.load(fs.readFileSync(archivo, 'utf8'));
  p.repos[0].ruta_local = raiz;
  fs.writeFileSync(archivo, yaml.dump(p));
  const out = preTool(
    { cwd: tmp('suelto como-'), tool_name: SB + 'apply_migration', tool_input: { project_id: 'refprod1', name: 'm', query: 'create table t()' } },
    { ...ENV, BACG_LINEAMIENTOS_DIR: lin },
  );
  assert.equal(decision(out), 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /sin RQ activo/);
});

// --- salida.mjs (unidad) ---

async function correrResponder(texto, fn, critica) {
  let escrito = '';
  await responder(fn, texto, critica, { write: (s) => { escrito += s; } });
  return escrito.trim() === '' ? null : JSON.parse(escrito);
}

test('responder: error con crítica → deny con el mensaje fijo', async () => {
  const out = await correrResponder('{}', () => { throw new Error('boom'); }, true);
  assert.deepEqual(out, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Compuerta de PROD no pudo evaluarse (boom). Se bloquea por seguridad.',
    },
  });
});

test('responder: error sin crítica → systemMessage; JSON inválido sigue la misma política', async () => {
  assert.deepEqual(await correrResponder('{}', () => { throw new Error('boom'); }, false), {
    systemMessage: 'Aviso: compuerta no evaluada (boom)',
  });
  assert.equal(decision(await correrResponder('{roto', () => null, true)), 'deny');
  assert.match((await correrResponder('{roto', () => null, false)).systemMessage, /^Aviso/);
});

test('responder: la función recibe la entrada y su resultado se imprime', async () => {
  assert.deepEqual(await correrResponder('{"a":1}', (e) => ({ systemMessage: String(e.a) }), false), { systemMessage: '1' });
  assert.equal(await correrResponder('{}', () => null, false), null);
});

// --- post-tool ---

const postTool = (entrada, env = ENV) =>
  json(correrHook('post-tool', { hook_event_name: 'PostToolUse', session_id: 's', transcript_path: TRANSCRIPT, ...entrada }, env));

test('post-tool apply_migration exitoso a refprod1 → circuito con sql:refprod1, sin duplicar', () => {
  const raiz = repoDemo();
  abrirRq(raiz);
  const entrada = {
    cwd: raiz,
    tool_name: SB + 'apply_migration',
    tool_input: { project_id: 'refprod1', name: 'm', query: 'create table t()' },
    tool_response: [{ type: 'text', text: '{"success":true}' }],
  };
  assert.equal(postTool(entrada), null);
  assert.deepEqual(leerEstado(raiz).circuito.map((c) => c.paso), ['sql:refprod1']);
  assert.ok(leerEstado(raiz).circuito[0].fecha);
  postTool(entrada);
  assert.deepEqual(leerEstado(raiz).circuito.map((c) => c.paso), ['sql:refprod1']);
});

test('post-tool execute_sql de lectura o a un ref fuera del circuito → no registra', () => {
  const raiz = repoDemo();
  abrirRq(raiz);
  postTool({ cwd: raiz, tool_name: SB + 'execute_sql', tool_input: { project_id: 'refprod1', query: 'select 1' }, tool_response: {} });
  postTool({ cwd: raiz, tool_name: SB + 'execute_sql', tool_input: { project_id: 'otroref', query: 'delete from t' }, tool_response: {} });
  assert.deepEqual(leerEstado(raiz).circuito, []);
});

test('post-tool no registra un push fallido ni un --dry-run/-n', () => {
  const raiz = repoDemo();
  abrirRq(raiz, { circuito: [{ paso: 'sql:refprod1', fecha: '2026-10-23T12:00:00Z' }] });
  const push = (command, tool_response) => postTool({ cwd: raiz, tool_name: 'Bash', tool_input: { command }, tool_response });
  push('git push origin main', { stdout: '', stderr: '', exitCode: 1 });
  push('git push origin main', { stdout: '', stderr: '', exit_code: 128 });
  push('git push origin main', { returncode: 1 });
  push('git push origin main', { stdout: '', stderr: ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs' });
  push('git push origin main', { stderr: 'remote: Permission to x denied to y.' });
  push('git push origin main', { is_error: true });
  push('git push --dry-run origin main', { stdout: '', stderr: '' });
  push('git push -n origin main', { stdout: '', stderr: '' });
  push('git push -nv origin main', { stdout: '', stderr: '' });
  assert.deepEqual(leerEstado(raiz).circuito.map((c) => c.paso), ['sql:refprod1']);
  push('git push origin main', { stdout: '', stderr: 'To github.com:x/demo-app.git\n   abc..def  main -> main', exitCode: 0 });
  assert.deepEqual(leerEstado(raiz).circuito.map((c) => c.paso), ['sql:refprod1', 'push:demo-app']);
});

test('post-tool no registra pasos que sólo vio la red de seguridad (git stash push, $G push)', () => {
  const raiz = repoDemo();
  abrirRq(raiz, { circuito: [{ paso: 'sql:refprod1', fecha: '2026-10-23T12:00:00Z' }] });
  const ok = { stdout: '', stderr: '', exitCode: 0 };
  postTool({ cwd: raiz, tool_name: 'Bash', tool_input: { command: 'git stash push -m wip' }, tool_response: ok });
  postTool({ cwd: raiz, tool_name: 'Bash', tool_input: { command: 'G=git; $G push' }, tool_response: ok });
  assert.deepEqual(leerEstado(raiz).circuito.map((c) => c.paso), ['sql:refprod1']);
});

test('post-tool execute_sql de escritura a refprod2 → registra sql:refprod2', () => {
  const raiz = repoDemo();
  abrirRq(raiz);
  postTool({ cwd: raiz, tool_name: SB + 'execute_sql', tool_input: { project_id: 'RefProd2', query: 'delete from t' }, tool_response: {} });
  assert.deepEqual(leerEstado(raiz).circuito.map((c) => c.paso), ['sql:refprod2']);
});

test('post-tool Bash git push exitoso → push:demo-app', () => {
  const raiz = repoDemo();
  abrirRq(raiz, { circuito: [{ paso: 'sql:refprod1', fecha: '2026-10-23T12:00:00Z' }] });
  postTool({ cwd: raiz, tool_name: 'Bash', tool_input: { command: 'git push origin main' }, tool_response: { stdout: '', stderr: '', interrupted: false } });
  assert.deepEqual(leerEstado(raiz).circuito.map((c) => c.paso), ['sql:refprod1', 'push:demo-app']);
});

test('post-tool PowerShell git push exitoso → push:demo-app en todos los RQ activos', () => {
  const raiz = repoDemo();
  abrirRq(raiz, { codigo: 'R-T2' });
  abrirRq(raiz, { codigo: 'R-T1' });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-T2\nR-T1\n');
  postTool({ cwd: raiz, tool_name: 'PowerShell', tool_input: { command: 'git push origin main' }, tool_response: { stdout: '', stderr: '' } });
  assert.deepEqual(leerEstado(raiz, 'R-T1').circuito.map((c) => c.paso), ['push:demo-app']);
  assert.deepEqual(leerEstado(raiz, 'R-T2').circuito.map((c) => c.paso), ['push:demo-app']);
});

test('post-tool Skill → la skill queda sólo en el RQ en curso, con etapa y sesión, sin duplicar', () => {
  const raiz = repoDemo();
  abrirRq(raiz);
  abrirRq(raiz, { codigo: 'R-T2' });
  // ACTIVO: el último es el RQ en curso.
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-T2\nR-T1\n');
  postTool({ cwd: raiz, session_id: 's1', tool_name: 'Skill', tool_input: { skill: 'canon-ui-demo' }, tool_response: {} });
  postTool({ cwd: raiz, session_id: 's1', tool_name: 'Skill', tool_input: { skill: 'canon-ui-demo' }, tool_response: {} });
  const skills = leerEstado(raiz, 'R-T1').skills;
  assert.equal(skills.length, 1);
  assert.deepEqual({ skill: skills[0].skill, sesion: skills[0].sesion, etapa: typeof skills[0].etapa }, { skill: 'canon-ui-demo', sesion: 's1', etapa: 'number' });
  assert.equal(leerEstado(raiz, 'R-T2').skills, undefined, 'el otro RQ activo no hereda la skill');
});

test('post-tool con error en tool_response → no registra', () => {
  const raiz = repoDemo();
  abrirRq(raiz);
  postTool({ cwd: raiz, tool_name: SB + 'apply_migration', tool_input: { project_id: 'refprod1', query: 'x' }, tool_response: { isError: true } });
  assert.deepEqual(leerEstado(raiz).circuito, []);
});

test('post-tool sin RQ → sin salida y sin escribir', () => {
  const raiz = repoDemo();
  const out = postTool({ cwd: raiz, tool_name: SB + 'apply_migration', tool_input: { project_id: 'refprod1', query: 'x' }, tool_response: {} });
  assert.equal(out, null);
  assert.equal(fs.existsSync(path.join(raiz, 'docs', 'rq')), false);
});

// --- session-start ---

const sessionStart = (cwd, env = ENV) =>
  json(correrHook('session-start', { hook_event_name: 'SessionStart', session_id: 's', transcript_path: TRANSCRIPT, cwd, source: 'startup' }, env));

test('session-start en un repo sin .bacg-lineamientos → stdout vacío', () => {
  const dir = crearRepoTemporal({});
  assert.equal(sessionStart(dir), null);
});

test('session-start fuera de un repo, con repos registrados debajo → CLI del RQ y la lista de repos', () => {
  const padre = tmp('padre como-');
  const hijo = path.join(padre, 'PunaAPP-dev', 'hq');
  fs.mkdirSync(hijo, { recursive: true });
  fs.writeFileSync(path.join(hijo, '.bacg-lineamientos'), 'proyecto: demo\n');
  const ctx = sessionStart(padre).hookSpecificOutput.additionalContext;
  assert.match(ctx, /repos registrados debajo/);
  assert.match(ctx, /PunaAPP-dev[\\/]hq/);
  assert.match(ctx, /CLI del RQ: node "/);
});

test('session-start con dos RQ activos muestra los dos encuadres', () => {
  const raiz = repoDemo();
  abrirRq(raiz, { codigo: 'R-T2' });
  abrirRq(raiz, { codigo: 'R-T1' });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-T2\nR-T1\n');
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-T2', 'spec.md'), '# R-T2 · dos');
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-T1', 'spec.md'), '# R-T1 · uno');
  const ctx = sessionStart(raiz).hookSpecificOutput.additionalContext;
  assert.match(ctx, /RQ activo: R-T2[\s\S]*R-T2 · dos[\s\S]*RQ activo: R-T1[\s\S]*R-T1 · uno/);
  assert.match(ctx, /RQ activo: R-T1 \(rq\), etapa 2 \(Desarrollo\)\./);
  assert.doesNotMatch(ctx, /relevo/i);
});

test('session-start en el demo: resumen, encuadre y plugins faltantes', () => {
  const raiz = repoDemo();
  const codigo = abrirRq(raiz);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), '# Encuadre\n\nFalta el paso 3.\n');
  const home = homeCon(['superpowers@superpowers-marketplace']);
  const out = sessionStart(raiz, { ...ENV, HOME: home, USERPROFILE: home });
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /Resumen general \(fixture\)/);
  assert.match(ctx, /Demo \(fixture\)/);
  assert.match(ctx, /Falta el paso 3\./);
  assert.match(ctx, /\/plugin install frontend-design@claude-plugins-official/);
  assert.doesNotMatch(ctx, /\/plugin install superpowers@superpowers-marketplace/);
});

test('session-start avisa si la copia de trabajo del plugin es más nueva que la instalada', () => {
  const raiz = repoDemo();
  const lin = tmp('lin como-');
  fs.cpSync(DIR_LIN, lin, { recursive: true });
  fs.mkdirSync(path.join(lin, 'plugin', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(lin, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'lineamientos-dev-claude-bacg', version: '0.10.0' }));
  const instalado = tmp('instalado como-');
  fs.mkdirSync(path.join(instalado, '.claude-plugin'));
  fs.writeFileSync(path.join(instalado, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'lineamientos-dev-claude-bacg', version: '0.9.3' }));
  const out = sessionStart(raiz, { ...ENV, BACG_LINEAMIENTOS_DIR: lin, CLAUDE_PLUGIN_ROOT: instalado });
  assert.match(out.hookSpecificOutput.additionalContext, /0\.10\.0.*0\.9\.3/);
  const igual = sessionStart(raiz, { ...ENV, BACG_LINEAMIENTOS_DIR: lin, CLAUDE_PLUGIN_ROOT: path.join(lin, 'plugin') });
  assert.doesNotMatch(igual.hookSpecificOutput.additionalContext, /más nueva/);
});

test('session-start da la ruta absoluta del CLI del RQ, que existe', () => {
  const raiz = repoDemo();
  const rutaCli = (env) => {
    const ctx = sessionStart(raiz, env).hookSpecificOutput.additionalContext;
    const m = ctx.match(/CLI del RQ: node "([^"]+)"/);
    assert.ok(m, 'falta la línea "CLI del RQ"');
    assert.ok(path.isAbsolute(m[1]), `ruta no absoluta: ${m[1]}`);
    assert.match(m[1], /scripts[\\/]rq\.mjs$/);
    assert.ok(fs.existsSync(m[1]), `no existe ${m[1]}`);
    return m[1];
  };
  assert.equal(path.resolve(rutaCli(ENV)), path.resolve(PLUGIN, 'scripts', 'rq.mjs'));
  // CLAUDE_PLUGIN_ROOT sin rq.mjs (o vacío): se resuelve desde la ubicación del propio hook.
  rutaCli({ ...ENV, CLAUDE_PLUGIN_ROOT: tmp('sin cli como-') });
  rutaCli({ ...ENV, CLAUDE_PLUGIN_ROOT: '' });
});

test('session-start corta los resúmenes a 6.000 caracteres', () => {
  const raiz = repoDemo();
  const lin = tmp('lin como-');
  fs.cpSync(DIR_LIN, lin, { recursive: true });
  fs.writeFileSync(path.join(lin, 'general', 'resumen.md'), 'x'.repeat(20000));
  const out = sessionStart(raiz, { ...ENV, BACG_LINEAMIENTOS_DIR: lin });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok((ctx.match(/x{100}/g) ?? []).join('').length <= 6000);
  assert.ok(ctx.length < 10000);
});

test('session-start inyecta sólo las primeras 30 líneas del encuadre', () => {
  const raiz = repoDemo();
  const codigo = abrirRq(raiz);
  const lineas = Array.from({ length: 80 }, (_, i) => `linea-${i + 1}`);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), lineas.join('\n'));
  const ctx = sessionStart(raiz).hookSpecificOutput.additionalContext;
  assert.match(ctx, /linea-30\b/);
  assert.doesNotMatch(ctx, /linea-31\b/);
});

test('session-start avisa si la cuenta activa de gh no es la del proyecto', () => {
  const conf = (usuario) => {
    const dir = tmp('gh como-');
    fs.writeFileSync(path.join(dir, 'hosts.yml'), `github.com:\n    user: ${usuario}\n    git_protocol: https\n`);
    return { ...process.env, GH_CONFIG_DIR: dir };
  };
  assert.match(avisoCuentaGh({ cuenta_github: 'duena' }, conf('otra')), /cuenta activa de gh es otra .*gh auth switch -u duena/);
  assert.equal(avisoCuentaGh({ cuenta_github: 'duena' }, conf('duena')), null);
  assert.equal(avisoCuentaGh({ cuenta_github: 'duena', cuenta_gh: 'colaborador' }, conf('colaborador')), null, 'cuenta_gh manda');
  assert.equal(avisoCuentaGh({}, conf('otra')), null, 'sin cuenta declarada');
  assert.equal(avisoCuentaGh({ cuenta_github: 'duena' }, { ...conf('otra'), BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' }), null);
});

// --- user-prompt ---

let sesiones = 0;
const userPrompt = (cwd, sesion = `up-${process.pid}-${Date.now()}-${sesiones++}`) =>
  json(correrHook('user-prompt', { hook_event_name: 'UserPromptSubmit', session_id: sesion, transcript_path: TRANSCRIPT, cwd, prompt: 'hola' }, ENV));

test('user-prompt: sin RQ activo recuerda una sola vez por sesión; con RQ activo, nada', () => {
  const raiz = repoDemo();
  const sesion = `up-unica-${process.pid}-${Date.now()}`;
  const sin = userPrompt(raiz, sesion).hookSpecificOutput;
  assert.equal(sin.hookEventName, 'UserPromptSubmit');
  assert.equal(
    sin.additionalContext,
    'Proyecto demo, sin RQ activo. Para cambiar código o base: skill lineamientos-dev-claude-bacg:ciclo-rq. Docs, tests y consultas no necesitan RQ.',
  );
  assert.equal(userPrompt(raiz, sesion), null, 'segunda vez en la misma sesión');
  abrirRq(raiz, { etapa: 2 });
  assert.equal(userPrompt(raiz), null);
});

test('user-prompt fuera de un repo registrado → nada', () => {
  assert.equal(userPrompt(tmp('suelto como-')), null);
});

const TIMEOUTS = { 'pre-tool': 30, 'post-tool': 30, 'session-start': 30, 'user-prompt': 10 };

test('hooks.json declara los cuatro eventos con sus matchers', () => {
  const h = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const esperado = {
    PreToolUse: ['pre-tool', 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|mcp__.*'],
    PostToolUse: ['post-tool', 'Bash|PowerShell|Skill|mcp__.*__(execute_sql|apply_migration)'],
    SessionStart: ['session-start', 'startup|resume|clear|compact'],
    UserPromptSubmit: ['user-prompt', undefined],
  };
  assert.deepEqual(Object.keys(h).sort(), Object.keys(esperado).sort());
  for (const [evento, [script, matcher]] of Object.entries(esperado)) {
    assert.equal(h[evento].length, 1, evento);
    assert.equal(h[evento][0].matcher, matcher, evento);
    assert.deepEqual(h[evento][0].hooks, [
      { type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/hooks/${script}.mjs"`, timeout: TIMEOUTS[script] },
    ]);
    assert.ok(fs.existsSync(path.join(PLUGIN, 'scripts', 'hooks', `${script}.mjs`)), script);
  }
});

test('cada handler vive en lib/hooks y se exporta', async () => {
  for (const n of ['pre-tool', 'post-tool', 'session-start', 'user-prompt']) {
    const m = await import(`../plugin/scripts/lib/hooks/${n}.mjs`);
    assert.equal(typeof m.handler, 'function', n);
  }
});

test('session-start sin copia de lineamientos usa el resumen general del plugin y el del repo', () => {
  const raiz = crearRepoTemporal({
    nombre: 'remoto-app',
    archivos: { '.bacg-dev/proyecto.yml': 'id: remoto\nrepos: []\n', '.bacg-dev/resumen.md': 'RESUMEN DEL REPO REMOTO' },
  });
  const ctx = sessionStart(raiz, { ...ENV, BACG_LINEAMIENTOS_DIR: tmp('sin lin como-') }).hookSpecificOutput.additionalContext;
  assert.match(ctx, /proyecto remoto/);
  assert.match(ctx, /RESUMEN DEL REPO REMOTO/);
  assert.match(ctx, /Cómo trabajamos/);
  assert.doesNotMatch(ctx, /Aviso: el proyecto/);
});

test('session-start avisa los commits de Lovable sin auditar', () => {
  const raiz = repoDemo();
  assert.doesNotMatch(sessionStart(raiz).hookSpecificOutput.additionalContext, /Auditoría:/);
  fs.mkdirSync(path.join(raiz, 'supabase', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'supabase', 'migrations', '1_a.sql'), 'select 1;');
  spawnSync('git', ['add', '-A'], { cwd: raiz });
  spawnSync('git', ['-c', 'user.name=gpt-engineer-app[bot]', '-c', 'user.email=bot@x.dev', 'commit', '-qm', 'Changes'], { cwd: raiz });
  assert.match(sessionStart(raiz).hookSpecificOutput.additionalContext, /Auditoría: 1 commit\(s\) de Lovable sin revisar .*1 con migraciones/);
});

test('session-start incluye el texto de arranque (inicio y reanudación)', () => {
  const raiz = repoDemo();
  let ctx = sessionStart(raiz).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Arranque: inicio/);
  assert.match(ctx, /Lo último/);
  abrirRq(raiz);
  ctx = sessionStart(raiz).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Dónde nos quedamos/);
  assert.match(ctx, /RQ activo: R-T1/); // lo anterior sigue
});

test('session-start en carpeta padre con dos repos, uno con RQ activo → arranque de ambos y reanudación', () => {
  const padre = tmp('padre como-');
  const uno = path.join(padre, 'repo-uno');
  const dos = path.join(padre, 'repo-dos');
  for (const d of [uno, dos]) {
    fs.mkdirSync(d);
    spawnSync('git', ['init', '-q'], { cwd: d });
    fs.writeFileSync(path.join(d, '.bacg-lineamientos'), 'proyecto: demo\n');
  }
  abrirRq(dos);
  const ctx = sessionStart(padre).hookSpecificOutput.additionalContext;
  assert.match(ctx, /repos registrados debajo/);
  assert.match(ctx, /preguntale al usuario en qué proyecto/);
  assert.match(ctx, /- repo-uno: /);
  assert.match(ctx, /- repo-dos: /);
  assert.match(ctx, /Dónde nos quedamos: RQ R-T1/);
});
