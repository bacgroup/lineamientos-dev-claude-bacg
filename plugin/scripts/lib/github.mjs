// GitHub por REST (PLG-CLOUD). Todo lo que el plugin lee de GitHub pasa por acá, con `gh api` sobre la API REST: en
// Claude Code en la nube GraphQL (gh pr list/view/checks/create) da 403 y `gh auth status` falla aunque `gh api`
// funcione con la credencial que inyecta el proxy. Cada función devuelve { datos } o { error }: quien llama decide el
// mensaje, y un error nunca se lee como "no hay nada".
//
// `correr` (para tests) recibe los argumentos de `gh` y devuelve { datos } | { error }, como `ghJson`.
import { spawnSync } from 'node:child_process';
import { remotoGh } from './config.mjs';

const PAGINA = 100;

/** Corre `gh <args>` y parsea JSON: { datos } | { error }. Nunca lanza. */
export function ghJson(args, { env = process.env, timeout = 30000 } = {}) {
  try {
    const r = spawnSync('gh', args, { encoding: 'utf8', timeout, env, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error) return { error: r.error.code === 'ENOENT' ? 'gh no está instalado' : r.error.message };
    if (r.status !== 0) return { error: (r.stderr ?? '').trim().split('\n')[0] || `gh salió ${r.status}` };
    const salida = (r.stdout ?? '').trim();
    return { datos: salida ? JSON.parse(salida) : null };
  } catch (e) {
    return { error: e.message };
  }
}

/** GET de la API REST: `ruta` sin la barra inicial (repos/o/r/pulls?…). */
export function api(ruta, { correr, env, timeout } = {}) {
  const args = ['api', ruta];
  return (correr ?? ((a) => ghJson(a, { env, ...(timeout ? { timeout } : {}) })))(args);
}

/** Tope para las consultas que corren dentro de un hook (el hook entero tiene 30 s): mejor un error que un corte. */
export const EN_HOOK = { timeout: 4000 };

const enc = (s) => encodeURIComponent(String(s));
const owner = (repo) => String(repo).split('/')[0];
const lista = (x) => (Array.isArray(x) ? x : []);

/** PR abiertos del repo (`owner/repo`), opcionalmente contra `base` y desde `head` (rama de este repo). */
export function prsAbiertos(repo, { base, head } = {}, opts = {}) {
  const q = [`state=open`, `per_page=${PAGINA}`, base ? `base=${enc(base)}` : '', head ? `head=${enc(`${owner(repo)}:${head}`)}` : ''].filter(Boolean).join('&');
  const r = api(`repos/${repo}/pulls?${q}`, opts);
  if (r.error) return r;
  const datos = lista(r.datos).map((p) => ({
    number: p.number, title: p.title ?? '', autor: p.user?.login ?? '?', head: p.head?.ref ?? '', base: p.base?.ref ?? '',
    sha: p.head?.sha ?? null, url: p.html_url ?? '',
  }));
  return { datos, cortado: datos.length >= PAGINA };
}

/** PR (abiertos o cerrados) cuya rama es `rama`: [{ number, estado, mergeado, base, sha, url }]. */
export function prsDeRama(repo, rama, { estado = 'all' } = {}, opts = {}) {
  const r = api(`repos/${repo}/pulls?state=${estado}&per_page=${PAGINA}&head=${enc(`${owner(repo)}:${rama}`)}`, opts);
  if (r.error) return r;
  return {
    datos: lista(r.datos).map((p) => ({
      number: p.number, estado: p.state, mergeado: Boolean(p.merged_at), mergedAt: p.merged_at ?? null,
      base: p.base?.ref ?? '', sha: p.head?.sha ?? null, url: p.html_url ?? '',
    })),
  };
}

/** Un PR por número: { number, base, head, mergeado, url }. */
export function pr(repo, numero, opts = {}) {
  const r = api(`repos/${repo}/pulls/${enc(numero)}`, opts);
  if (r.error) return r;
  const p = r.datos ?? {};
  return { datos: { number: p.number, base: p.base?.ref ?? null, head: p.head?.ref ?? null, mergeado: Boolean(p.merged_at), url: p.html_url ?? '' } };
}

/** Rutas de los archivos de un PR (hasta 100; `cortado` si puede haber más). */
export function archivosPr(repo, numero, opts = {}) {
  const r = api(`repos/${repo}/pulls/${enc(numero)}/files?per_page=${PAGINA}`, opts);
  if (r.error) return r;
  const datos = lista(r.datos).map((f) => f.filename).filter(Boolean);
  return { datos, cortado: datos.length >= PAGINA };
}

/** Checks de un commit (check-runs y statuses): [{ nombre, estado: ok | fallo | en-curso }]. */
export function checksDe(repo, sha, opts = {}) {
  const runs = api(`repos/${repo}/commits/${enc(sha)}/check-runs?per_page=${PAGINA}`, opts);
  if (runs.error) return runs;
  const st = api(`repos/${repo}/commits/${enc(sha)}/status`, opts);
  // Sin los statuses no se sabe si hay una verificación externa en rojo: error, no "sin checks".
  if (st.error) return { error: `statuses: ${st.error}` };
  const out = lista(runs.datos?.check_runs).map((c) => ({
    nombre: c.name,
    estado: c.status !== 'completed' ? 'en-curso' : ['success', 'neutral', 'skipped'].includes(c.conclusion) ? 'ok' : 'fallo',
  }));
  for (const s of lista(st.datos?.statuses)) {
    out.push({ nombre: s.context, estado: s.state === 'success' ? 'ok' : s.state === 'pending' ? 'en-curso' : 'fallo' });
  }
  return { datos: out };
}

/** Rama por defecto del repo. */
export function ramaPorDefecto(repo, opts = {}) {
  const r = api(`repos/${repo}`, opts);
  return r.error ? r : { datos: r.datos?.default_branch ?? null };
}

/** Login de la cuenta con la que `gh api` está autenticado (también con la credencial del proxy de la nube). */
export function cuentaActual(opts = {}) {
  const r = api('user', opts);
  return r.error ? r : { datos: r.datos?.login ?? null };
}

/**
 * El PR al que se refiere un comando (`gh pr merge [<n>|<rama>] [-R owner/repo]`): número y repo. Sin número, el PR
 * abierto de la rama (la del comando o la actual). { datos: { repo, numero } } | { error }.
 */
export function resolverPr({ pr: ref, repoGh, raiz, ramaActual }, opts = {}) {
  const repo = repoGh || (raiz ? remotoGh(raiz) : null);
  if (!repo) return { error: 'no sé el repo del PR' };
  if (ref !== undefined && ref !== null && /^\d+$/.test(String(ref).replace(/^#/, ''))) return { datos: { repo, numero: Number(String(ref).replace(/^#/, '')) } };
  const rama = ref || ramaActual;
  if (!rama) return { error: 'no sé la rama del PR' };
  const r = prsDeRama(repo, rama, { estado: 'open' }, opts);
  if (r.error) return r;
  if (r.datos.length !== 1) return { error: r.datos.length ? `hay ${r.datos.length} PR abiertos de ${rama}` : `no hay PR abierto de ${rama}` };
  return { datos: { repo, numero: r.datos[0].number } };
}

/** Comandos REST equivalentes a los de `gh pr` que la skill sugiere (GraphQL no anda en la nube). */
export const REST = {
  crearPr: (repo, base, head) => `gh api repos/${repo}/pulls -f base=${base} -f head=${head} -f title="<título>" -F body=@<archivo.md>`,
  checks: (repo, sha) => `gh api "repos/${repo}/commits/${sha}/check-runs" --jq '.check_runs[] | [.name,.status,.conclusion] | @tsv'`,
  mergear: (repo, n) => `gh api -X PUT repos/${repo}/pulls/${n}/merge -f merge_method=squash`,
};
