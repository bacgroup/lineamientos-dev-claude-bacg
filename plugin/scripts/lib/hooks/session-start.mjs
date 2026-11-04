// SessionStart: resúmenes de lineamientos, encuadre de los RQ activos (cabecera de spec.md), aviso si la cuenta
// activa de gh no es la del proyecto, plugins requeridos que faltan y aviso de versión del plugin. Fuera de un
// repo registrado, si hay repos registrados debajo de cwd (hasta dos niveles), da sólo la ruta del CLI y esos
// repos; si no, nada.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirLineamientos, buscarRepo, carpetaProyecto } from '../config.mjs';
import { cargarRqsDe, proyectoRegistrado } from '../contexto.mjs';
import { contexto } from '../salida.mjs';
import { rutaCli } from '../cli.mjs';
import { avisoAuditoria } from '../auditoria.mjs';
import { etapaDerivada, cerradosConPendientes } from '../estado.mjs';
import { lineaStack } from '../stack.mjs';

export { rutaCli };

const MAX_RESUMENES = 6000;
const MAX_ENCUADRES = 4000;
const LINEAS_ENCUADRE = 30;

/** Cuenta con la que se pushea: cuenta_gh (si el dueño del repo es otra cuenta) o cuenta_github. */
const cuentaEsperada = (proyecto) =>
  [proyecto?.cuenta_gh, proyecto?.cuenta_github].find((c) => typeof c === 'string' && c.trim() !== '') ?? null;

/** Aviso si la cuenta activa de gh no es la del proyecto. Sin gh, sin cuenta declarada o con BACG_DEV_SIN_GH, nada. */
export function avisoCuentaGh(proyecto, env = process.env) {
  if (env.BACG_DEV_SIN_GH === '1') return null;
  const esperada = cuentaEsperada(proyecto);
  if (!esperada) return null;
  const r = spawnSync('gh', ['config', 'get', '-h', 'github.com', 'user'], { encoding: 'utf8', env, timeout: 5000 });
  const activa = r.status === 0 ? r.stdout.trim() : '';
  if (!activa || activa.toLowerCase() === esperada.toLowerCase()) return null;
  return `Aviso: la cuenta activa de gh es ${activa} y este proyecto usa ${esperada}. Antes de push, PR o merge: gh auth switch -u ${esperada}.`;
}

