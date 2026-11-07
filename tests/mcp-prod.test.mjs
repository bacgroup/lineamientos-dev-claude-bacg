import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarMcp } from '../plugin/scripts/lib/compuerta-mcp.mjs';
import { servidorDe, clasificarMcp } from '../plugin/scripts/lib/mcp-prod.mjs';

const proyecto = {
  id: 'demo',
  mcp_prod: [
    { servidor: 'n8n-prod', tipo: 'n8n' },
    { servidor: 'odoo_prod', tipo: 'odoo', lectura: ['report'] },
    { servidor: 'n8n-compartido', tipo: 'n8n', ids_prod: ['wfPROD'] },
  ],
};
const FRASE_PROD = 'Publicá el workflow a producción';
const rqProd = { codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', etapa: 5, aprobaciones: [{ etapa: 5, frase: FRASE_PROD, fecha: '2026-11-04T12:00:00Z' }], saltos: [], circuito: [] };
const ev = (tool, input = {}, estado = null, textos = []) =>
  evaluarMcp({ toolName: tool, toolInput: input, proyecto, estado, ctx: { textosUsuario: textos, raiz: null } });

test('servidorDe normaliza el segmento del servidor', () => {
  assert.equal(servidorDe('mcp__n8n-prod__publish_workflow'), 'n8n_prod');
  assert.equal(servidorDe('mcp__claude_ai_n8n_prod__get_workflow_details'), 'claude_ai_n8n_prod');
  assert.equal(servidorDe('Bash'), '');
});

test('n8n de PROD: lectura pasa sin RQ', () => {
  for (const t of ['get_workflow_details', 'search_workflows', 'validate_workflow', 'list_credentials', 'explore_node_resources']) {
    assert.equal(ev(`mcp__n8n-prod__${t}`).decision, 'allow', t);
  }
});

test('n8n de PROD: escritura sin RQ → deny crítica; con OK de PROD en la sesión → allow', () => {
  for (const t of ['publish_workflow', 'update_workflow', 'archive_workflow', 'execute_workflow', 'test_workflow', 'create_workflow_from_code', 'call_agent', 'add_data_table_rows']) {
    const r = ev(`mcp__n8n-prod__${t}`, { workflowId: 'x' });
    assert.equal(r.decision, 'deny', t);
    assert.equal(r.critica, true);
  }
  assert.match(ev('mcp__n8n-prod__publish_workflow', {}, { ...rqProd, aprobaciones: [] }).motivo, /etapa 5/);
  assert.equal(ev('mcp__n8n-prod__publish_workflow', {}, rqProd, [FRASE_PROD]).decision, 'allow');
});

test('servidor con prefijo de conector (claude_ai_, plugin_) también se reconoce', () => {
  assert.equal(ev('mcp__claude_ai_n8n_prod__publish_workflow').decision, 'deny');
});

test('un servidor no declarado no se toca', () => {
  assert.equal(ev('mcp__n8n__publish_workflow').decision, 'allow');
  assert.equal(clasificarMcp(proyecto, 'mcp__n8n__publish_workflow', {}), null);
});

test('Odoo de PROD: herramientas de lectura y métodos de lectura pasan; escritura no', () => {
  assert.equal(ev('mcp__odoo_prod__odoo_search_read', { model: 'res.partner' }).decision, 'allow');
  assert.equal(ev('mcp__odoo_prod__report_ventas').decision, 'allow', 'lectura extra declarada');
  assert.equal(ev('mcp__odoo_prod__execute_kw', { model: 'res.partner', method: 'search_read' }).decision, 'allow');
  assert.equal(ev('mcp__odoo_prod__execute_kw', { model: 'res.partner', method: 'write' }).decision, 'deny');
  assert.equal(ev('mcp__odoo_prod__odoo_create', { model: 'res.partner' }).decision, 'deny');
  assert.equal(ev('mcp__odoo_prod__unlink_records').decision, 'deny');
});

test('ids_prod: sólo esos ids son PROD; sin id reconocible, falla cerrada', () => {
  assert.equal(ev('mcp__n8n-compartido__update_workflow', { workflowId: 'wfDEV' }).decision, 'allow');
  assert.equal(ev('mcp__n8n-compartido__update_workflow', { workflowId: 'wfPROD' }).decision, 'deny');
  assert.equal(ev('mcp__n8n-compartido__create_workflow_from_code', { code: '...' }).decision, 'deny');
});
