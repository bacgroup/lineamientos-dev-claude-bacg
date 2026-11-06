import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from '../vendor/js-yaml.mjs';
import { fraseDelUsuario } from './transcript.mjs';
import { aV4, ETAPA, VERSION_CICLO, CLASIFICACIONES_DISENO_V3 } from './etapas.mjs';

const RE_CODIGO = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// Etapas que la autonomía puede cumplir: desarrollo y DEV. Nunca el diseño (1), la verificación (3, evidencia) ni PROD.
const ETAPAS_AUTONOMAS = [ETAPA.DESARROLLO, ETAPA.DEV];
// Clasificaciones con autonomía hasta DEV (etapa 4) por defecto: el agente decide, lo anota y sigue.
const AUTONOMIA_POR_DEFECTO = ['spike', 'bounded'];

const codigoOk = (c) => typeof c === 'string' && RE_CODIGO.test(c);
const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const lista = (x) => (Array.isArray(x) ? x : []);

function carpetaRq(raiz, codigo) {
  if (!codigoOk(codigo)) throw new Error(`ESTADO_INVALIDO: ${codigo}: código inválido`);
  return path.join(raiz, 'docs', 'rq', codigo);
}

/** Códigos de los RQ activos (docs/rq/ACTIVO, uno por línea, el más reciente al final). */
export function rqsActivos(raiz) {
  let t;
  try {
    t = fs.readFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'utf8');
  } catch {
    return [];
  }
  return [...new Set(t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

/** Código del RQ activo más reciente, o null. */
export function rqActivo(raiz) {
  const todos = rqsActivos(raiz);
  return todos.length ? todos[todos.length - 1] : null;
}

/** Escribe la lista de RQ activos (borra ACTIVO si queda vacía). */
export function guardarActivos(raiz, codigos) {
  const archivo = path.join(raiz, 'docs', 'rq', 'ACTIVO');
  const lista = [...new Set(codigos.filter(codigoOk))];
  if (lista.length === 0) {
    fs.rmSync(archivo, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, `${lista.join('\n')}\n`);
}

export function cargarEstado(raiz, codigo) {
  const archivo = path.join(carpetaRq(raiz, codigo), 'estado.yml');
  let texto;
  try {
    texto = fs.readFileSync(archivo, 'utf8');
  } catch {
    throw new Error(`ESTADO_INEXISTENTE: ${codigo}`);
  }
  let estado;
  try {
    estado = yaml.load(texto);
  } catch (e) {
    throw new Error(`ESTADO_INVALIDO: ${codigo}: ${e.message}`);
  }
  if (!esObjeto(estado)) {
    throw new Error(`ESTADO_INVALIDO: ${codigo}: el estado no es un objeto YAML`);
  }
  // Un RQ abierto con 3.x se lee en v4 (con `_v3: true`); el archivo no se toca hasta el próximo guardarEstado.
  return aV4(estado);
}

// Muta el objeto recibido: le setea `version_ciclo` y `actualizado` antes de escribirlo. La marca `_v3` de un
// estado convertido no se escribe: desde acá el archivo queda en v4.
export function guardarEstado(raiz, estado) {
  const dir = carpetaRq(raiz, estado?.codigo);
  delete estado._v3;
  estado.version_ciclo = VERSION_CICLO;
  estado.actualizado = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'estado.yml'), yaml.dump(estado, { lineWidth: -1 }));
}

/** Versión de estado.yml en `ref` (HEAD por defecto), en v4, o null si no está commiteada / no hay ref / no parsea / no es un objeto. */
export function estadoCommiteado(raiz, codigo, ref = 'HEAD') {
  if (!codigoOk(codigo)) return null;
  try {
    const out = execFileSync('git', ['show', `${ref}:docs/rq/${codigo}/estado.yml`], {
      cwd: raiz,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const o = yaml.load(out);
    return esObjeto(o) ? aV4(o) : null;
  } catch {
    return null;
  }
}

// Las frases se validan al registrarlas: la compuerta de Bash niega `rq.mjs aprobar|autonomia|saltar` si la frase
// no es texto literal del usuario. Lo que quedó en estado.yml vale para todo el RQ (otra sesión, subagentes),
// salvo el OK de PROD (etapa 5): ése se vuelve a comprobar al usarlo contra los mensajes del usuario de la sesión
// (ctx.textosUsuario), para que un registro hecho por fuera de la compuerta no alcance para publicar.
const fraseOk = (f) => typeof f === 'string' && f.trim() !== '';

export function aprobacionValida(aprob) {
  return esObjeto(aprob) && Number.isInteger(aprob.etapa) && fraseOk(aprob.frase);
}

/** Autonomía del RQ: la registrada o, en spike y bounded, hasta DEV (etapa 4) por defecto. */
export function autonomiaDe(estado) {
  const aut = estado?.autonomia;
  if (esObjeto(aut) && Number.isInteger(aut.hasta) && fraseOk(aut.frase)) return aut.hasta;
  return AUTONOMIA_POR_DEFECTO.includes(estado?.clasificacion) ? ETAPA.DEV : 0;
}

export function etapaCumplida(estado, etapa, ctx) {
  try {
    return calcularEtapa(estado, etapa, esObjeto(ctx) ? ctx : {});
  } catch {
    return false;
  }
}

/** ¿Existe docs/rq/<código>/spec.md? null si no se conoce la raíz. */
function specExiste(estado, ctx) {
  const raiz = typeof ctx.raiz === 'string' && ctx.raiz !== '' ? ctx.raiz : null;
  if (!raiz) return null;
  return codigoOk(estado.codigo) && fs.existsSync(path.join(raiz, 'docs', 'rq', estado.codigo, 'spec.md'));
}

// Diseño (1): `aprobar 1` y, si se conoce la raíz, spec.md. Un spike o bounded abierto con 3.x (`diseno_v3`) lo
// cumple con spec.md, sin aprobación, como en 3.x; sin raíz no se puede ver spec.md y no alcanza.
function disenoCumplido(estado, ctx) {
  const spec = specExiste(estado, ctx);
  if (spec === false) return false;
  if (lista(estado.aprobaciones).some((a) => aprobacionValida(a) && a.etapa === ETAPA.DISENO)) return true;
  return spec === true && estado.diseno_v3 === true && CLASIFICACIONES_DISENO_V3.includes(estado.clasificacion);
}

function calcularEtapa(estado, etapa, ctx) {
  if (!esObjeto(estado)) return false;
  // Verificación: sólo evidencia, sin aprobación humana ni autonomía.
  if (etapa === ETAPA.VERIFICACION) return estado.tests?.ok === true && estado.revision?.ok === true;

  if (etapa === ETAPA.PROD) {
    const textos = Array.isArray(ctx.textosUsuario) ? ctx.textosUsuario : [];
    return lista(estado.aprobaciones).some(
      (a) => aprobacionValida(a) && a.etapa === ETAPA.PROD && fraseDelUsuario(a.frase, textos),
    );
  }
  if (etapa === ETAPA.DISENO) return disenoCumplido(estado, ctx);
  if (lista(estado.aprobaciones).some((a) => aprobacionValida(a) && a.etapa === etapa)) return true;

  // La autonomía (la registrada o la de spike y bounded por defecto) sólo cumple desarrollo y DEV: el diseño (1)
  // pide siempre su `aprobar 1`, y 0, 3, 5, 6 y valores raros nunca.
  if (!ETAPAS_AUTONOMAS.includes(etapa)) return false;
  return autonomiaDe(estado) >= etapa;
}

/**
 * Etapa según la evidencia (diseño aprobado, tests, revisión, E2E, OK de PROD, circuito), nunca menor que la
 * registrada con rq.mjs etapa: así `etapa` es opcional y estado y SessionStart muestran dónde está el RQ.
 * plan.md no define etapa propia (el plan es parte de la 1).
 */
export function etapaDerivada(estado, raiz) {
  if (!esObjeto(estado)) return 0;
  const registrada = Number.isInteger(estado.etapa) ? estado.etapa : 0;
  if (registrada >= ETAPA.CIERRE) return registrada;
  const dir = typeof raiz === 'string' && raiz !== '' && codigoOk(estado.codigo) ? path.join(raiz, 'docs', 'rq', estado.codigo) : null;
  const existe = (f) => dir !== null && fs.existsSync(path.join(dir, f));
  const aprobada = (n) => lista(estado.aprobaciones).some((a) => aprobacionValida(a) && a.etapa === n);
  let e = 0;
  if (existe('spec.md') && aprobada(ETAPA.DISENO)) e = ETAPA.DISENO;
  if (esObjeto(estado.tests)) e = ETAPA.DESARROLLO;
  if (estado.tests?.ok === true && estado.revision?.ok === true) e = ETAPA.VERIFICACION;
  if (e === ETAPA.VERIFICACION && (estado.e2e?.ok === true || saltoValido(estado, 'e2e'))) e = ETAPA.DEV;
  if (lista(estado.aprobaciones).some((a) => a?.etapa === ETAPA.PROD) || lista(estado.circuito).length > 0) e = ETAPA.PROD;
  return Math.max(registrada, e);
}

export function saltoValido(estado, compuerta) {
  try {
    if (!esObjeto(estado)) return false;
    return lista(estado.saltos).some((s) => esObjeto(s) && s.compuerta === compuerta && fraseOk(s.frase));
  } catch {
    return false;
  }
}

/** RQ cerrados (etapa 6) con pasos pendientes: [{ codigo, pendientes }]. Sin docs/rq, []. */
export function cerradosConPendientes(raiz) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(path.join(raiz, 'docs', 'rq'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out = [];
  for (const codigo of dirs.filter(codigoOk)) {
    try {
      const e = cargarEstado(raiz, codigo);
      if (e.etapa === ETAPA.CIERRE && lista(e.pendientes).length) out.push({ codigo, pendientes: e.pendientes });
    } catch {
      // sin estado.yml legible: no cuenta
    }
  }
  return out;
}