/** Primeras líneas de docs/rq/<código>/spec.md (el encuadre). */
function encuadre(raiz, codigo, max) {
  const spec = leer(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'));
  if (!spec) return `El RQ ${codigo} todavía no tiene encuadre (docs/rq/${codigo}/spec.md).`;
  return `## Encuadre de ${codigo}\n\n${recortar(spec.trim().split(/\r?\n/).slice(0, LINEAS_ENCUADRE).join('\n'), max)}`;
}

// using-superpowers pide invocar cualquier skill con un 1 % de chance de aplicar; en un repo con el ciclo, las de
// proceso las fija ciclo-rq por etapa y el resto es opcional (cada skill cargada son miles de tokens por turno).
export const REGLA_SKILLS =
  'Skills en este repo: las de proceso las fija la skill ciclo-rq por tipo y etapa; no apliques la regla de using-superpowers de invocar toda skill con un 1 % de chance. Invocá las de la tabla de ciclo-rq, las que pida el usuario y las de UI que exija la compuerta.';

const recortar = (texto, max) => (texto.length > max ? `${texto.slice(0, max)}\n[…recortado]` : texto);

export const PLUGINS_REQUERIDOS = [
  'superpowers@superpowers-marketplace',
  'frontend-design@claude-plugins-official',
  'security-guidance@claude-plugins-official',
  'claude-security@claude-plugins-official',
  'pr-review-toolkit@claude-plugins-official',
  'feature-dev@claude-plugins-official',
  'typescript-lsp@claude-plugins-official',
  'claude-md-management@claude-plugins-official',
];

/** Carpetas con .bacg-lineamientos debajo de dir (hasta dos niveles), sin entrar a node_modules ni a carpetas ocultas. */
export function reposDebajo(dir, niveles = 2) {
  const out = [];
  const visitar = (d, n) => {
    let entradas;
    try {
      entradas = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const sub = path.join(d, e.name);
      if (fs.existsSync(path.join(sub, '.bacg-lineamientos'))) out.push(sub);
      else if (n > 1) visitar(sub, n - 1);
    }
  };
  visitar(dir, niveles);
  return out;
}

function leer(ruta) {
  try {
    return fs.readFileSync(ruta, 'utf8');
  } catch {
    return null;
  }
}

// general/resumen.md: el de la copia de lineamientos si existe (una organización puede pisarlo); si no, el que trae
// el plugin. El del proyecto sale de su carpeta (.bacg-dev/ del repo o proyectos/<id>).
function resumenes(dirLin, proyectoId, raiz, pluginRoot) {
  const general =
    leer(path.join(dirLin, 'general', 'resumen.md')) ??
    (pluginRoot ? leer(path.join(pluginRoot, 'general', 'resumen.md')) : null);
  const partes = [
    general,
    leer(path.join(carpetaProyecto(proyectoId, dirLin, raiz), 'resumen.md')),
  ].filter((t) => t !== null && t.trim() !== '');
  if (partes.length === 0) return null;
  const texto = partes.map((t) => t.trim()).join('\n\n');
  return recortar(texto, MAX_RESUMENES);
}

function pluginsFaltantes(home) {
  const archivo = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  let instalados = new Set();
  const texto = leer(archivo);
  if (texto !== null) {
    try {
      const datos = JSON.parse(texto);
      instalados = new Set(Object.keys(datos?.plugins ?? {}));
    } catch {
      return `No pude leer ${archivo}: verificá a mano los plugins requeridos (${PLUGINS_REQUERIDOS.join(', ')}).`;
    }
  }
  const faltan = PLUGINS_REQUERIDOS.filter((p) => !instalados.has(p));
  if (faltan.length === 0) return null;
  const lineas = faltan.map((p) => `/plugin install ${p}`);
  if (faltan.includes('superpowers@superpowers-marketplace')) {
    lineas.push('(si falta el marketplace de superpowers: /plugin marketplace add obra/superpowers-marketplace)');
  }
  return `Faltan plugins requeridos. Pedile al usuario que corra:\n${lineas.join('\n')}`;
}

function version(archivo) {
  const t = leer(archivo);
  if (t === null) return null;
  try {
    const v = JSON.parse(t)?.version;
    const m = typeof v === 'string' ? v.match(/^(\d+)\.(\d+)\.(\d+)/) : null;
    return m ? { texto: v, partes: m.slice(1, 4).map(Number) } : null;
  } catch {
    return null;
  }
}

function avisoVersion(dirLin, pluginRoot) {
  if (!pluginRoot) return null;
  const trabajo = version(path.join(dirLin, 'plugin', '.claude-plugin', 'plugin.json'));
  const instalada = version(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
  if (!trabajo || !instalada) return null;
  for (let i = 0; i < 3; i++) {
    if (trabajo.partes[i] > instalada.partes[i]) {
      return `La copia de trabajo de bacg-dev (${trabajo.texto}) es más nueva que la instalada (${instalada.texto}): actualizá el plugin (/plugin marketplace update lineamientos-bacg y reinstalá bacg-dev).`;
    }
    if (trabajo.partes[i] < instalada.partes[i]) return null;
  }
  return null;
}

export async function handler(
  entrada,
  { dirLin = dirLineamientos(), home = os.homedir(), pluginRoot = process.env.CLAUDE_PLUGIN_ROOT, env = process.env } = {},
) {
  const cwd = typeof entrada?.cwd === 'string' && entrada.cwd ? entrada.cwd : process.cwd();
  const repo = buscarRepo(cwd);
  if (!repo) {
    const debajo = reposDebajo(cwd);
    if (debajo.length === 0) return null;
    const lineas = [
      '# Lineamientos (bacg-dev): repos registrados debajo de esta carpeta',
      debajo.map((d) => `- ${path.relative(cwd, d)}`).join('\n'),
      `CLI del RQ: node "${rutaCli(pluginRoot)}" (corrélo desde la raíz del repo; es el $RQ de la skill ciclo-rq).`,
    ];
    return contexto('SessionStart', lineas.join('\n\n'));
  }

  const partes = [`# Lineamientos (bacg-dev): proyecto ${repo.proyectoId}`];
  if (!fs.existsSync(path.join(carpetaProyecto(repo.proyectoId, dirLin, repo.raiz), 'proyecto.yml'))) {
    partes.push(`Aviso: el proyecto ${repo.proyectoId} no tiene .bacg-dev/proyecto.yml en el repo ni está registrado en ${path.join(dirLin, 'proyectos')}.`);
  }
  partes.push(`CLI del RQ: node "${rutaCli(pluginRoot)}" (usá esta ruta exacta donde la skill ciclo-rq o una compuerta dicen $RQ).`);
  partes.push(REGLA_SKILLS);
  const r = resumenes(dirLin, repo.proyectoId, repo.raiz, pluginRoot);
  if (r) partes.push(r);

  const rqs = cargarRqsDe(repo.raiz);
  if (rqs.length === 0) partes.push('RQ activo: ninguno.');
  const porRq = Math.floor(MAX_ENCUADRES / Math.max(1, rqs.length));
  for (const rq of rqs) {
    if (!rq.estado) {
      partes.push(`RQ activo: ${rq.codigo}, pero su estado.yml falta o no se puede leer.`);
      continue;
    }
    partes.push(`RQ activo: ${rq.codigo} (${rq.estado.tipo ?? '?'}), etapa ${etapaDerivada(rq.estado, repo.raiz)}. Detalle: rq.mjs estado / entregar.`);
    partes.push(encuadre(repo.raiz, rq.codigo, porRq));
  }
  const cerrados = cerradosConPendientes(repo.raiz);
  if (cerrados.length) {
    partes.push(`RQ cerrados con pasos pendientes: ${cerrados.map((c) => `${c.codigo} (${c.pendientes.join(', ')})`).join('; ')}. Al hacerlos: $RQ paso … --rq <código>.`);
  }

  let proyecto = null;
  try {
    proyecto = proyectoRegistrado(repo.proyectoId, dirLin, repo.raiz);
  } catch {
    // proyecto.yml inválido: lo reportan las compuertas
  }
  const stack = lineaStack(proyecto);
  if (stack) partes.push(stack);
  const cuenta = avisoCuentaGh(proyecto, env);
  if (cuenta) partes.push(cuenta);
  try {
    const auditoria = avisoAuditoria(repo.raiz, proyecto);
    if (auditoria) partes.push(auditoria);
  } catch {
    // sin git o historial ilegible: sin aviso
  }

  const faltan = pluginsFaltantes(home);
  if (faltan) partes.push(faltan);
  const aviso = avisoVersion(dirLin, pluginRoot);
  if (aviso) partes.push(aviso);

  return contexto('SessionStart', partes.join('\n\n'));
}
