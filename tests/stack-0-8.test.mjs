// 0.8.0: stack configurable (Supabase + Lovable por defecto, otros motores declarados) y PROD por rama destino.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluarBash, ramasDestino, publicaEnProd } from '../plugin/scripts/lib/compuerta-bash.mjs';
import { ramasSoloPr, motorDatos, globsMigraciones, esMigracion, basesProd, autoresExternos, ramasProd, baseDelRepo, lineaStack, AUTORES_LOVABLE } from '../plugin/scripts/lib/stack.mjs';
import { corresponde } from '../plugin/scripts/lib/circuito.mjs';
import { rutaQueImpide } from '../plugin/scripts/lib/no-aplica.mjs';
import { seccionAgents } from '../plugin/scripts/lib/agents.mjs';
import { guardarEstado, cargarEstado } from '../plugin/scripts/lib/estado.mjs';
import { handler as postTool } from '../plugin/scripts/lib/hooks/post-tool.mjs';
import { shellDeTests } from '../plugin/scripts/lib/cli.mjs';
import { evaluarEdicion } from '../plugin/scripts/lib/compuerta-edicion.mjs';
import { crearRepoTemporal, sesionDePrueba } from './helpers.mjs';
import { main as mainRq } from '../plugin/scripts/rq.mjs';

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

const ODOO = {
  datos: { motor: 'odoo', migraciones: ['**/migrations/**'] },
  entornos: { prod: { bases: ['erp-prod'] } },
  agentes_externos: { autores: ['ci-bot'] },
};

// ---------- stack.mjs ----------

test('stack por defecto: sin motor declarado (null), migraciones genéricas y sin agentes externos; Supabase sólo si se declaran refs o Lovable', () => {
  assert.equal(motorDatos({}), null);
  assert.deepEqual(globsMigraciones({}), ['**/migrations/**']);
  assert.equal(esMigracion('addons/x/migrations/18.0.1/post.py', {}), true);
  assert.deepEqual(autoresExternos({}), []);
  assert.deepEqual(autoresExternos({ lovable: { autores: ['x[bot]'] } }), ['x[bot]']);
  assert.deepEqual(autoresExternos({ lovable: { proyectos: { app: 'p' } } }), AUTORES_LOVABLE);
  assert.equal(motorDatos({ entornos: { prod: { supabase_refs: ['r'] } } }), 'supabase');
  assert.equal(motorDatos({ repos: [{ nombre: 's', supabase_ref: 'r' }] }), 'supabase');
  assert.equal(esMigracion('supabase/migrations/1.sql', { lovable: { proyectos: { app: 'p' } } }), true);
  assert.equal(ramasProd({}, { nombre: 'a' }), null);
});

test('stack declarado: otro motor, sus migraciones, bases y agentes externos', () => {
  assert.equal(motorDatos(ODOO), 'odoo');
  assert.equal(esMigracion('powerfy_x/migrations/18.0.1.1/pre-migrate.py', ODOO), true);
  assert.equal(esMigracion('supabase/seed.sql', ODOO), false);
  assert.deepEqual(basesProd({ entornos: { prod: { supabase_refs: ['A'], bases: ['b', 'a'] } } }), ['a', 'b']);
  assert.deepEqual(autoresExternos(ODOO), ['ci-bot']);
  assert.deepEqual(globsMigraciones({ datos: { motor: 'ninguno' } }), []);
  assert.deepEqual(globsMigraciones({ datos: { migraciones: [] } }), [], 'lista vacía = sin migraciones versionadas');
  assert.equal(baseDelRepo({ base: 'b1' }), 'b1');
  assert.equal(baseDelRepo({ supabase_ref: 'r1' }), 'r1');
});

test('ramas_prod: la del repo manda sobre la del proyecto; un string vale como lista', () => {
  assert.deepEqual(ramasProd({ ramas_prod: ['main'] }, { nombre: 'a' }), ['main']);
  assert.deepEqual(ramasProd({ ramas_prod: ['main'] }, { nombre: 'a', ramas_prod: '18.0' }), ['18.0']);
});

test('circuito y no-aplica usan las migraciones del proyecto', () => {
  assert.equal(corresponde('sql:erp-prod', ['m/migrations/1/x.py'], {}, ODOO), true);
  assert.equal(corresponde('sql:erp-prod', ['m/models/x.py'], {}, ODOO), false);
  assert.equal(corresponde('sql:refa', ['supabase/migrations/1.sql']), true, 'sin proyecto: el default de Supabase');
  assert.equal(rutaQueImpide('sql:erp-prod', ['m/migrations/1/x.py'], ODOO), 'm/migrations/1/x.py');
});

