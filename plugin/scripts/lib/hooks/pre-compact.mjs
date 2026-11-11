// PLG-CTX (4.2.0): PreCompact. Lo que el hook imprime, Claude Code lo usa como instrucciones para el resumen de la
// compactación (hasta 10.000 caracteres). Le pide conservar lo que el ciclo necesita para seguir sin releer todo: el
// estado de cada RQ abierto, las frases del usuario, los rojos y las rutas de las salidas compactadas. Sólo lee
// archivos locales (sin git ni gh): tiene que ser rápido. Fuera de un repo del plugin no dice nada.

import { buscarRepo, dirLineamientos, cargarProyecto } from '../config.mjs';
import { reposDebajo } from '../arranque.mjs';
import { rqsActivos, cargarEstado, etapaDerivada } from '../estado.mjs';
import { NOMBRE_ETAPA, ETAPA } from '../etapas.mjs';
import { faltaParaEtapa } from '../requisitos.mjs';

const MAX = 9500;
const NOMBRE_CLASIF = { spike: 'Exploración', bounded: 'Acotado', arquitectonico: 'Arquitectónico' };
const lista = (x) => (Array.isArray(x) ? x : []);
const recortar = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}…` : String(s ?? ''));
const verde = (x) => (x?.ok === true ? 'en verde' : x?.ok === false ? 'en rojo' : 'sin correr');

const REGLAS = [
  'Instrucciones del plugin lineamientos-dev-claude-bacg para este resumen:',
  '- Conservá textual: el código, la clasificación y la etapa de cada RQ abierto (abajo), lo que falta para la etapa siguiente y la rama.',
  '- Conservá textual las frases del usuario que aprueban, clasifican, eligen la ejecución, dan autonomía o autorizan un salto, y si ya se registraron con rq.mjs. Una frase sin registrar sigue pendiente: no la des por registrada.',
  '- Conservá los tests y E2E en rojo con archivo, línea y mensaje del error, y los hallazgos de revisión sin resolver.',
  '- Conservá las rutas de los archivos tocados y las de salidas compactadas (~/.claude/bacg-dev/salidas/…) que sigan siendo útiles.',
  '- Podés descartar las salidas de herramientas ya resueltas: tests que pasaron, logs ya revisados, listados y lecturas de código que se pueden repetir.',
];

function repos(cwd, dirLin) {
  const propio = buscarRepo(cwd, { dirLin });
  return propio ? [propio.raiz] : reposDebajo(cwd, 2, dirLin);
}

function lineasRq(raiz, codigo, dirLin) {
  const e = cargarEstado(raiz, codigo);
  const etapa = etapaDerivada(e, raiz);
  const out = [`- ${raiz} · ${codigo} (${e.tipo ?? '?'}, ${NOMBRE_CLASIF[e.clasificacion] ?? e.clasificacion ?? '?'}), etapa ${etapa}: ${NOMBRE_ETAPA[etapa] ?? '?'}. ${recortar(e.tarea, 200)}`];
  const aprob = lista(e.aprobaciones).map((a) => `etapa ${a?.etapa} «${recortar(a?.frase, 120)}»`);
  out.push(`  Aprobaciones registradas: ${aprob.length ? aprob.join('; ') : 'ninguna'}. Tests: ${verde(e.tests)}. E2E: ${verde(e.e2e)}.`);
  const saltos = lista(e.saltos).map((s) => `${s?.compuerta} «${recortar(s?.frase, 80)}»`);
  if (saltos.length) out.push(`  Saltos autorizados: ${saltos.join('; ')}.`);
  if (etapa < ETAPA.CIERRE) {
    try {
      const repo = buscarRepo(raiz, { dirLin });
      const proyecto = repo ? cargarProyecto(repo.proyectoId, dirLin, repo.raiz) : undefined;
      const falta = faltaParaEtapa(e, etapa + 1, raiz, proyecto ?? undefined);
      if (falta.length) out.push(`  Falta para la etapa ${etapa + 1}: ${recortar(falta.join('; '), 600)}.`);
    } catch {
      // proyecto ilegible: sin faltantes
    }
  }
  return out;
}

/** Instrucciones de compactación para la sesión en `cwd` ('' si no hay nada del plugin). */
export function instruccionesCompactacion({ cwd, dirLin = dirLineamientos() }) {
  if (!cwd) return '';
  const raices = repos(cwd, dirLin);
  if (raices.length === 0) return '';
  const rqs = [];
  for (const raiz of raices) {
    for (const codigo of rqsActivos(raiz)) {
      try {
        rqs.push(...lineasRq(raiz, codigo, dirLin));
      } catch {
        rqs.push(`- ${raiz} · ${codigo}: estado ilegible.`);
      }
    }
  }
  const texto = [...REGLAS, '', rqs.length ? 'RQ abiertos:' : 'No hay RQ abiertos en estos repos.', ...rqs].join('\n');
  return texto.length > MAX ? `${texto.slice(0, MAX)}\n[…]` : texto;
}

export async function handler(entrada, opciones = {}) {
  // Sin cwd en la entrada no se adivina: el proceso del hook puede correr en cualquier carpeta.
  if (typeof entrada?.cwd !== 'string' || !entrada.cwd) return '';
  return instruccionesCompactacion({ cwd: entrada.cwd, ...opciones });
}
