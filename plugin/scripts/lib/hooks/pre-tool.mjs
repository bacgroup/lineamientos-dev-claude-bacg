// PreToolUse: despacha a las compuertas de edición, Bash y MCP.
//
// El transcript se lee sólo si hace falta: primero se evalúa sin mensajes del usuario (que sólo pueden
// habilitar, nunca bloquear) y, si la compuerta deniega, se vuelve a evaluar con el transcript.
// La criticidad (política de falla) la calcula la entrada plugin/scripts/hooks/pre-tool.mjs.

import path from 'node:path';
import { dirLineamientos, buscarRepo } from '../config.mjs';
import { leerTranscript } from '../transcript.mjs';
import { evaluarEdicion, escrituraProhibida } from '../compuerta-edicion.mjs';
import { evaluarBash } from '../compuerta-bash.mjs';
import { evaluarMcp } from '../compuerta-mcp.mjs';
import { resolverMcp, proyectoRegistrado, proyectosRegistrados, refsProd } from '../contexto.mjs';
import { proyectosLocales } from '../proyectos-locales.mjs';
import { denegar } from '../salida.mjs';

const CAMPO_RUTA = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const RAMAS = ['merge_branch', 'reset_branch'];

// Terminales de MCP (terminal, desktop-commander y afines): corren comandos de shell, así que pasan por la misma
// compuerta que Bash. Sufijo del nombre de la herramienta → campo con el comando.
const TERMINALES = { start_process: 'command', run_in_terminal: 'command', execute_command: 'command', interact_with_process: 'input' };

const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

/** Comando de shell de Bash, PowerShell o una terminal de MCP; '' si es Bash sin comando; null si no es un shell. */
function comandoDeShell(tool, input) {
  if (tool === 'Bash' || tool === 'PowerShell') return typeof input.command === 'string' ? input.command : '';
  if (typeof tool !== 'string') return null;
  const sufijo = Object.keys(TERMINALES).find((s) => tool.endsWith(`__${s}`));
  const comando = sufijo ? input[TERMINALES[sufijo]] : undefined;
  return typeof comando === 'string' ? comando : null; // un campo que no es texto sigue por la compuerta de MCP
}

async function conTranscript(entrada, evaluar) {
  const r = await evaluar({ textosUsuario: [], skills: new Set() });
  if (r?.decision !== 'deny') return r;
  let t;
  try {
    t = await leerTranscript(entrada.transcript_path);
  } catch {
    return r; // el transcript sólo puede habilitar: si no se lee, queda el deny de la primera pasada
  }
  return evaluar(t);
}

export async function handler(entrada, { dirLin = dirLineamientos() } = {}) {
  const tool = entrada?.tool_name;
  const input = esObjeto(entrada?.tool_input) ? entrada.tool_input : {};
  const cwd = typeof entrada?.cwd === 'string' && entrada.cwd ? entrada.cwd : process.cwd();
  let r = null;

  if (CAMPO_RUTA[tool]) {
    const ruta = input[CAMPO_RUTA[tool]];
    if (typeof ruta !== 'string' || ruta === '') return null;
    const abs = path.resolve(cwd, ruta);
    // estado.yml, ACTIVO y el transcript nunca se escriben a mano (el transcript vive fuera de todo repo).
    const prohibida = escrituraProhibida(abs);
    if (prohibida) return denegar(prohibida);
    const repo = buscarRepo(path.dirname(abs));
    if (!repo) return null;
    // Sin proyecto.yml se clasifica con las reglas generales; un proyecto.yml inválido lanza.
    const proyecto = proyectoRegistrado(repo.proyectoId, dirLin, repo.raiz);
    r = await conTranscript(entrada, ({ textosUsuario, skills }) =>
      evaluarEdicion({ raiz: repo.raiz, proyecto, rutaArchivo: abs, ctx: { textosUsuario, skills } }),
    );
  } else if (comandoDeShell(tool, input) !== null) {
    const comando = comandoDeShell(tool, input);
    if (comando === '') return null;
    r = await conTranscript(entrada, ({ textosUsuario }) =>
      evaluarBash({ comando, cwd, ctx: { textosUsuario }, dirLin }),
    );
  } else if (typeof tool === 'string' && tool.startsWith('mcp__')) {
    let { proyecto, raiz, estado, rqs } = resolverMcp({ cwd, toolInput: input, dirLin, toolName: tool });
    // Las herramientas de ramas no dicen a qué proyecto apuntan: sin proyecto resuelto, si algún proyecto
    // registrado tiene refs de PROD se tratan como PROD sin estado (falla cerrada).
    const corto = tool.toLowerCase().split('__').pop();
    if (!proyecto && RAMAS.includes(corto)) {
      const conProd = proyectosRegistrados(dirLin, { locales: proyectosLocales({ cwd, ajustes: false }) }).find((x) => refsProd(x.proyecto).length > 0);
      if (conProd) {
        proyecto = conProd.proyecto;
        raiz = null;
        estado = null;
        rqs = [];
      }
    }
    // El OK de PROD se vuelve a comprobar contra la sesión: si la primera pasada niega, se lee el transcript.
    const estados = (rqs ?? []).map((x) => x.estado);
    r = await conTranscript(entrada, ({ textosUsuario }) =>
      evaluarMcp({ toolName: tool, toolInput: input, proyecto, estado, estados, ctx: { raiz, textosUsuario } }),
    );
  }

  return r?.decision === 'deny' ? denegar(r.motivo ?? 'Compuerta: operación denegada.') : null;
}