test('AGENTS.md nombra las bases y las migraciones del stack declarado', () => {
  const s = seccionAgents({ id: 'erp', ...ODOO });
  assert.match(s, /`erp-prod`/);
  assert.match(s, /`\*\*\/migrations\/\*\*`/);
  assert.doesNotMatch(s, /supabase\/migrations/);
});

test('AGENTS.md nombra las etapas con la numeración v4', () => {
  const s = seccionAgents({ id: 'erp', ...ODOO });
  assert.match(s, /0 Arranque y clasificación · 1 Diseño y plan · 2 Desarrollo · 3 Verificación · 4 DEV \/ Preview · 5 PROD y entrega · 6 Cierre/);
  assert.doesNotMatch(s, /\b7 Cierre\b/);
});

// ---------- P1: PROD por rama destino ----------

/** Repo con remoto y la rama `rama` con upstream origin/<rama>. */
function repoConUpstream(nombre, rama) {
  // El nombre del repo sale de la URL del remoto: <tmp>/<nombre>.git.
  const remoto = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'remoto ')), `${nombre}.git`);
  fs.mkdirSync(remoto);
  git(remoto, 'init', '-q', '--bare');
  const raiz = crearRepoTemporal({ proyectoId: 'erp', nombre });
  git(raiz, 'remote', 'add', 'origin', remoto);
  git(raiz, 'checkout', '-q', '-b', rama);
  git(raiz, 'push', '-q', '-u', 'origin', rama);
  return raiz;
}

const PROY = (extra = '') =>
  'id: erp\nramas_prod: ["18.0"]\nrepos:\n  - { nombre: erp-app, rol: padre, push_prod: true }\n' +
  'circuito_prod:\n  - { paso: "push:erp-app" }\n' + extra;

test('ramasDestino: upstream, refspecs, HEAD y --all', () => {
  const raiz = repoConUpstream('erp-app', '18.0-dev');
  assert.deepEqual(ramasDestino({ op: 'push' }, raiz), ['18.0-dev']);
  assert.deepEqual(ramasDestino({ op: 'push', refspecs: ['HEAD:18.0'] }, raiz), ['18.0']);
  assert.deepEqual(ramasDestino({ op: 'push', refspecs: ['18.0-dev:refs/heads/18.0'] }, raiz), ['18.0']);
  assert.deepEqual(ramasDestino({ op: 'push', refspecs: ['HEAD'] }, raiz), ['18.0-dev']);
  assert.equal(ramasDestino({ op: 'push', amplio: true }, raiz), null);
  assert.deepEqual(ramasDestino({ op: 'merge-pr', pr: '3' }, raiz, { basePr: () => '18.0' }), ['18.0']);
});

test('publicaEnProd: sólo las ramas de ramas_prod; sin ramas_prod, todo push a un repo PROD', () => {
  const raiz = repoConUpstream('erp-app', '18.0-dev');
  const proyecto = { ramas_prod: ['18.0'] };
  const entrada = { nombre: 'erp-app', push_prod: true };
  assert.equal(publicaEnProd({ op: 'push' }, raiz, proyecto, entrada), false, 'push diario a 18.0-dev: DEV');
  assert.equal(publicaEnProd({ op: 'push', refspecs: ['HEAD:18.0'] }, raiz, proyecto, entrada), true);
  assert.equal(publicaEnProd({ op: 'push', refspecs: ['18.0-dev:18.0'] }, raiz, proyecto, entrada), true);
  assert.equal(publicaEnProd({ op: 'push', amplio: true }, raiz, proyecto, entrada), true, '--all: falla cerrada');
  assert.equal(publicaEnProd({ op: 'push' }, raiz, {}, entrada), true, 'sin ramas_prod: como antes');
  assert.equal(publicaEnProd({ op: 'push' }, raiz, proyecto, { ...entrada, push_prod: false }), false);
  assert.equal(publicaEnProd({ op: 'push' }, raiz, proyecto, undefined), true, 'repo fuera de proyecto.repos: PROD');
  assert.equal(publicaEnProd({ op: 'merge-pr' }, raiz, proyecto, entrada, { basePr: () => '18.0-dev' }), false);
  assert.equal(publicaEnProd({ op: 'merge-pr' }, raiz, proyecto, entrada, { basePr: () => '18.0' }), true);
});

