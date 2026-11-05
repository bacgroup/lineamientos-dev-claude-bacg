// Validación previa a un RQ (PLG-PREVIA): antes de abrir un RQ nuevo, traer lo remoto y mostrar dónde está parado el
// trabajo, para no arrancar sobre un checkout viejo ni pisar a otro dev.
//
// Por cada repo del proyecto en esta PC (el de la sesión y sus hermanos):
//   - `git fetch --prune origin` (sin red, avisa y sigue: no se pudo verificar);
//   - cuántos commits está atrás de la rama de DEV (`rama_dev` del repo, `entornos.dev.rama`, el primero de
//     `ramas_solo_pr` o, si no hay, la rama principal de origin);
//   - ramas remotas activas (commits en los últimos DIAS_PARALELO días que la rama de DEV no tiene);
//   - PR abiertos contra la rama de DEV (gh), con sus módulos (primer segmento de las rutas).
// Y el backlog remoto: la fila del código y las otras filas "En curso".
//
// Bloquea sólo con evidencia positiva y sólo un RQ nuevo (sin estado local ni en un repo hermano): el código ya
// figura En curso o Hecho en el backlog remoto, o hay una rama o un PR que lo nombra. Lo demás informa.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configEnRepo, nombreRepo } from './config.mjs';
import { reposHermanos, vinculados } from './multi-repo.mjs';
import { parsearBacklog } from './backlog.mjs';
import { refPrincipal, nombraCodigo } from './no-aplica.mjs';
import { ramasProd } from './stack.mjs';

export const DIAS_PARALELO = 30;
const lista = (x) => (Array.isArray(x) ? x : []);
const texto = (x) => (typeof x === 'string' ? x.trim() : '');

// Git sin prompts: sin credenciales, un fetch falla y la previa avisa. Con prompt, el administrador de credenciales
// (Git Credential Manager en Windows) espera un login que nadie ve, y spawnSync no vuelve aunque mate a git.
const GIT_SIN_PROMPT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };

function git(cwd, args, timeout = 15000) {
  try {
    const r = spawnSync('git', ['-c', 'credential.interactive=false', ...args], {
      cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...GIT_SIN_PROMPT },
    });
    return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  } catch (e) {
    return { ok: false, out: '', err: e.message };
  }
}

function ghJson(args, env) {
  try {
    const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 30000, env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) return { error: (r.stderr ?? '').trim().split('\n')[0] || `gh salió ${r.status}` };
    return { datos: JSON.parse(r.stdout || '[]') };
  } catch (e) {
    return { error: e.message };
  }
}

const entradaDe = (proyecto, nombre) =>
  lista(proyecto?.repos).find((r) => texto(r?.nombre).toLowerCase() === String(nombre).toLowerCase()) ?? null;

/** Rama de DEV de un repo: `rama_dev` de su entrada, `entornos.dev.rama`, el primero de `ramas_solo_pr`; o null. */
export function ramaDev(proyecto, entradaRepo) {
  if (texto(entradaRepo?.rama_dev)) return texto(entradaRepo.rama_dev);
  const dev = proyecto?.entornos?.dev;
  if (texto(dev?.rama) && (!dev.tipo || dev.tipo === 'rama')) return texto(dev.rama);
  for (const x of [entradaRepo?.ramas_solo_pr, proyecto?.ramas_solo_pr]) {
    const l = lista(x).map(texto).filter(Boolean);
    if (l.length) return l[0];
    if (texto(x)) return texto(x);
  }
  return null;
}

const existeRef = (raiz, ref) => git(raiz, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]).ok;
const cuenta = (raiz, rango) => Number(git(raiz, ['rev-list', '--count', rango]).out || 0);

