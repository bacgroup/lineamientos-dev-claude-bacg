import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { relativaAlRepo, tipoArchivo, skillsUi } from './rutas.mjs';
import { buscarRepo } from './config.mjs';
import { rqsActivos, cargarEstado, etapaCumplida, saltoValido } from './estado.mjs';
import { cli } from './cli.mjs';
import { skillsDe } from './requisitos.mjs';
import { dentroDeAddon, usaOdoo } from './odoo-skills.mjs';
import { ETAPA } from './etapas.mjs';
import { nombreDe } from './clasificacion.mjs';

const allow = () => ({ decision: 'allow' });
const deny = (motivo) => ({ decision: 'deny', motivo });

function skillCargada(skills, nombre) {
  for (const s of skills) {
    if (typeof s === 'string' && (s === nombre || s.endsWith(`:${nombre}`))) return true;
  }
  return false;
}

// Refuerzo de UI (todo RQ, cualquier clasificación): diseno-frontend siempre; redesign-existing-projects si la
// pantalla ya existe; las de ui.skills / ui.reglas se suman. Y el spec del RQ con su sección de diseño.
export const SKILL_DISENO = 'diseno-frontend';
export const SKILL_REDISENO = 'redesign-existing-projects';
const RE_SECCION_DISENO = /^\s*#{2,3}\s*(?:dise[ñn]o|ui|estados)\b/im;

/**
 * Skills que exige editar este archivo de UI: el refuerzo del plugin más las que declara el proyecto. Con
 * `sinRefuerzo` (el usuario aceptó omitirlo en un cambio menor: saltar ui), sólo las del proyecto.
 */
export function skillsRefuerzoUi(rel, proyecto, existe, sinRefuerzo = false) {
  const propias = sinRefuerzo ? [] : [SKILL_DISENO, ...(existe ? [SKILL_REDISENO] : [])];
  return [...new Set([...propias, ...skillsUi(rel, proyecto)])];
}

function seccionDiseno(raiz, codigo) {
  try {
    return RE_SECCION_DISENO.test(fs.readFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), 'utf8'));
  } catch {
    return false;
  }
}

// Cambio menor (un texto, un ícono, un espaciado puntual, sin componentes ni pantallas nuevas): el agente le pregunta
// al usuario en el chat, con palabras, si omite el refuerzo; un botón no queda como frase del usuario.
const PISTA_MENOR = ' Si el cambio es menor, preguntale al usuario en el chat (texto, no botones) si omite el refuerzo; con su respuesta: $RQ saltar ui "<su frase>" "<motivo>".';

/**
 * Skill oficial de Odoo que exige editar este archivo (M6): odoo-web-guidelines bajo static/ de un addon,
 * odoo-guidelines en el resto del addon; null fuera de un addon o en un proyecto sin Odoo.
 */
export function skillOdooDeRuta(raiz, rel, proyecto) {
  if (!proyecto || !usaOdoo(proyecto, raiz)) return null;
  const enAddon = dentroDeAddon(raiz, rel);
  if (enAddon === null) return null;
  return /^static\//.test(enAddon) ? 'odoo-web-guidelines' : 'odoo-guidelines';
}

/** ¿La clasificación del RQ espera la confirmación del usuario (M2)? Los RQ abiertos antes de 3.3.0 no la tienen. */
export const clasificacionPendiente = (estado) => estado?.clasificacion_pendiente === true;

const RE_ESTADO_O_ACTIVO = /(?:^|\/)docs\/rq\/(?:ACTIVO|[^/]+\/estado\.yml)$/i;

/**
 * Motivo del deny si `abs` es un archivo que nunca se escribe a mano (ni con Edit/Write ni desde Bash), o null:
 * - docs/rq/<código>/estado.yml y docs/rq/ACTIVO: sólo con rq.mjs;
 * - el transcript de la sesión (~/.claude/projects/**.jsonl): es la prueba de lo que escribió el usuario.
 * Lo de docs/rq aplica dentro de un repo con .bacg-lineamientos (`raiz` si ya se conoce; si no, se busca).
 */
export function escrituraProhibida(abs, raiz) {
  const p = String(abs ?? '').replace(/\\/g, '/');
  const enRepo = () => (raiz ? relativaAlRepo(raiz, p) !== null : buscarRepo(path.dirname(path.resolve(String(abs)))) !== null);
  if (RE_ESTADO_O_ACTIVO.test(p) && enRepo()) {
    return `estado.yml y ACTIVO sólo se cambian con rq.mjs (${cli()} <subcomando>).`;
  }
  const rel = relativaAlRepo(path.join(os.homedir(), '.claude', 'projects'), p);
  if (rel && /\.jsonl$/i.test(rel)) {
    return 'El transcript de la sesión (~/.claude/projects/*.jsonl) no se escribe: es la prueba de lo que dijo el usuario.';
  }
  return null;
}

