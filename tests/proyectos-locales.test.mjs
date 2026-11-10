// PLG-DFF (pedido 3 de dev-fullflow): con la configuración en .bacg-dev/ de cada repo, una sesión abierta
// fuera del repo (la carpeta que agrupa los clones, u otro repo) tiene que seguir protegiendo la PROD del proyecto:
// los proyectos propios se encuentran debajo de la carpeta de trabajo o por `proyectos.<id>.raiz` de
// ~/.claude/bacg-dev.json, no sólo en proyectos/<id>/ de la copia del plugin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearRepoTemporal, correrHook } from './helpers.mjs';
import { proyectosLocales } from '../plugin/scripts/lib/proyectos-locales.mjs';

const LOV = 'mcp__1d1c8098-ee55-4718-b381-babd223e1b53__';
const SB = 'mcp__c57e95c1-9b90-4ee5-a961-dcd94156bdf7__';
const REF = 'refprodx1';
const PY_LOVABLE = `id: px\nnombre: PX\nrepos:\n  - { nombre: app-x, rol: padre }\nentornos:\n  prod: { supabase_refs: [${REF}] }\nlovable:\n  proyectos:\n    app-x: "lovx1"\n`;
const PY_SIN_LOVABLE = 'id: py\nnombre: PY\nrepos:\n  - { nombre: app-y, rol: padre }\n';

const repoCon = (yml, nombre) => crearRepoTemporal({ nombre, archivos: { '.bacg-dev/proyecto.yml': yml } });
const homeVacio = () => fs.mkdtempSync(path.join(os.tmpdir(), 'home bacg-'));
const env = (home) => ({ HOME: home, USERPROFILE: home });

function hook(cwd, tool, input, home = homeVacio()) {
  const r = correrHook('pre-tool', { hook_event_name: 'PreToolUse', cwd, session_id: 's', transcript_path: '', tool_name: tool, tool_input: input }, env(home));
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.includes('"deny"') ? 'deny' : 'pasa';
}

test('proyectosLocales encuentra el repo con .bacg-dev/ debajo de la carpeta de trabajo', () => {
  const repo = repoCon(PY_LOVABLE, 'app-x');
  const padre = path.dirname(repo);
  const ps = proyectosLocales({ cwd: padre, home: homeVacio() });
  assert.deepEqual(ps.map((p) => [p.id, path.resolve(p.raiz)]), [['px', path.resolve(repo)]]);
});

test('proyectosLocales usa proyectos.<id>.raiz de ~/.claude/bacg-dev.json', () => {
  const repo = repoCon(PY_LOVABLE, 'app-x');
  const home = homeVacio();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'bacg-dev.json'), JSON.stringify({ proyectos: { px: { raiz: repo } } }));
  const ps = proyectosLocales({ cwd: os.tmpdir(), home });
  assert.ok(ps.some((p) => p.id === 'px' && path.resolve(p.raiz) === path.resolve(repo)));
});

test('hook desde la carpeta que agrupa los clones: deploy de Lovable del proyecto propio sin RQ → deny', () => {
  const repo = repoCon(PY_LOVABLE, 'app-x');
  assert.equal(hook(path.dirname(repo), LOV + 'deploy_project', { project_id: 'lovx1' }), 'deny');
});

test('hook desde la carpeta que agrupa los clones: SQL de escritura a la PROD propia sin RQ → deny', () => {
  const repo = repoCon(PY_LOVABLE, 'app-x');
  assert.equal(hook(path.dirname(repo), SB + 'execute_sql', { project_id: REF, query: 'update t set x = 1' }), 'deny');
});

test('hook desde otra carpeta, con la raíz en bacg-dev.json: deploy de Lovable propio sin RQ → deny', () => {
  const repo = repoCon(PY_LOVABLE, 'app-x');
  const home = homeVacio();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'bacg-dev.json'), JSON.stringify({ proyectos: { px: { raiz: repo } } }));
  const otra = fs.mkdtempSync(path.join(os.tmpdir(), 'otra carpeta-'));
  assert.equal(hook(otra, LOV + 'deploy_project', { project_id: 'lovx1' }, home), 'deny');
});

test('hook desde la carpeta que agrupa los clones: un project_id ajeno pasa', () => {
  const repo = repoCon(PY_LOVABLE, 'app-x');
  assert.equal(hook(path.dirname(repo), LOV + 'deploy_project', { project_id: 'de-otra-org' }), 'pasa');
  assert.equal(hook(path.dirname(repo), SB + 'execute_sql', { project_id: 'ref-ajena', query: 'update t set x = 1' }), 'pasa');
});

test('hook dentro del repo propio con Lovable y sin RQ → deny; sin Lovable declarado → pasa', () => {
  assert.equal(hook(repoCon(PY_LOVABLE, 'app-x'), LOV + 'deploy_project', { project_id: 'lovx1' }), 'deny');
  assert.equal(hook(repoCon(PY_SIN_LOVABLE, 'app-y'), LOV + 'deploy_project', { project_id: 'lovx1' }), 'pasa');
});