test('compuerta: push a la rama de DEV pide la etapa 3 pero no el OK de PROD; a la de PROD, sí', () => {
  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin '));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'erp'), { recursive: true });
  fs.writeFileSync(path.join(dirLin, 'proyectos', 'erp', 'proyecto.yml'), PROY());
  const raiz = repoConUpstream('erp-app', '18.0-dev');
  fs.writeFileSync(path.join(raiz, 'a.py'), 'x\n');
  git(raiz, 'add', 'a.py');
  git(raiz, 'commit', '-q', '-m', 'R-1: a');
  const estado = {
    codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', etapa: 3, autonomia: null, aprobaciones: [], saltos: [], circuito: [],
    tests: { ok: true, arbol: 'x' }, revision: { ok: true },
  };
  guardarEstado(raiz, estado);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-1\n');
  const ev = (comando) => evaluarBash({ comando, cwd: raiz, ctx: { textosUsuario: [] }, dirLin });
  assert.deepEqual(ev('git push'), { decision: 'allow', critica: false });
  const prod = ev('git push origin HEAD:18.0');
  assert.equal(prod.decision, 'deny');
  assert.equal(prod.critica, true);
  assert.match(prod.motivo, /es PROD: falta el OK del usuario para PROD \(etapa 5\)/);
  guardarEstado(raiz, { ...estado, tests: { ok: false } , revision: null });
  assert.equal(ev('git push').decision, 'deny', 'la rama de DEV sigue pidiendo la etapa 3');
});

// ---------- P3: shell de los tests ----------

test('shellDeTests: el del sistema por defecto; bash = Git Bash en Windows', () => {
  assert.equal(shellDeTests({}), true);
  assert.equal(shellDeTests({ tests: { shell: 'sistema' } }), true);
  assert.equal(shellDeTests({ tests: { shell: 'bash' } }, { platform: 'linux' }), 'bash');
  assert.equal(
    shellDeTests({ tests: { shell: 'bash' } }, { platform: 'win32', existe: (r) => r.startsWith('C:/Program Files/Git') }),
    'C:/Program Files/Git/bin/bash.exe',
  );
  assert.equal(shellDeTests({ tests: { shell: 'bash' } }, { platform: 'win32', existe: () => false }), 'bash');
  assert.equal(shellDeTests({ tests: { shell: '/usr/bin/zsh' } }), '/usr/bin/zsh');
});

// ---------- P4: refuerzo de UI en todo RQ ----------

const PROY_SCSS = { ui: { patrones: ['**/*.scss', '**/views/**/*.xml'], skills: [] } };

function repoUi({ spec = '# R-U1\n## Diseño\nCanon, dirección, estados, móvil.\n', archivos = {} } = {}) {
  const raiz = crearRepoTemporal({ archivos });
  // Diseño aprobado (etapa 1): sin eso la compuerta de edición niega antes de mirar el refuerzo de UI.
  const diseno = [{ etapa: 1, frase: 'Diseño ok', fecha: '2026-11-06T12:00:00Z' }];
  guardarEstado(raiz, { codigo: 'R-U1', tipo: 'rq', clasificacion: 'bounded', etapa: 2, autonomia: null, aprobaciones: diseno, saltos: [] });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-U1\n');
  if (spec !== null) fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-U1', 'spec.md'), spec);
  return raiz;
}
const editar = (raiz, rel, skills = []) =>
  evaluarEdicion({ raiz, proyecto: PROY_SCSS, rutaArchivo: path.join(raiz, rel), ctx: { skills: new Set(skills) } });

test('P4: un RQ bounded que edita un .scss de ui.patrones sin diseno-frontend queda bloqueado (aunque ui.skills esté vacío)', () => {
  const raiz = repoUi();
  const r = editar(raiz, 'web/static/nuevo.scss');
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /diseno-frontend/);
  assert.deepEqual(editar(raiz, 'web/static/nuevo.scss', ['lineamientos-dev-claude-bacg:diseno-frontend']), { decision: 'allow' }, 'archivo nuevo: sólo diseno-frontend');
});

test('P4: pantalla existente pide además redesign-existing-projects', () => {
  const raiz = repoUi({ archivos: { 'web/static/botones.scss': '.a{}\n' } });
  const r = editar(raiz, 'web/static/botones.scss', ['lineamientos-dev-claude-bacg:diseno-frontend']);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /pantalla existente: cargá antes la skill redesign-existing-projects/);
  assert.deepEqual(
    editar(raiz, 'web/static/botones.scss', ['lineamientos-dev-claude-bacg:diseno-frontend', 'lineamientos-dev-claude-bacg:redesign-existing-projects']),
    { decision: 'allow' },
  );
});

