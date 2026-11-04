// Entrada del hook PreToolUse. Sin imports estáticos a propósito: lee stdin, calcula la criticidad con el
// texto solo y recién después carga el handler. Si algo falla (incluida la carga de módulos), aplica la
// política de falla: deny si la operación es crítica (PROD), aviso si no.

const RE_PUSH = /\bgit\b[\s\S]*\bpush\b/;
const RE_MERGE = /\bgh\b[\s\S]*\bmerge\b/;
const MCP_CRITICAS = [
  'apply_migration', 'execute_sql', 'deploy_project', 'deploy_edge_function', 'merge_branch', 'reset_branch',
  'restore_project', 'pause_project', 'query_database', 'respond_to_approval',
];
const RE_MCP = new RegExp(MCP_CRITICAS.join('|'));

// Sin comillas ni barras invertidas y en minúsculas: "g"it push, g''it push y Git push cuentan.
const limpiar = (t) => String(t ?? '').replace(/['"\\]/g, '').toLowerCase();
const publica = (t) => {
  const n = limpiar(t);
  return RE_PUSH.test(n) || RE_MERGE.test(n);
};

async function criticidad(texto) {
  let entrada = null;
  try {
    entrada = JSON.parse(texto);
  } catch {
    // no es JSON: se decide sobre el texto crudo
  }
  if (entrada === null || typeof entrada !== 'object') return publica(texto) || RE_MCP.test(limpiar(texto));
  const tool = typeof entrada.tool_name === 'string' ? entrada.tool_name.toLowerCase() : '';
  if (tool === 'bash' || tool === 'powershell') {
    const comando = entrada.tool_input?.command;
    if (publica(comando)) return true;
    try {
      const { operacionesGit } = await import('../lib/compuerta-bash.mjs');
      const cwd = typeof entrada.cwd === 'string' && entrada.cwd ? entrada.cwd : process.cwd();
      return operacionesGit(String(comando ?? ''), cwd).some((o) => o.op === 'push' || o.op === 'merge-pr');
    } catch {
      return true;
    }
  }
  if (tool.startsWith('mcp__')) return MCP_CRITICAS.some((s) => tool.endsWith(s));
  return false;
}

const resumir = (e) => String(e?.message ?? e).replace(/\s+/g, ' ').trim().slice(0, 300);

let texto = '';
try {
  process.stdin.setEncoding('utf8');
  for await (const trozo of process.stdin) texto += trozo;
} catch {
  // stdin ilegible: se sigue con lo leído
}

// Atajo: un comando de shell que no nombra git, gh, el CLI del RQ ni los archivos protegidos (sin comillas ni
// barras, como en criticidad) no tiene nada que evaluar; se deja pasar sin cargar las compuertas.
const RE_RELEVANTE = /git|\bgh\b|push|merge|rq\.mjs|\$\{?rq\b|activo|estado\.yml|\.jsonl|\bnode\b/i;
const RE_ESCAPES = /\$'|\\[xuU0-7]/;
const relevante = (c) => RE_RELEVANTE.test(limpiar(c)) || RE_ESCAPES.test(String(c ?? ''));
try {
  const e = JSON.parse(texto);
  const t = typeof e?.tool_name === 'string' ? e.tool_name.toLowerCase() : '';
  if ((t === 'bash' || t === 'powershell') && !relevante(e.tool_input?.command)) process.exit(0);
} catch {
  // no es JSON: sigue la política de falla
}

let critica = true;
try {
  critica = await criticidad(texto);
} catch {
  critica = true;
}

try {
  const modulo = process.env.COMO_TRABAJO_FALLAR_IMPORT === '1' ? '../lib/hooks/no-existe.mjs' : '../lib/hooks/pre-tool.mjs';
  const [{ handler }, { responder }] = await Promise.all([import(modulo), import('../lib/salida.mjs')]);
  await responder(handler, texto, critica);
} catch (e) {
  const salida = critica
    ? {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Compuerta de PROD no pudo evaluarse (${resumir(e)}). Se bloquea por seguridad.`,
        },
      }
    : { systemMessage: `Aviso: compuerta no evaluada (${resumir(e)})` };
  process.stdout.write(JSON.stringify(salida));
}
