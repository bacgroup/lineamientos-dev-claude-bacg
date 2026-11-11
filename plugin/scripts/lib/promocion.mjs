// PLG-RAMAS (4.2.0): orden de ramas DEV → PROD. En un repo que declara ramas de PROD (ramas_prod) y una rama de DEV
// distinta (rama_dev, entornos.dev.rama o el primero de ramas_solo_pr), a PROD sólo llega lo que ya está en la rama de
// DEV de origin: PROD es la promoción DEV → PROD, nunca una rama de RQ directo.
// - push a una rama de PROD: cada origen publicado tiene que estar contenido en origin/<DEV>;
// - merge de un PR con base en PROD: el PR tiene que venir de la rama de DEV;
// - gh pr create con base en PROD (explícita o la rama por defecto del repo): sólo desde la rama de DEV.
// La excepción (hotfix directo a PROD) es `rq.mjs saltar rama "<frase>" "<motivo>"` en un RQ activo.

import { execFileSync, spawnSync } from 'node:child_process';
import { ramasProd } from './stack.mjs';
import { ramaDev } from './previa.mjs';
import { cli } from './cli.mjs';

const sinHeads = (r) => String(r ?? '').replace(/^refs\/heads\//, '');

/** { prod, dev } del repo si aplica el orden de ramas (hay PROD y una DEV distinta); si no, null. */
export function ordenDeRamas(proyecto, entrada) {
  const prod = ramasProd(proyecto, entrada);
  const dev = ramaDev(proyecto, entrada);
  if (!prod || !prod.length || !dev || prod.includes(dev)) return null;
  return { prod, dev };
}

const git = (raiz, args) => spawnSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function esAncestro(raiz, ref, base, ctx) {
  if (typeof ctx?.esAncestro === 'function') return ctx.esAncestro(ref, base);
  return git(raiz, ['merge-base', '--is-ancestor', ref, base]).status === 0;
}

const existeRef = (raiz, ref, ctx) =>
  typeof ctx?.existeRef === 'function' ? ctx.existeRef(ref) : git(raiz, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]).status === 0;

function ramaActual(raiz) {
  const r = git(raiz, ['symbolic-ref', '-q', '--short', 'HEAD']);
  return r.status === 0 ? r.stdout.trim() : null;
}

function cabezaDelPr(op, raiz, ctx) {
  if (typeof ctx?.headPr === 'function') return ctx.headPr(op) ?? null;
  try {
    const args = ['pr', 'view', ...(op.pr ? [op.pr] : []), ...(op.repoGh ? ['-R', op.repoGh] : []), '--json', 'headRefName', '-q', '.headRefName'];
    return execFileSync('gh', args, { cwd: raiz, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function ramaPorDefecto(op, raiz, ctx) {
  if (typeof ctx?.ramaPorDefecto === 'function') return ctx.ramaPorDefecto(op) ?? null;
  try {
    const args = ['repo', 'view', ...(op.repoGh ? [op.repoGh] : []), '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'];
    return execFileSync('gh', args, { cwd: raiz, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

const pasos = ({ dev, prod }) =>
  `Primero un PR de tu rama a ${dev} (gh pr create --base ${dev}), desplegado y verificado en DEV; después la promoción ${dev} → ${prod} (gh pr create --base ${prod} --head ${dev}, o git push origin origin/${dev}:${prod} si es fast-forward). Si el usuario decide un hotfix directo a PROD: ${cli()} saltar rama "<frase>" "<motivo>".`;

/**
 * Motivo para negar una publicación (push o merge de PR) a una rama de PROD que no viene de la rama de DEV, o null si
 * está bien o no aplica. `destinos`: ramas que actualiza (ramasDestino). Falla cerrada en el merge si no se puede
 * leer la rama de origen del PR.
 */
export function faltaPasarPorDev(op, raiz, nombre, orden, destinos, ctx) {
  if (!orden || !Array.isArray(destinos)) return null;
  const aProd = destinos.filter((d) => orden.prod.includes(d));
  if (!aProd.length) return null;
  const { dev } = orden;
  const prod = aProd[0];
  if (op.op === 'merge-pr') {
    const cabeza = cabezaDelPr(op, raiz, ctx);
    if (cabeza === dev) return null;
    return `${nombre}: a ${prod} (PROD) sólo se mergea el PR de promoción desde ${dev}; ${cabeza ? `este PR viene de ${cabeza}` : 'no pude leer de qué rama viene este PR'}. ${pasos({ dev, prod })}`;
  }
  const remota = `refs/remotes/origin/${dev}`;
  if (!existeRef(raiz, remota, ctx)) return `${nombre}: no encuentro origin/${dev} para comprobar que lo que va a ${prod} (PROD) ya pasó por DEV: corré git fetch origin y reintentá.`;
  // Sin refspecs se publica HEAD en su upstream (ya se sabe que es PROD); con refspecs, cada origen que va a PROD.
  const pares = Array.isArray(op.refspecs) && op.refspecs.length
    ? op.refspecs.map((r) => {
        const [origen, dst] = r.replace(/^\+/, '').split(':');
        const rama = sinHeads(dst === undefined ? origen : dst);
        return { fuente: origen === '' ? null : origen === '@' ? 'HEAD' : origen, destino: rama === 'HEAD' || rama === '@' ? ramaActual(raiz) : rama };
      })
    : [{ fuente: 'HEAD', destino: prod }];
  for (const { fuente, destino } of pares) {
    if (!orden.prod.includes(destino)) continue;
    if (!fuente || !esAncestro(raiz, fuente, remota, ctx)) {
      return `${nombre}: a ${destino} (PROD) sólo llega lo que ya está en origin/${dev}, y ${fuente ?? 'lo que se publica'} tiene commits que no pasaron por ${dev}. ${pasos({ dev, prod: destino })}`;
    }
  }
  return null;
}

/** Motivo para negar `gh pr create` con base en PROD desde otra rama que la de DEV, o null. */
export function prAProdSinDev(op, raiz, nombre, orden, ctx) {
  if (!orden) return null;
  const base = op.base ?? ramaPorDefecto(op, raiz, ctx);
  if (!base || !orden.prod.includes(base)) return null;
  const cabeza = op.head ?? ramaActual(raiz);
  if (cabeza === orden.dev) return null;
  const explicita = op.base ? '' : ` (sin --base, gh usa la rama por defecto del repo, que es ${base})`;
  return `${nombre}: un PR a ${base} (PROD) sólo puede venir de ${orden.dev}${explicita}. Abrilo a DEV: gh pr create --base ${orden.dev}${op.head ? ` --head ${op.head}` : ''}. Si el usuario decide un hotfix directo a PROD: ${cli()} saltar rama "<frase>" "<motivo>".`;
}
