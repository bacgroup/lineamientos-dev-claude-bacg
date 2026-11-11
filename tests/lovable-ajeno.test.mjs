// PLG-DFF (pedido 1 de dev-fullflow): la compuerta de Lovable sólo actúa en proyectos reconocidos que declaran Lovable, para no
// frenar el trabajo de otro plugin u organización en un repo que este plugin no reconoce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarMcp } from '../plugin/scripts/lib/compuerta-mcp.mjs';
import { crearRepoTemporal, correrHook } from './helpers.mjs';

const LOV = 'mcp__1d1c8098-ee55-4718-b381-babd223e1b53__';
const conLovable = { id: 'x', repos: [{ nombre: 'x' }], lovable: { proyectos: { x: 'lovprj1' } } };
const sinLovable = { id: 'x', repos: [{ nombre: 'x' }] };

for (const herramienta of ['deploy_project', 'respond_to_approval']) {
  test(`${herramienta}: proyecto con Lovable y sin RQ → deny`, () => {
    const r = evaluarMcp({ toolName: LOV + herramienta, toolInput: { project_id: 'lovprj1' }, proyecto: conLovable, ctx: {} });
    assert.equal(r.decision, 'deny');
  });

  test(`${herramienta}: proyecto sin Lovable declarado → allow`, () => {
    const r = evaluarMcp({ toolName: LOV + herramienta, toolInput: { project_id: 'lovprj1' }, proyecto: sinLovable, ctx: {} });
    assert.equal(r.decision, 'allow');
  });

  test(`${herramienta}: sin proyecto (repo ajeno) → allow`, () => {
    const r = evaluarMcp({ toolName: LOV + herramienta, toolInput: { project_id: 'lovprj1' }, proyecto: undefined, ctx: {} });
    assert.equal(r.decision, 'allow');
  });
}

test('hook PreToolUse: deploy de Lovable en un repo que el plugin no reconoce no se niega', () => {
  const dir = crearRepoTemporal({});
  const r = correrHook('pre-tool', {
    hook_event_name: 'PreToolUse', cwd: dir, session_id: 's', transcript_path: '',
    tool_name: LOV + 'deploy_project', tool_input: { project_id: 'lovprj1' },
  });
  assert.equal(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'), r.stdout);
});
