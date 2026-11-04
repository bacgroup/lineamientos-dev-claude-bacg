// Rutas puras (sin I/O): normalización, glob y clasificación de archivos.

const norm = (p) => String(p).replace(/\\/g, '/');
const conUnidad = (p) => /^[A-Za-z]:/.test(p);

// Ruta relativa POSIX de `ruta` respecto de `raiz`; null si cae fuera. La raíz misma da ''.
export function relativaAlRepo(raiz, ruta) {
  let r = norm(raiz).replace(/\/+$/, '');
  let p = norm(ruta);
  if (conUnidad(r) || conUnidad(p)) {
    r = r.toLowerCase();
    const original = p;
    p = p.toLowerCase();
    if (p === r) return '';
    if (!p.startsWith(r + '/')) return null;
    return original.slice(r.length + 1);
  }
  if (p === r) return '';
  if (!p.startsWith(r + '/')) return null;
  return p.slice(r.length + 1);
}

// glob -> RegExp: `**/` = cero o más segmentos, `**` = cualquier cosa, `*` = sin '/', `?` = un carácter sin '/'.
export function globARegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

// Documentación, tests e instrucciones en texto para agentes: se editan, commitean y pushean sin RQ.
// `.claude/` nunca es libre, ni sus .md: settings, hooks, agentes, comandos y skills definen lo que el agente
// puede hacer (herramientas permitidas, permisos), así que cambiarlos pasa por la compuerta.
// `.como-trabajo/` tampoco: su proyecto.yml declara qué es PROD, qué repos publican y qué tests corren.
const NUNCA_LIBRES = ['.claude/**', '.como-trabajo/**'].map(globARegExp);
const LIBRES = [
  'docs/**', '**/*.md', '**/*.test.*', '**/*.spec.*', 'e2e/**', 'tests/**', '.lineamientos',
  '.lovable/**', '.agents/**',
].map(globARegExp);

const lista = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);

/** Reglas de UI del proyecto: [{ patrones, skills }]. ui.reglas manda; si no, ui.patrones con ui.skills. */
export function reglasUi(proyecto) {
  const ui = proyecto?.ui ?? {};
  const reglas = Array.isArray(ui.reglas)
    ? ui.reglas.filter((r) => r && typeof r === 'object').map((r) => ({ patrones: lista(r.patrones), skills: lista(r.skills) }))
    : [];
  const general = { patrones: lista(ui.patrones), skills: lista(ui.skills) };
  return [...reglas, general].filter((r) => r.patrones.length > 0);
}

/** Skills que exige editar este archivo de UI: las de la primera regla cuyo patrón lo cubre. */
export function skillsUi(rel, proyecto) {
  const regla = reglasUi(proyecto).find((r) => r.patrones.some((g) => globARegExp(g).test(rel)));
  return regla ? regla.skills : [];
}

export function tipoArchivo(rel, proyecto) {
  if (!NUNCA_LIBRES.some((re) => re.test(rel)) && LIBRES.some((re) => re.test(rel))) return 'libre';
  if (reglasUi(proyecto).some((r) => r.patrones.some((g) => globARegExp(g).test(rel)))) return 'ui';
  return 'producto';
}
