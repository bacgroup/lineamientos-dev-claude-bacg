// Compuerta de herramientas MCP: servidores de PROD declarados (`mcp_prod`: n8n, Odoo u otro), Supabase a PROD y Lovable.
//
// - `mcp_prod` (ver mcp-prod.mjs): la lectura pasa; toda otra herramienta del servidor es escritura a PROD y
//   exige un RQ activo con el OK de PROD (etapa 5). Falla cerrada: lo que no se reconoce como lectura, escribe.
// - SQL (`execute_sql`, `apply_migration`) a un ref de `entornos.prod.supabase_refs`: la lectura pura
//   pasa; la escritura exige un RQ activo con el OK de PROD (etapa 5) y que estén hechos los pasos de
//   los que depende en `circuito_prod` (ver circuito.mjs). Los saltos nunca aplican.
// - Otras herramientas de Supabase que tocan PROD (`deploy_edge_function`, `merge_branch`,
//   `reset_branch`, `restore_project`, `pause_project`): RQ activo con el OK de PROD (etapa 5).
//   `merge_branch`/`reset_branch` sólo reciben `branch_id`: con refs de PROD declarados son siempre
//   PROD, sin mirar `project_id` (falla cerrada, pero se puede pasar con el OK).
// - En las herramientas con SQL, todo valor string de la entrada (salvo project_id/name) tiene que ser
//   lectura pura para que pase como lectura (evita campos señuelo).
// - Lovable: `deploy_project` y `respond_to_approval` son siempre PROD; `query_database` a un proyecto
//   registrado es PROD salvo lectura pura; `send_message` pasa siempre (Lovable aplica sus propios controles).
// - Con varios RQ activos, alcanza con que uno cumpla.
//
// Límites conocidos de `esSqlSoloLectura` (chequeo léxico, no un parser):
// - funciones invocadas indirectamente por vistas, triggers o reglas, operadores definidos por el
//   usuario y llamadas con notación de atributo (`(t).f`) no se detectan;
// - la lista blanca de funciones se aplica por nombre: una función propia con el mismo nombre que una
//   de la lista (en otro schema del search_path) pasaría.
// Los `project_id` que no son de PROD (o desconocidos) se permiten. Si `sql:<ref>` no está en
// `circuito_prod`, no hay chequeo de orden.

import { etapaCumplida } from './estado.mjs';
import { ETAPA } from './etapas.mjs';
import { cli } from './cli.mjs';
import { faltaAntes, rutasDelRq, hechoEnRealidad } from './circuito.mjs';
import { clasificarMcp } from './mcp-prod.mjs';

// Postgres trata todo carácter >= U+0080 como parte de un identificador.
const IDENT = /[A-Za-z0-9_$\u0080-￿]/;
const MARCA_IDENT = '\u0001';