test('P4: sin la sección de diseño en spec.md, la edición de UI queda bloqueada', () => {
  const raiz = repoUi({ spec: '# R-U1\n## Qué\nBotonera.\n' });
  const r = editar(raiz, 'web/static/nuevo.scss', ['lineamientos-dev-claude-bacg:diseno-frontend']);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /falta la sección de diseño en docs\/rq\/R-U1\/spec\.md/);
  assert.deepEqual(editar(raiz, 'web/models/x.py'), { decision: 'allow' }, 'lo que no es UI no lo pide');
});

// ---------- P5.1: skills de una sesión que corre fuera del repo ----------

function repoConRq(padre, nombre, codigo) {
  const raiz = path.join(padre, nombre);
  fs.mkdirSync(raiz);
  git(raiz, 'init', '-q');
  fs.writeFileSync(path.join(raiz, '.bacg-lineamientos'), 'proyecto: erp\n');
  guardarEstado(raiz, { codigo, tipo: 'rq', clasificacion: 'bounded', etapa: 1, autonomia: null, aprobaciones: [], saltos: [] });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), `${codigo}\n`);
  return raiz;
}
const skillsEn = (raiz, codigo) => (cargarEstado(raiz, codigo).skills ?? []).map((s) => s.skill ?? s);

function transcriptCon(dir, usos) {
  const t = path.join(dir, 'sesion.jsonl');
  const lineas = usos.map(([name, input, cwd]) =>
    JSON.stringify({ type: 'assistant', cwd, message: { content: [{ type: 'tool_use', name, input }] } }));
  fs.writeFileSync(t, `${lineas.join('\n')}\n`);
  return t;
}

test('P5: sesión en la carpeta que agrupa los repos: la skill va al RQ del repo que tocó', async () => {
  const padre = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace '));
  const a = repoConRq(padre, 'erp-addons', 'PF-1');
  const b = repoConRq(padre, 'erp-bi', 'PF-2');
  const t = transcriptCon(padre, [['Edit', { file_path: path.join(a, 'm', 'x.py') }, padre]]);
  await postTool({ tool_name: 'Skill', tool_input: { skill: 'superpowers:writing-plans' }, cwd: padre, transcript_path: t, session_id: 's1' });
  assert.deepEqual(skillsEn(a, 'PF-1'), ['superpowers:writing-plans']);
  assert.deepEqual(skillsEn(b, 'PF-2'), [], 'el repo que no tocó no la hereda');
});

test('P5: un RQ que abarca dos repos registra la skill en los dos (cd y git -C del Bash cuentan)', async () => {
  const padre = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace '));
  const a = repoConRq(padre, 'erp-addons', 'PF-UI');
  const b = repoConRq(padre, 'erp-bi', 'PF-UI');
  const t = transcriptCon(padre, [
    ['Bash', { command: 'cd erp-addons && git status' }, padre],
    ['Bash', { command: `git -C "${b}" log -1` }, padre],
  ]);
  await postTool({ tool_name: 'Skill', tool_input: { skill: 'lineamientos-dev-claude-bacg:diseno-frontend' }, cwd: padre, transcript_path: t });
  assert.deepEqual(skillsEn(a, 'PF-UI'), ['lineamientos-dev-claude-bacg:diseno-frontend']);
  assert.deepEqual(skillsEn(b, 'PF-UI'), ['lineamientos-dev-claude-bacg:diseno-frontend']);
});

test('P5: sin rutas en el transcript, las subcarpetas del cwd que son repos con RQ activo', async () => {
  const padre = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace '));
  const a = repoConRq(padre, 'erp-addons', 'PF-3');
  await postTool({ tool_name: 'Skill', tool_input: { skill: 'superpowers:brainstorming' }, cwd: padre });
  assert.deepEqual(skillsEn(a, 'PF-3'), ['superpowers:brainstorming']);
});

test('lineaStack: el arranque dice el stack declarado (y el de referencia cuando no se declara nada)', () => {
  const def = lineaStack({ lovable: { proyectos: { app: 'x' } }, entornos: { dev: { tipo: 'lovable-preview' } } });
  assert.match(def, /datos supabase \(migraciones supabase\/migrations\/\*\*\)/);
  assert.match(def, /PROD = todo push a un repo con push_prod/);
  assert.match(def, /agentes sin el plugin: Lovable/);
  const erp = lineaStack({ ...ODOO, ramas_prod: ['18.0'], datos: { ...ODOO.datos, aplicar: 'odoo -u <módulos>' }, entornos: { dev: { tipo: 'rama', rama: '18.0-dev' } } });
  assert.match(erp, /datos odoo \(migraciones \*\*\/migrations\/\*\*; se aplican con: odoo -u <módulos>\)/);
  assert.match(erp, /PROD = push o merge a 18\.0/);
  assert.match(erp, /DEV rama 18\.0-dev/);
  assert.match(erp, /agentes sin el plugin: los de agentes_externos/);
  assert.match(lineaStack({}), /datos sin declarar .* MCP de PROD: ninguno declarado .* agentes sin el plugin: ninguno declarado/);
  assert.doesNotMatch(lineaStack({}), /odoo/i, 'sin Odoo declarado, la línea del arranque no lo nombra');
  assert.match(lineaStack({ mcp_prod: [{ servidor: 'n8n-prod', tipo: 'n8n' }] }), /MCP de PROD: n8n-prod \(n8n\)/);
});