/** Ramas de origin con commits recientes que `base` no tiene: [{ rama, autor, fecha, adelante }]. */
export function ramasEnParalelo(raiz, base, excluir = [], { dias = DIAS_PARALELO, ahora = Date.now() } = {}) {
  const r = git(raiz, ['for-each-ref', 'refs/remotes/origin', '--format=%(refname:short)%09%(committerdate:unix)%09%(authorname)']);
  if (!r.ok) return [];
  const fuera = new Set(['origin/HEAD', 'origin', ...excluir.filter(Boolean).map((b) => `origin/${b}`)]);
  const limite = ahora / 1000 - dias * 86400;
  const out = [];
  for (const linea of r.out.split('\n').filter(Boolean)) {
    const [ref, unix, autor] = linea.split('\t');
    if (fuera.has(ref) || Number(unix) < limite) continue;
    const adelante = base ? cuenta(raiz, `${base}..${ref}`) : 1;
    if (adelante === 0) continue;
    out.push({ rama: ref.replace(/^origin\//, ''), autor, fecha: new Date(Number(unix) * 1000).toISOString().slice(0, 10), adelante });
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Módulos (primer segmento de cada ruta) de una lista de archivos de un PR, hasta `max`. */
export function modulosDe(archivos, max = 6) {
  const m = [...new Set(lista(archivos).map((f) => texto(f?.path ?? f).split('/')[0]).filter(Boolean))];
  return m.length > max ? [...m.slice(0, max), `+${m.length - max}`] : m;
}

/**
 * Backlog tal como está en origin: { fuente, filas, atras } o { error }. Con la configuración en el repo, el
 * docs/backlog.md de la rama principal de origin; si no, proyectos/<id>/backlog.md del upstream de la copia de
 * lineamientos (después de un fetch). `atras` = commits que la copia local no tiene.
 */
export function backlogRemoto({ raiz, proyectoId, dirLin }) {
  if (configEnRepo(raiz)) {
    const principal = refPrincipal(raiz);
    if (!principal) return { error: 'el repo no tiene rama principal en origin' };
    const r = git(raiz, ['show', `${principal}:docs/backlog.md`]);
    return r.ok ? { fuente: `${principal}:docs/backlog.md`, filas: parsearBacklog(r.out), atras: 0 } : { error: `no hay docs/backlog.md en ${principal}` };
  }
  if (!dirLin || !fs.existsSync(path.join(dirLin, '.git'))) return { error: 'la copia de lineamientos no es un clon de git' };
  const f = git(dirLin, ['fetch', '--quiet', 'origin'], 60000);
  if (!f.ok) return { error: `no pude traer los lineamientos (${f.err.split('\n')[0] || 'sin red'})` };
  const rel = `proyectos/${proyectoId}/backlog.md`;
  // El upstream de la rama de la copia; si no tiene (una rama local), la principal de origin.
  const ref = existeRef(dirLin, '@{u}') ? '@{u}' : refPrincipal(dirLin);
  if (!ref) return { error: 'la copia de lineamientos no tiene upstream ni rama principal en origin' };
  const r = git(dirLin, ['show', `${ref}:${rel}`]);
  if (!r.ok) return { error: `no hay ${rel} en ${ref === '@{u}' ? 'el upstream' : ref} de los lineamientos` };
  return { fuente: `lineamientos (${ref === '@{u}' ? 'upstream' : ref}) ${rel}`, filas: parsearBacklog(r.out), atras: cuenta(dirLin, `HEAD..${ref}`) };
}

const enCurso = (estado) => /en curso/i.test(String(estado ?? ''));
const hecho = (estado) => /^hecho/i.test(String(estado ?? '').trim());
const corto = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Corre la validación. `repo` = { raiz, proyectoId, porRemoto }; `nuevo` = el RQ no existe en este repo.
 * Devuelve { lineas, bloqueos }: lineas para mostrar, bloqueos (textos) que impiden abrir un RQ nuevo.
 * Opciones para tests: gh (función que recibe args y devuelve { datos } | { error }), ahora.
 */
export function validacionPrevia({ repo, proyecto, codigo = null, nuevo = true, env = process.env, dirLin, gh, ahora } = {}) {
  const lineas = [];
  const bloqueos = [];
  const raiz = repo.raiz;
  const id = repo.proyectoId;
  const nombre = texto(proyecto?.nombre) || id;
  lineas.push(`Proyecto: ${id}${nombre !== id ? ` (${nombre})` : ''} · repo ${nombreRepo(raiz)} · detectado por ${repo.porRemoto ? 'su remoto origin' : 'el marcador del repo'}.`);

  // Un RQ con el mismo código activo en un repo hermano es el mismo RQ (multi-repo): no es trabajo de otro.
  const vinculado = codigo ? vinculados(raiz, id, proyecto, codigo).length > 0 : false;
  const esNuevo = Boolean(codigo) && nuevo && !vinculado;
  const usarGh = env.BACG_DEV_SIN_GH !== '1';
  const correrGh = gh ?? ((args) => ghJson(args, env));
  const cuentaGh = texto(proyecto?.cuenta_github) || texto(proyecto?.cuenta_gh);

  lineas.push('Repos (origin recién traído):');
  const paralelo = [];
  for (const r of [raiz, ...reposHermanos(raiz, id, proyecto)]) {
    const n = nombreRepo(r);
    if (!git(r, ['remote', 'get-url', 'origin']).ok) {
      lineas.push(`- ${n}: sin remoto origin, no se puede verificar.`);
      continue;
    }
    const f = git(r, ['fetch', '--prune', '--quiet', 'origin'], 60000);
    const entrada = entradaDe(proyecto, n);
    const dev = ramaDev(proyecto, entrada);
    const base = dev ? `origin/${dev}` : refPrincipal(r);
    const rama = git(r, ['rev-parse', '--abbrev-ref', 'HEAD']).out || '?';
    const aviso = f.ok ? '' : ` (no pude traer origin: ${f.err.split('\n')[0] || 'sin red'}; datos del último fetch)`;
    if (!base || !existeRef(r, base)) {
      lineas.push(`- ${n} (${rama}): no existe ${base ?? 'la rama de DEV'} en origin${aviso}.`);
    } else {
      const atras = cuenta(r, `HEAD..${base}`);
      lineas.push(`- ${n} (${rama}): ${atras ? `${atras} commit(s) detrás de ${base}: actualizá antes de empezar` : `al día con ${base}`}${aviso}.`);
    }
    const excluir = [dev, ...(ramasProd(proyecto, entrada) ?? []), refPrincipal(r)?.replace(/^origin\//, ''), rama];
    for (const p of ramasEnParalelo(r, base && existeRef(r, base) ? base : null, excluir, { ahora })) {
      paralelo.push(`- ${n}: rama ${p.rama} · ${p.autor} · ${p.fecha} · ${p.adelante} commit(s) que ${dev ?? 'DEV'} no tiene`);
      if (esNuevo && nombraCodigo(codigo, p.rama)) bloqueos.push(`en ${n} ya existe la rama origin/${p.rama} (${p.autor}, ${p.fecha})`);
    }
    if (usarGh && cuentaGh && dev) {
      const pr = correrGh(['pr', 'list', '-R', `${cuentaGh}/${n}`, '--base', dev, '--state', 'open', '--limit', '50', '--json', 'number,title,author,headRefName,files']);
      if (pr.error) paralelo.push(`- ${n}: no pude listar los PR (${pr.error}).`);
      for (const x of lista(pr.datos)) {
        const mods = modulosDe(x.files);
        paralelo.push(`- ${n}: PR #${x.number} ${corto(texto(x.title))} · ${x.author?.login ?? '?'} · ${x.headRefName}${mods.length ? ` · toca ${mods.join(', ')}` : ''}`);
        if (esNuevo && (nombraCodigo(codigo, x.headRefName) || nombraCodigo(codigo, x.title))) {
          bloqueos.push(`en ${n} ya hay un PR abierto del código: #${x.number} (${x.author?.login ?? '?'})`);
        }
      }
    }
  }
  lineas.push(paralelo.length ? 'Trabajo en paralelo (ramas y PR abiertos):' : `Trabajo en paralelo: ninguna rama ni PR abierto en los últimos ${DIAS_PARALELO} días.`);
  lineas.push(...paralelo);

  const b = backlogRemoto({ raiz, proyectoId: id, dirLin });
  if (b.error) {
    lineas.push(`Backlog remoto: ${b.error}; no verifiqué el código contra el backlog.`);
  } else {
    if (b.atras) lineas.push(`Backlog: tu copia de lineamientos está ${b.atras} commit(s) atrás de origin (git -C "${dirLin}" pull).`);
    const fila = codigo ? b.filas.find((f) => texto(f['Código']).toLowerCase() === codigo.toLowerCase()) : null;
    if (codigo) lineas.push(fila ? `Backlog remoto: ${codigo} figura "${texto(fila.Estado)}".` : `Backlog remoto: ${codigo} no figura (código libre).`);
    if (esNuevo && fila && (enCurso(fila.Estado) || hecho(fila.Estado))) {
      bloqueos.push(`${codigo} ya figura "${texto(fila.Estado)}" en el backlog remoto (${b.fuente})`);
    }
    const otros = b.filas.filter((f) => enCurso(f.Estado) && texto(f['Código']).toLowerCase() !== String(codigo ?? '').toLowerCase());
    if (otros.length) {
      lineas.push('En curso según el backlog remoto:');
      for (const f of otros) lineas.push(`- ${texto(f['Código'])}: ${corto(texto(f.Tarea))}`);
    } else lineas.push(`Backlog remoto (${b.fuente}): ningún otro RQ En curso.`);
  }
  return { lineas, bloqueos };
}

/** Texto del error cuando la validación bloquea un RQ nuevo. */
export function mensajeBloqueo(codigo, bloqueos) {
  return [
    `No abro ${codigo}: parece que ya se está trabajando.`,
    ...bloqueos.map((x) => `- ${x}`),
    `Si es tuyo (otra PC o sesión), traé su rama (git switch <rama>) y volvé a abrir: con docs/rq/${codigo}/estado.yml en el checkout, se retoma.`,
    'Si es otro trabajo, elegí otro código. Si el usuario confirma con sus palabras que igual hay que abrirlo: --sin-previa.',
  ].join('\n');
}
