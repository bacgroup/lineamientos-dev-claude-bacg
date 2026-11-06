// Skills de proceso que exige cada tipo al llegar a una etapa (2 desarrollo, 3 verificación, 5 PROD) y la
// revisión de seguridad de las rutas sensibles. Se controlan al pasar de etapa (etapa, revision, commit y la
// publicación a PROD), no al editar. `saltar skills` cubre las skills; `saltar seguridad`, la de seguridad.
//
// Además, cada proyecto puede exigir skills propias (PLG-SKILLS) en proyecto.yml:
//   version_ciclo: 4
//   skills_requeridas:
//     - { etapa: 2, skill: "anthropic-skills:bacg-n8n-guidelines", rutas: ["**/n8n/**", "**/*.workflow.json"] }
//     - { etapa: 2, skill: "anthropic-skills:bacg-diagnostico-bugs", tipo: bug }
// `etapa` 2, 3 o 5; `tipo` rq | bug (sin la clave, los dos); `rutas` (opcional): sólo si el RQ toca alguna.
// Un proyecto.yml sin `version_ciclo: 4` está en la numeración 3.x (3, 4 o 6) y se convierte al leerlo.

import fs from 'node:fs';
import path from 'node:path';
import { saltoValido } from './estado.mjs';
import { globARegExp, tipoArchivo } from './rutas.mjs';
import { buscarRepo, dirLineamientos } from './config.mjs';
import { proyectoRegistrado } from './contexto.mjs';
import { rutasDelRq } from './circuito.mjs';
import { exigenciasOdoo, usaOdoo } from './odoo-skills.mjs';
import { ETAPA, etapaProyectoAV4 } from './etapas.mjs';
import { esPropioDeLaCli } from './arbol.mjs';

const lista = (x) => (Array.isArray(x) ? x : []);

/** Nombre de una entrada de estado.skills: las viejas son strings; las nuevas, { skill, etapa, sesion, fecha }. */
export const nombreSkill = (s) => (typeof s === 'string' ? s : typeof s?.skill === 'string' ? s.skill : '').trim();
const corta = (s) => s.split(':').pop().toLowerCase();

export const skillsDe = (estado) => lista(estado?.skills).map(nombreSkill).filter(Boolean);

/** ¿La skill figura en el RQ? Compara sin el prefijo del plugin (superpowers:x = x). */
export const tieneSkill = (estado, nombre) => skillsDe(estado).some((s) => corta(s) === corta(nombre));

const esBug = (estado) => estado?.tipo === 'bug' || estado?.tipo === 'fix';

// Encabezado o campo "Causa" / "Causa raíz" en spec.md.
const RE_CAUSA = /^\s*(?:#{1,6}\s*|[-*]\s+)?\**causa\b/im;

function causaEnSpec(raiz, codigo) {
  try {
    return RE_CAUSA.test(fs.readFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), 'utf8'));
  } catch {
    return false;
  }
}

// `## Tareas` en spec.md con al menos un ítem de lista (viñeta o numerado).
const RE_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

