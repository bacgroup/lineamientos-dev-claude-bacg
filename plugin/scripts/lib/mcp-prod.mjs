// Servidores MCP de PROD declarados por el proyecto (stack BACG: n8n y Odoo, o cualquier otro conector).
//
// proyecto.yml:
//   mcp_prod:
//     - servidor: n8n-prod     # el segmento de mcp__<servidor>__<herramienta> (nombre o id), sin distinguir
//       tipo: n8n              # mayúsculas ni - / _ ; n8n | odoo | generico: define qué herramientas leen
//       lectura: ["get_"]      # opcional: prefijos o nombres extra de herramientas de sólo lectura
//       ids_prod: ["wf123"]    # opcional: sólo estos ids (workflow, agente, tabla) son PROD; una escritura
//                              # sin id reconocible sigue siendo PROD (falla cerrada)
//
// Falla cerrada: toda herramienta de un servidor declarado que no se reconoce como lectura es escritura a PROD.

const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const lista = (x) => (Array.isArray(x) ? x : []);
const normServidor = (x) => (typeof x === 'string' ? x.trim().toLowerCase().replace(/[^a-z0-9]/g, '_') : '');

// Verbos de lectura (primer token del nombre de la herramienta, salteando el nombre del tipo: odoo_search → search).
const LECTURA_GENERICA = ['get', 'search', 'list', 'read', 'fetch', 'find', 'describe', 'count', 'show', 'view'];
const LECTURA_TIPO = {
  // n8n: validate/explore/expand/discover/verify no escriben. test_workflow, execute_workflow y call_agent
  // corren workflows o agentes reales (pueden tener efectos): son escritura.
  n8n: [...LECTURA_GENERICA, 'validate', 'explore', 'expand', 'discover', 'verify'],
  odoo: [...LECTURA_GENERICA, 'search_read', 'search_count', 'read_group', 'fields_get', 'name_search', 'check'],
  generico: LECTURA_GENERICA,
};
// Métodos de Odoo de sólo lectura, para conectores con una herramienta genérica (execute_kw, call_kw) y `method`.
const METODOS_ODOO_LECTURA = new Set([
  'search', 'search_read', 'read', 'search_count', 'fields_get', 'name_search', 'read_group', 'name_get',
  'check_access_rights', 'check_access', 'default_get', 'get_views', 'web_search_read', 'web_read',
]);
const CAMPOS_ID = ['id', 'workflowId', 'workflow_id', 'agentId', 'agent_id', 'dataTableId', 'data_table_id', 'ids', 'workflowIds'];

/** Servidor de una herramienta MCP (mcp__<servidor>__<herramienta>), normalizado; '' si no es MCP. */
export function servidorDe(toolName) {
  if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return '';
  const partes = toolName.split('__');
  return partes.length >= 3 ? normServidor(partes.slice(1, -1).join('__')) : '';
}

/** Entrada de `mcp_prod` del proyecto que cubre esta herramienta, o null. */
export function entradaMcpProd(proyecto, toolName) {
  const srv = servidorDe(toolName);
  if (!srv) return null;
  for (const e of lista(proyecto?.mcp_prod)) {
    if (!esObjeto(e)) continue;
    const s = normServidor(e.servidor);
    // Igual o como sufijo: los conectores de claude.ai y de plugins llevan prefijo (claude_ai_n8n, plugin_x_n8n).
    if (s && (srv === s || srv.endsWith(`_${s}`))) return e;
  }
  return null;
}

/** ¿El proyecto declara algún servidor MCP de PROD? */
export const tieneMcpProd = (proyecto) => lista(proyecto?.mcp_prod).some((e) => esObjeto(e) && normServidor(e.servidor));

function verbos(entrada) {
  const tipo = typeof entrada?.tipo === 'string' ? entrada.tipo.toLowerCase() : 'generico';
  const base = LECTURA_TIPO[tipo] ?? LECTURA_TIPO.generico;
  return { tipo, verbos: [...base, ...lista(entrada?.lectura).filter((x) => typeof x === 'string').map((x) => x.toLowerCase().replace(/_$/, ''))] };
}

/** ¿La herramienta es de sólo lectura según el tipo del servidor y la lista `lectura`? */
export function esLecturaMcp(entrada, toolName, toolInput = {}) {
  const corto = String(toolName).split('__').pop().toLowerCase();
  const { tipo, verbos: vs } = verbos(entrada);
  let nombre = corto;
  for (const pre of [tipo, 'odoo', 'n8n']) if (nombre.startsWith(`${pre}_`)) nombre = nombre.slice(pre.length + 1);
  const input = esObjeto(toolInput) ? toolInput : {};
  // Herramienta genérica de Odoo: decide el método.
  if (tipo === 'odoo' && typeof input.method === 'string') return METODOS_ODOO_LECTURA.has(input.method.trim().toLowerCase());
  return vs.some((v) => nombre === v || nombre.startsWith(`${v}_`));
}

/** Ids que toca la herramienta (para `ids_prod`), como strings. */
function idsDe(input) {
  const out = [];
  for (const k of CAMPOS_ID) {
    const v = input?.[k];
    if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' || typeof x === 'number') out.push(String(x));
  }
  return out;
}

/**
 * ¿Esta llamada escribe en PROD? null si el servidor no está declarado (no aplica);
 * { prod: false } si es lectura o un id fuera de `ids_prod`; { prod: true, destino } si es escritura a PROD.
 */
export function clasificarMcp(proyecto, toolName, toolInput) {
  const e = entradaMcpProd(proyecto, toolName);
  if (!e) return null;
  if (esLecturaMcp(e, toolName, toolInput)) return { prod: false };
  const destino = typeof e.servidor === 'string' ? e.servidor : servidorDe(toolName);
  const idsProd = lista(e.ids_prod).map(String);
  if (idsProd.length > 0) {
    const ids = idsDe(esObjeto(toolInput) ? toolInput : {});
    if (ids.length > 0 && !ids.some((x) => idsProd.includes(x))) return { prod: false };
  }
  return { prod: true, destino };
}