const VERBOS_LECTURA = /^[\s(]*(select|with|explain|show|table|values)\b/i;
const PALABRAS_PROHIBIDAS = new RegExp(
  '\\b(' +
    [
      'insert', 'update', 'delete', 'merge', 'alter', 'create', 'drop', 'truncate', 'grant', 'revoke',
      'copy', 'call', 'do', 'vacuum', 'refresh', 'comment', 'security', 'execute', 'perform', 'lock',
      'reindex', 'cluster', 'import', 'into', 'set', 'reset', 'listen', 'notify', 'prepare', 'discard',
      'analyze', 'analyse', 'share', 'nowait', 'begin', 'commit', 'rollback', 'start', 'savepoint',
    ].join('|') +
    ')\\b',
  'i',
);

// Palabras clave que pueden ir seguidas de '(' sin ser una llamada a función.
const CLAVES_ANTES_DE_PAREN = [
  'exists', 'any', 'all', 'some', 'over', 'filter', 'from', 'join', 'using', 'values', 'row', 'array',
  'cast', 'within', 'and', 'or', 'not', 'on', 'when', 'then', 'else', 'case', 'select', 'where',
  'lateral', 'distinct', 'as', 'in', 'by', 'is',
];
const TIPOS = [
  'numeric', 'decimal', 'varchar', 'char', 'character', 'text', 'int', 'integer', 'bigint', 'smallint',
  'float', 'real', 'double', 'precision', 'interval', 'timestamp', 'timestamptz', 'date', 'time',
  'boolean', 'bool', 'uuid', 'json', 'jsonb',
];
const FUNCIONES_LECTURA = [
  'count', 'sum', 'avg', 'min', 'max', 'now', 'current_date', 'current_timestamp', 'coalesce', 'nullif',
  'greatest', 'least', 'lower', 'upper', 'initcap', 'length', 'char_length', 'octet_length', 'trim',
  'btrim', 'ltrim', 'rtrim', 'substr', 'substring', 'position', 'replace', 'split_part', 'concat',
  'concat_ws', 'format', 'left', 'right', 'lpad', 'rpad', 'reverse', 'repeat', 'md5', 'to_char',
  'to_date', 'to_timestamp', 'to_number', 'date_trunc', 'date_part', 'extract', 'age', 'make_date',
  'make_interval', 'justify_interval', 'abs', 'round', 'ceil', 'ceiling', 'floor', 'trunc', 'mod',
  'power', 'sqrt', 'random', 'array_agg', 'string_agg', 'array_length', 'array_position', 'unnest',
  'cardinality', 'bool_and', 'bool_or', 'every', 'row_number', 'rank', 'dense_rank', 'lag', 'lead',
  'first_value', 'last_value', 'ntile', 'percentile_cont', 'percentile_disc', 'jsonb_build_object',
  'jsonb_agg', 'jsonb_object_agg', 'jsonb_array_length', 'jsonb_array_elements',
  'jsonb_array_elements_text', 'jsonb_each', 'jsonb_each_text', 'jsonb_extract_path',
  'jsonb_extract_path_text', 'jsonb_typeof', 'jsonb_pretty', 'jsonb_strip_nulls', 'to_jsonb',
  'json_build_object', 'json_agg', 'to_json', 'row_to_json', 'generate_series', 'pg_get_functiondef',
  'pg_get_function_arguments', 'pg_get_function_result', 'pg_get_viewdef', 'pg_get_constraintdef',
  'pg_get_indexdef', 'pg_get_triggerdef', 'pg_get_userbyid', 'pg_typeof', 'pg_size_pretty',
  'pg_total_relation_size', 'pg_relation_size', 'pg_table_size', 'pg_indexes_size', 'pg_database_size',
  'has_table_privilege', 'has_schema_privilege', 'has_function_privilege', 'obj_description',
  'col_description', 'format_type', 'current_setting', 'current_user', 'session_user', 'version',
];
const PERMITIDOS_ANTES_DE_PAREN = new Set([...CLAVES_ANTES_DE_PAREN, ...TIPOS, ...FUNCIONES_LECTURA]);

const esIdent = (c) => c !== undefined && IDENT.test(c);

/**
 * Lexer fiel a Postgres en lo que importa para separar código de literales: comentarios `--` y
 * `/* *\/` anidados, strings '...' (con '' y, si llevan prefijo E, escapes con \), dollar quotes
 * ($$ y $tag$, sólo si el '$' no sigue a un carácter de identificador) e identificadores "...".
 * Los strings se reemplazan por ` _ ` y los identificadores entre comillas por una marca.
 * Devuelve null (falla cerrada) ante algo sin cerrar o un literal U&.
 */
function limpiarSql(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const sig = sql[i + 1];
    if (ch === '-' && sig === '-') {
      const fin = sql.indexOf('\n', i + 2);
      i = fin === -1 ? n : fin + 1;
      out += ' ';
    } else if (ch === '/' && sig === '*') {
      let prof = 1;
      let j = i + 2;
      while (prof > 0) {
        if (j >= n) return null;
        if (sql[j] === '/' && sql[j + 1] === '*') {
          prof++;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          prof--;
          j += 2;
        } else j++;
      }
      i = j;
      out += ' ';
    } else if (ch === "'" || ch === '"') {
      // U&'...' / U&"...": escapes Unicode; no los interpretamos.
      if (sql[i - 1] === '&' && /[uU]/.test(sql[i - 2] ?? '')) return null;
      if (ch === '"') {
        let j = i + 1;
        for (;;) {
          if (j >= n) return null;
          if (sql[j] === '"') {
            if (sql[j + 1] === '"') j += 2;
            else break;
          } else j++;
        }
        i = j + 1;
        out += ` ${MARCA_IDENT} `;
        continue;
      }
      const escape = /[eE]/.test(sql[i - 1] ?? '') && !esIdent(sql[i - 2]);
      let j = i + 1;
      for (;;) {
        if (j >= n) return null;
        if (escape && sql[j] === '\\') j += 2;
        else if (sql[j] === "'") {
          if (sql[j + 1] === "'") j += 2;
          else break;
        } else j++;
      }
      i = j + 1;
      out += ' _ ';
    } else if (ch === '$' && !esIdent(sql[i - 1])) {
      const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i));
      if (!m) {
        out += ch;
        i++;
        continue;
      }
      const tag = m[0];
      const fin = sql.indexOf(tag, i + tag.length);
      if (fin === -1) return null;
      i = fin + tag.length;
      out += ' _ ';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** true si todo identificador seguido de '(' es una palabra clave, un tipo o una función de lectura. */
function llamadasPermitidas(limpio) {
  if (new RegExp(`${MARCA_IDENT}\\s*\\(`).test(limpio)) return false;
  const re = /(?<![A-Za-z0-9_$\u0080-￿])([A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*)\s*\(/g;
  let m;
  while ((m = re.exec(limpio)) !== null) {
    // Llamada calificada (schema.funcion o "schema".funcion): siempre fuera.
    if (/\.\s*$/.test(limpio.slice(0, m.index))) return false;
    if (!PERMITIDOS_ANTES_DE_PAREN.has(m[1].toLowerCase())) return false;
  }
  return true;
}

export function esSqlSoloLectura(sql) {
  try {
    if (typeof sql !== 'string' || sql.trim() === '') return false;
    const limpio = limpiarSql(sql);
    if (limpio === null) return false;
    const sentencias = limpio.split(';').filter((s) => s.trim() !== '');
    if (sentencias.length === 0) return false;
    if (!sentencias.every((s) => VERBOS_LECTURA.test(s))) return false;
    if (PALABRAS_PROHIBIDAS.test(limpio)) return false;
    return llamadasPermitidas(limpio);
  } catch {
    return false;
  }
}

/**
 * Lectura pura para una herramienta que lleva SQL: todo valor string de la entrada (salvo project_id
 * y name) tiene que ser SQL de sólo lectura, y tiene que haber al menos uno. Así un campo señuelo
 * (`query` inocente + `sql` de escritura) no pasa. Un valor no escalar (objeto, array) cuenta como
 * escritura (falla cerrada).
 */
export function entradaSoloLectura(input) {
  let hay = false;
  for (const [k, v] of Object.entries(input)) {
    if (k === 'project_id' || k === 'name') continue;
    if (typeof v === 'string') {
      if (!esSqlSoloLectura(v)) return false;
      hay = true;
    } else if (v !== null && typeof v === 'object') return false;
  }
  return hay;
}

const allow = (critica = false) => ({ decision: 'allow', critica });
const deny = (motivo, critica) => ({ decision: 'deny', motivo, critica });
const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const lista = (x) => (Array.isArray(x) ? x : []);
const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : null);

function refsProd(proyecto) {
  return lista(proyecto?.entornos?.prod?.supabase_refs).map(norm).filter(Boolean);
}

function proyectosLovable(proyecto) {
  const p = proyecto?.lovable?.proyectos;
  return esObjeto(p) ? Object.values(p).map(norm).filter(Boolean) : [];
}


const sufijo = (nombre, s) => nombre.toLowerCase().endsWith(`__${s}`);
const SQL_SUPABASE = ['apply_migration', 'execute_sql'];
const PROD_SUPABASE = ['deploy_edge_function', 'restore_project', 'pause_project'];
const RAMAS_SUPABASE = ['merge_branch', 'reset_branch'];

/** Algún RQ activo con el OK de PROD (etapa 5). Devuelve el deny o null. */
function exigirProd(estados, c, sinRq, sinOk) {
  if (estados.length === 0) return deny(sinRq, true);
  if (!estados.some((e) => etapaCumplida(e, ETAPA.PROD, c))) return deny(sinOk, true);
  return null;
}

/**
 * Decide si una herramienta MCP puede correr.
 * estado = estado del RQ activo más reciente (o null); estados = todos los RQ activos (si falta, [estado]).
 * ctx = { raiz, textosUsuario, real? } (textosUsuario: para el OK de PROD, que se comprueba contra la sesión).
 * Devuelve { decision, motivo?, critica }.
 */
export function evaluarMcp({ toolName, toolInput, proyecto, estado, estados, ctx } = {}) {
  const nombre = typeof toolName === 'string' ? toolName : '';
  const corto = nombre.split('__').pop().toLowerCase();
  const input = esObjeto(toolInput) ? toolInput : {};
  const est = esObjeto(estado) ? estado : null;
  const ests = Array.isArray(estados) ? estados.filter(esObjeto) : est ? [est] : [];
  const c = esObjeto(ctx) ? ctx : {};
  const refs = refsProd(proyecto);
  const id = norm(input.project_id);

  // --- Servidores MCP de PROD declarados (n8n, Odoo, otros) ---
  const mcp = clasificarMcp(proyecto, nombre, input);
  if (mcp) {
    if (!mcp.prod) return allow();
    return (
      exigirProd(
        ests,
        c,
        `${corto} en ${mcp.destino} (PROD) sin RQ activo.`,
        `${corto} en ${mcp.destino} es escritura a PROD: falta el OK del usuario para PROD (etapa ${ETAPA.PROD}).`,
      ) ?? allow(true)
    );
  }

  // --- Supabase: SQL ---
  if (SQL_SUPABASE.some((s) => sufijo(nombre, s))) {
    if (refs.length === 0) return allow();
    if (!id) return deny(`Herramienta ${corto} sin project_id: no se puede verificar si el destino es PROD.`, true);
    if (!refs.includes(id)) return allow();
    if (sufijo(nombre, 'execute_sql') && entradaSoloLectura(input)) return allow();
    const r = exigirProd(
      ests,
      c,
      `SQL de escritura a PROD (${id}) sin RQ activo.`,
      `SQL de escritura a PROD (${id}): falta el OK del usuario para PROD (etapa ${ETAPA.PROD}).`,
    );
    if (r) return r;
    const paso = `sql:${id}`;
    let primero = null;
    for (const e of ests.filter((x) => etapaCumplida(x, ETAPA.PROD, c))) {
      if (lista(e.circuito).some((p) => p?.no_aplica === true && norm(p?.paso) === paso)) {
        primero = primero ?? deny(`${paso} figura como no aplica en este RQ: si hace falta correr SQL, corré ${cli()} paso reabrir ${paso}.`, true);
        continue;
      }
      const rutas = c.raiz ? rutasDelRq(c.raiz, e) : null;
      // Correr SQL contradice un paso marcado como no aplica: acá esos pasos no cuentan como hechos.
      const sinMarcas = { ...e, circuito: lista(e.circuito).filter((p) => p?.no_aplica !== true) };
      const falta = faltaAntes({ proyecto, estado: sinMarcas, paso, raiz: c.raiz ?? null, rutas, real: c.real ?? hechoEnRealidad });
      if (falta === undefined) return allow(true);
      primero = primero ?? deny(`Circuito de PROD: falta el paso ${falta} antes de ${paso}.`, true);
    }
    return primero;
  }

  // --- Supabase: otras herramientas que tocan PROD ---
  const esProdSupa = PROD_SUPABASE.some((s) => sufijo(nombre, s));
  const esRama = RAMAS_SUPABASE.some((s) => sufijo(nombre, s));
  if (esProdSupa || esRama) {
    if (refs.length === 0) return allow();
    // Las herramientas de ramas sólo reciben branch_id: con refs de PROD declarados son siempre PROD,
    // sin mirar project_id (no hay forma de saber de qué proyecto es la rama).
    if (!esRama) {
      if (!id) return deny(`Herramienta ${corto} sin project_id: no se puede verificar si el destino es PROD.`, true);
      if (!refs.includes(id)) return allow();
    }
    const destino = esRama ? 'rama' : id;
    return (
      exigirProd(
        ests,
        c,
        `${corto} a PROD (${destino}) sin RQ activo.`,
        `${corto} a PROD (${destino}): falta el OK del usuario para PROD (etapa ${ETAPA.PROD}).`,
      ) ?? allow(true)
    );
  }

  // --- Lovable ---
  if (sufijo(nombre, 'deploy_project')) {
    return (
      exigirProd(
        ests,
        c,
        'Deploy de Lovable sin RQ activo.',
        `Deploy de Lovable es PROD: falta el OK del usuario para PROD (etapa ${ETAPA.PROD}).`,
      ) ?? allow(true)
    );
  }

  if (sufijo(nombre, 'respond_to_approval')) {
    return (
      exigirProd(
        ests,
        c,
        'Aprobar una acción del agente de Lovable sin RQ activo.',
        `Aprobar una acción del agente de Lovable es PROD: falta el OK del usuario para PROD (etapa ${ETAPA.PROD}).`,
      ) ?? allow(true)
    );
  }

  const esLovableRegistrado = id !== null && proyectosLovable(proyecto).includes(id);

  if (sufijo(nombre, 'query_database')) {
    if (!esLovableRegistrado) return allow();
    if (entradaSoloLectura(input)) return allow();
    return (
      exigirProd(
        ests,
        c,
        `SQL de escritura a Lovable (${id}) sin RQ activo.`,
        `SQL de escritura a Lovable (${id}) es PROD: falta el OK del usuario para PROD (etapa ${ETAPA.PROD}).`,
      ) ?? allow(true)
    );
  }

  return allow();
}