export function tareasEnSpec(raiz, codigo) {
  try {
    const lineas = fs.readFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), 'utf8').split(/\r?\n/);
    const i = lineas.findIndex((l) => /^\s*#{1,6}\s*tareas\b/i.test(l));
    if (i === -1) return false;
    for (const l of lineas.slice(i + 1)) {
      if (/^\s*#{1,6}\s/.test(l)) return false;
      if (RE_ITEM.test(l)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** ¿Existe docs/rq/<código>/plan.md? */
function planEnDisco(raiz, codigo) {
  try {
    return fs.statSync(path.join(raiz, 'docs', 'rq', codigo, 'plan.md')).isFile();
  } catch {
    return false;
  }
}

export const MSG_EXPLORACION_FUERA = (codigo) =>
  `Exploración: el código de la sonda va a docs/rq/${codigo}/sonda/; construirlo es un RQ nuevo.`;

/** Exploración (spike): la primera ruta relativa a la raíz que queda fuera de docs/rq/<código>/, o null. */
export function fueraDeSonda(estado, rels) {
  if (estado?.clasificacion !== 'spike') return null;
  const pref = `docs/rq/${estado.codigo}/`;
  return lista(rels).find((r) => r === null || (!esPropioDeLaCli(r) && !String(r).replace(/\\/g, '/').startsWith(pref))) ?? null;
}

/** proyecto.yml del repo de `raiz`, o null (sin repo registrado o ilegible). */
function proyectoDeRaiz(raiz) {
  if (!raiz) return null;
  try {
    const repo = buscarRepo(raiz);
    return repo ? proyectoRegistrado(repo.proyectoId, dirLineamientos(), repo.raiz) : null;
  } catch {
    return null;
  }
}

// Verificación local (M1 del handoff ciclo-rq/UI): un RQ o BUG que toca UI no cumple la verificación (etapa 3) sólo con el E2E
// aislado; hace falta recorrerlo en el entorno local (o la preview de DEV) con un usuario del rol real.
const RE_TOCA_UI = /^\s*(?:#{1,6}\s*|[-*]\s+)?\**toca\b[^\n]*?\bui\s*\[\s*x\s*\]/im;

/** ¿El RQ toca UI? Lo marca el encuadre (`Toca: UI [x]` en spec.md) o lo dice su diff (algún archivo de UI). */
export function tocaUi(estado, raiz, proyecto, rutasRq) {
  try {
    if (raiz && RE_TOCA_UI.test(fs.readFileSync(path.join(raiz, 'docs', 'rq', estado.codigo, 'spec.md'), 'utf8'))) return true;
  } catch {
    // sin spec.md: decide el diff
  }
  return lista(rutasRq).some((r) => tipoArchivo(r, proyecto) === 'ui');
}

/** ¿Está registrada la verificación local (o la salteó el usuario)? */
export const verificacionLocalOk = (estado) =>
  typeof estado?.verificacion_local?.fecha === 'string' || saltoValido(estado, 'verificacion-local');

export const FALTA_VERIFICACION_LOCAL = 'la verificación local con el rol real ($RQ verificar --local "<qué se recorrió>" <capturas>)';

/** Skills que exige el proyecto (`skills_requeridas`) para este RQ: [{ etapa, skill }]. */
export function exigenciasDelProyecto(estado, proyecto, rutasRq) {
  const bug = esBug(estado);
  const out = [];
  for (const x of lista(proyecto?.skills_requeridas)) {
    if (!x || typeof x.skill !== 'string') continue;
    const etapa = etapaProyectoAV4(proyecto, x.etapa);
    if (![ETAPA.DESARROLLO, ETAPA.VERIFICACION, ETAPA.PROD].includes(etapa)) continue;
    if (x.tipo === 'bug' && !bug) continue;
    if (x.tipo === 'rq' && bug) continue;
    const globs = lista(x.rutas).filter((g) => typeof g === 'string');
    if (globs.length) {
      const res = globs.map(globARegExp);
      // Sin poder saber qué toca el RQ (rutas null), se exige: falla cerrada.
      if (rutasRq && !rutasRq.some((r) => res.some((re) => re.test(r)))) continue;
    }
    out.push({ etapa, skill: x.skill.trim() });
  }
  return out;
}

/** Exigencias por etapa según el tipo: [{ etapa, skill?, causa?, tareas?, plan?, revision? }]. */
export function exigencias(estado) {
  const bug = esBug(estado);
  const l = [];
  const { DESARROLLO, VERIFICACION, PROD } = ETAPA;
  l.push({ etapa: DESARROLLO, skill: 'superpowers:brainstorming' });
  if (bug) l.push({ etapa: DESARROLLO, skill: 'superpowers:systematic-debugging' }, { etapa: DESARROLLO, causa: true });
  if (estado?.clasificacion === 'bounded') l.push({ etapa: DESARROLLO, tareas: true });
  else if (estado?.clasificacion === 'arquitectonico') l.push({ etapa: DESARROLLO, skill: 'superpowers:writing-plans' }, { etapa: DESARROLLO, plan: true });
  l.push({ etapa: VERIFICACION, skill: 'superpowers:test-driven-development' });
  if (!bug) l.push({ etapa: PROD, skill: 'superpowers:verification-before-completion' });
  l.push({ etapa: PROD, revision: true });
  return l;
}

/** Lo que falta para llegar a `etapa` (incluye lo de las anteriores), como textos cortos. */
export function faltaParaEtapa(estado, etapa, raiz, proyecto = undefined) {
  const sinSkills = saltoValido(estado, 'skills');
  const out = [];
  const py = proyecto === undefined ? proyectoDeRaiz(raiz) : proyecto;
  let rutas;
  const rutasRq = () => (rutas === undefined ? (rutas = raiz ? rutasDelRq(raiz, estado) : null) : rutas);
  const propias = lista(py?.skills_requeridas).length ? exigenciasDelProyecto(estado, py, rutasRq()) : [];
  const odoo = py && usaOdoo(py) ? exigenciasOdoo(py, raiz, rutasRq()) : [];
  for (const x of [...exigencias(estado), ...propias, ...odoo]) {
    if (x.etapa > etapa) continue;
    if (x.skill && !sinSkills && !tieneSkill(estado, x.skill)) out.push(x.skill);
    if (x.causa && !causaEnSpec(raiz, estado.codigo)) out.push(`la causa raíz en docs/rq/${estado.codigo}/spec.md (## Causa)`);
    if (x.tareas && !tareasEnSpec(raiz, estado.codigo)) out.push(`las tareas en docs/rq/${estado.codigo}/spec.md (## Tareas)`);
    if (x.plan && !planEnDisco(raiz, estado.codigo)) out.push(`el plan en docs/rq/${estado.codigo}/plan.md`);
    if (x.revision && estado?.revision?.ok !== true) out.push('la revisión ($RQ revision ok)');
  }
  if (etapa >= ETAPA.VERIFICACION && !verificacionLocalOk(estado) && tocaUi(estado, raiz, py, rutasRq())) {
    // Antes que la revisión: la verificación local es evidencia de la etapa 3, la revisión la cierra.
    const i = out.indexOf('la revisión ($RQ revision ok)');
    out.splice(i === -1 ? out.length : i, 0, FALTA_VERIFICACION_LOCAL);
  }
  return out;
}

/** Primera ruta sensible (proyecto.sensible.rutas) que toca el RQ sin claude-security ni salto, o null. */
export function sensibleSinRevisar(estado, rutas, proyecto) {
  if (tieneSkill(estado, 'claude-security:claude-security') || saltoValido(estado, 'seguridad')) return null;
  const res = lista(proyecto?.sensible?.rutas).filter((g) => typeof g === 'string').map(globARegExp);
  return lista(rutas).find((r) => res.some((re) => re.test(r))) ?? null;
}