// ---------- Cambio menor: saltar ui ----------

test('saltar ui (cambio menor aceptado por el usuario): sin diseno-frontend, redesign ni ## Diseño; el canon sigue', () => {
  const raiz = repoUi({ spec: '# R-U1\n## Qué\nCambiar el texto del botón.\n', archivos: { 'web/static/botones.scss': '.a{}\n' } });
  const sinSalto = editar(raiz, 'web/static/botones.scss');
  assert.match(sinSalto.motivo, /Si el cambio es menor, preguntale al usuario en el chat \(texto, no botones\)/);
  const e = cargarEstado(raiz, 'R-U1');
  guardarEstado(raiz, { ...e, saltos: [{ compuerta: 'ui', frase: 'sí, omitilo', motivo: 'texto del botón', fecha: '2026-10-30T12:00:00Z' }] });
  assert.deepEqual(editar(raiz, 'web/static/botones.scss'), { decision: 'allow' });
  // Las skills del canon del proyecto se siguen pidiendo.
  const conCanon = { ui: { ...PROY_SCSS.ui, skills: ['canon-erp'] } };
  const r = evaluarEdicion({ raiz, proyecto: conCanon, rutaArchivo: path.join(raiz, 'web/static/botones.scss'), ctx: { skills: new Set() } });
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /cargá antes la skill canon-erp \(/);
  assert.doesNotMatch(r.motivo, /diseno-frontend|Si el cambio es menor/);
});

test('rq.mjs saltar acepta la compuerta ui', async () => {
  const raiz = repoUi();
  fs.writeFileSync(path.join(raiz, '.bacg-lineamientos'), 'proyecto: erp\n');
  const sesion = sesionDePrueba('sí, omitilo');
  let out = '';
  let err = '';
  const code = await mainRq(['saltar', 'ui', 'sí, omitilo', 'texto del botón'], {
    cwd: raiz, env: { ...process.env, ...sesion.env }, home: sesion.home,
    stdout: { write: (x) => { out += x; } }, stderr: { write: (x) => { err += x; } },
  });
  assert.equal(code, 0, err);
  assert.match(out, /Salto de la compuerta ui registrado/);
  assert.equal(cargarEstado(raiz, 'R-U1').saltos.at(-1).compuerta, 'ui');
});

test('ramas_solo_pr: push directo a 18.0-dev se niega y pide PR; push de la rama propia y merge del PR siguen', () => {
  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin '));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'erp'), { recursive: true });
  fs.writeFileSync(path.join(dirLin, 'proyectos', 'erp', 'proyecto.yml'), PROY('ramas_solo_pr: ["18.0-dev"]\n'));
  const raiz = repoConUpstream('erp-app', '18.0-dev');
  const estado = {
    codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', etapa: 3, autonomia: null, aprobaciones: [], saltos: [], circuito: [],
    tests: { ok: true, arbol: 'x' }, revision: { ok: true },
  };
  guardarEstado(raiz, estado);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-1\n');
  const ev = (comando, ctx = {}) => evaluarBash({ comando, cwd: raiz, ctx: { textosUsuario: [], ...ctx }, dirLin });
  const r = ev('git push');
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /18\.0-dev sólo recibe cambios por PR.*gh pr create --base 18\.0-dev/);
  assert.equal(ev('git push origin HEAD:18.0-dev').decision, 'deny');
  assert.deepEqual(ev('git push -u origin HEAD:rq/R-1'), { decision: 'allow', critica: false }, 'rama propia del RQ');
  assert.equal(ev('gh pr merge 12 --merge', { basePr: () => '18.0-dev' }).decision, 'allow', 'el merge del PR a DEV sigue la etapa 3');
  assert.deepEqual(ramasSoloPr({ ramas_solo_pr: ['18.0-dev'] }, { nombre: 'x', ramas_solo_pr: [] }), [], 'el repo manda');
});
