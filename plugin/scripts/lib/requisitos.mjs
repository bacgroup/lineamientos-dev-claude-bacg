// Skills de proceso que exige cada tipo al llegar a una etapa (3 desarrollo, 4 verificación, 6 PROD) y la
// revisión de seguridad de las rutas sensibles. Se controlan al pasar de etapa (etapa, revision, commit y la
// publicación a PROD), no al editar. `saltar skills` cubre las skills; `saltar seguridad`, la de seguridad.
//
// Además, cada proyecto puede exigir skills propias (PLG-SKILLS) en proyecto.yml:
//   skills_requeridas:
//     - { etapa: 3, skill: "anthropic-skills:bacg-n8n-guidelines", rutas: ["**/n8n/**", "**/*.workflow.json"] }
//     - { etapa: 3, skill: "anthropic-skills:bacg-diagnostico-bugs", tipo: bug }
// `etapa` 3, 4 o 6; `tipo` rq | bug (sin la clave, los dos); `rutas` (opcional): sólo si el RQ toca alguna.

import fs from 'node:fs';
import path from 'node:path';
import { saltoValido } from './estado.mjs';
import { globARegExp } from './rutas.mjs';
import { buscarRepo, dirLineamientos } from './config.mjs';
import { proyectoRegistrado } from './contexto.mjs';
import { rutasDelRq } from './circuito.mjs';

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

/** Skills que exige el proyecto (`skills_requeridas`) para este RQ: [{ etapa, skill }]. */
export function exigenciasDelProyecto(estado, proyecto, rutasRq) {
  const bug = esBug(estado);
  const out = [];
  for (const x of lista(proyecto?.skills_requeridas)) {
    if (!x || typeof x.skill !== 'string' || ![3, 4, 6].includes(x.etapa)) continue;
    if (x.tipo === 'bug' && !bug) continue;
    if (x.tipo === 'rq' && bug) continue;
    const globs = lista(x.rutas).filter((g) => typeof g === 'string');
    if (globs.length) {
      const res = globs.map(globARegExp);
      // Sin poder saber qué toca el RQ (rutas null), se exige: falla cerrada.
      if (rutasRq && !rutasRq.some((r) => res.some((re) => re.test(r)))) continue;
    }
    out.push({ etapa: x.etapa, skill: x.skill.trim() });
  }
  return out;
}

/** Exigencias por etapa según el tipo: [{ etapa, skill? , causa?, revision? }]. */
export function exigencias(estado) {
  const bug = esBug(estado);
  const l = [];
  if (bug) l.push({ etapa: 3, skill: 'superpowers:systematic-debugging' }, { etapa: 3, causa: true });
  else if (estado?.clasificacion === 'arquitectonico') l.push({ etapa: 3, skill: 'superpowers:writing-plans' });
  l.push({ etapa: 4, skill: 'superpowers:test-driven-development' });
  if (!bug) l.push({ etapa: 6, skill: 'superpowers:verification-before-completion' });
  l.push({ etapa: 6, revision: true });
  return l;
}

/** Lo que falta para llegar a `etapa` (incluye lo de las anteriores), como textos cortos. */
export function faltaParaEtapa(estado, etapa, raiz, proyecto = undefined) {
  const sinSkills = saltoValido(estado, 'skills');
  const out = [];
  const py = proyecto === undefined ? proyectoDeRaiz(raiz) : proyecto;
  const propias = lista(py?.skills_requeridas).length ? exigenciasDelProyecto(estado, py, raiz ? rutasDelRq(raiz, estado) : null) : [];
  for (const x of [...exigencias(estado), ...propias]) {
    if (x.etapa > etapa) continue;
    if (x.skill && !sinSkills && !tieneSkill(estado, x.skill)) out.push(x.skill);
    if (x.causa && !causaEnSpec(raiz, estado.codigo)) out.push(`la causa raíz en docs/rq/${estado.codigo}/spec.md (## Causa)`);
    if (x.revision && estado?.revision?.ok !== true) out.push('la revisión ($RQ revision ok)');
  }
  return out;
}

/** Primera ruta sensible (proyecto.sensible.rutas) que toca el RQ sin claude-security ni salto, o null. */
export function sensibleSinRevisar(estado, rutas, proyecto) {
  if (tieneSkill(estado, 'claude-security:claude-security') || saltoValido(estado, 'seguridad')) return null;
  const res = lista(proyecto?.sensible?.rutas).filter((g) => typeof g === 'string').map(globARegExp);
  return lista(rutas).find((r) => res.some((re) => re.test(r))) ?? null;
}