/**
 * Decide si se puede editar un archivo. Con varios RQ activos, alcanza con que uno lo permita.
 * ctx = { skills: Set<string> } (skills cargadas en la sesión; también cuentan las registradas en el RQ).
 */
export function evaluarEdicion({ raiz, proyecto, rutaArchivo, ctx }) {
  const prohibida = escrituraProhibida(rutaArchivo, raiz);
  if (prohibida) return deny(prohibida);
  const rel = relativaAlRepo(raiz, rutaArchivo);
  if (rel === null || rel === undefined) return allow();
  const tipo = tipoArchivo(rel, proyecto);
  if (tipo === 'libre') return allow();

  const codigos = rqsActivos(raiz);
  if (codigos.length === 0) {
    return deny(
      `No hay RQ activo. Clasificá el pedido y abrilo con: ${cli()} abrir <código> --tipo rq|bug --clasificacion <...>`,
    );
  }

  const skillsSesion = ctx?.skills ?? new Set();
  let ultimo = null;
  for (const codigo of [...codigos].reverse()) {
    let estado;
    try {
      estado = cargarEstado(raiz, codigo);
    } catch (e) {
      ultimo = ultimo ?? deny(`${e.message}. Revisá docs/rq/ACTIVO o corré ${cli()} abrir.`);
      continue;
    }
    const ctxEtapa = { raiz };
    if (saltoValido(estado, 'edicion')) return allow();
    if (clasificacionPendiente(estado)) {
      ultimo = ultimo ?? deny(
        `La clasificación del RQ ${codigo} (${nombreDe(estado.clasificacion)}) espera la confirmación del usuario: proponésela con su motivo y lo que implica, y registrá su respuesta con ${cli()} clasificacion confirmar "<su frase>" (o clasificacion cambiar <exploracion|acotado|arquitectonico> "<su frase>").`,
      );
      continue;
    }
    // v4: el diseño (y el plan) aprobado con `aprobar 1` en toda clasificación; la autonomía (por defecto en bounded y
    // spike) cubre desarrollo y DEV, nunca el diseño.
    if (!etapaCumplida(estado, ETAPA.DISENO, ctxEtapa)) {
      ultimo = ultimo ?? deny(
        `Falta el diseño aprobado del RQ ${codigo}: docs/rq/${codigo}/spec.md y la aprobación del usuario con ${cli()} aprobar ${ETAPA.DISENO} "<su frase>" (etapa ${ETAPA.DISENO}, en toda clasificación).`,
      );
      continue;
    }
    const odoo = saltoValido(estado, 'skills') ? null : skillOdooDeRuta(raiz, rel, proyecto);
    if (odoo && !skillCargada(new Set([...skillsSesion, ...skillsDe(estado)]), odoo)) {
      ultimo = ultimo ?? deny(
        `Archivo de un addon de Odoo: cargá antes la skill ${odoo} (Skill "${odoo}"; reglas oficiales de Odoo, sección 2.0.1 de ciclo-rq). Si el usuario decide saltearla: ${cli()} saltar skills "<frase>" "<motivo>".`,
      );
      continue;
    }
    if (tipo === 'ui') {
      const skills = new Set([...skillsSesion, ...skillsDe(estado)]);
      const existe = fs.existsSync(path.resolve(raiz, rel));
      const menor = saltoValido(estado, 'ui');
      const faltan = skillsRefuerzoUi(rel, proyecto, existe, menor).filter((s) => !skillCargada(skills, s));
      if (faltan.length > 0) {
        ultimo = ultimo ?? deny(
          `Cambio de UI${existe ? ' en una pantalla existente' : ''}: cargá antes la skill ${faltan.join(', ')} (refuerzo de UI y canon del proyecto).${menor ? '' : PISTA_MENOR}`,
        );
        continue;
      }
      if (!menor && !seccionDiseno(raiz, codigo)) {
        ultimo = ultimo ?? deny(
          `Cambio de UI: falta la sección de diseño en docs/rq/${codigo}/spec.md (## Diseño: canon que aplica, dirección, auditoría si la pantalla existe, estados, móvil y alineación con los vecinos).${PISTA_MENOR}`,
        );
        continue;
      }
    }
    return allow();
  }
  return ultimo;
}
