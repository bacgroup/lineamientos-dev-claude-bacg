import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from '../vendor/js-yaml.mjs';
import { fraseDelUsuario } from './transcript.mjs';

const RE_CODIGO = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ETAPAS_AUTONOMAS = [1, 2, 3, 5];
// Clasificaciones con autonomía hasta DEV (etapa 5) por defecto: el agente decide, lo anota y sigue.
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
  return estado;
}

// Muta el objeto recibido: le setea `actualizado` antes de escribirlo.
export function guardarEstado(raiz, estado) {
  const dir = carpetaRq(raiz, estado?.codigo);
  estado.actualizado = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'estado.yml'), yaml.dump(estado, { lineWidth: -1 }));
}

/** Versión de estado.yml en `ref` (HEAD por defecto), o null si no está commiteada / no hay ref / no parsea / no es un objeto. */
export function estadoCommiteado(raiz, codigo, ref = 'HEAD') {
  if (!codigoOk(codigo)) return null;
  try {
    const out = execFileSync('git', ['show', `${ref}:docs/rq/${codigo}/estado.yml`], {
      cwd: raiz,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const o = yaml.load(out);
    return esObjeto(o) ? o : null;
  } catch {
    return null;
  }
}

// Las frases se validan al registrarlas: la compuerta de Bash niega `rq.mjs aprobar|autonomia|saltar` si la frase
// no es texto literal del usuario. Lo que quedó en estado.yml vale para todo el RQ (otra sesión, subagentes),
// salvo el OK de PROD (etapa 6): ése se vuelve a comprobar al usarlo contra los mensajes del usuario de la sesión
// (ctx.textosUsuario), para que un registro hecho por fuera de la compuerta no alcance para publicar.
const fraseOk = (f) => typeof f === 'string' && f.trim() !== '';

export function aprobacionValida(aprob) {
  return esObjeto(aprob) && Number.isInteger(aprob.etapa) && fraseOk(aprob.frase);
}

/** Autonomía del RQ: la registrada o, en spike y bounded, hasta la etapa 5 por defecto. */
export function autonomiaDe(estado) {
  const aut = estado?.autonomia;
  if (esObjeto(aut) && Number.isInteger(aut.hasta) && fraseOk(aut.frase)) return aut.hasta;
  return AUTONOMIA_POR_DEFECTO.includes(estado?.clasificacion) ? 5 : 0;
}

export function etapaCumplida(estado, etapa, ctx) {
  try {
    return calcularEtapa(estado, etapa, esObjeto(ctx) ? ctx : {});
  } catch {
    return false;
  }
}

function calcularEtapa(estado, etapa, ctx) {
  if (!esObjeto(estado)) return false;
  // Etapa 4: sólo evidencia, sin aprobación humana ni autonomía.
  if (etapa === 4) return estado.tests?.ok === true && estado.revision?.ok === true;

  if (etapa === 6) {
    const textos = Array.isArray(ctx.textosUsuario) ? ctx.textosUsuario : [];
    return lista(estado.aprobaciones).some(
      (a) => aprobacionValida(a) && a.etapa === 6 && fraseDelUsuario(a.frase, textos),
    );
  }
  if (lista(estado.aprobaciones).some((a) => aprobacionValida(a) && a.etapa === etapa)) return true;

  // La autonomía sólo satisface las etapas de la lista (nunca 0, 4, 6, 7 ni valores raros).
  if (!ETAPAS_AUTONOMAS.includes(etapa)) return false;
  if (etapa === 2 && AUTONOMIA_POR_DEFECTO.includes(estado.clasificacion) && calcularEtapa(estado, 1, ctx)) return true;
  // En spike y bounded, el diseño (OK o spec.md) cubre también el plan, el desarrollo y DEV.
  if ((etapa === 3 || etapa === 5) && AUTONOMIA_POR_DEFECTO.includes(estado.clasificacion) && calcularEtapa(estado, 1, ctx)) return true;

  if (!(autonomiaDe(estado) >= etapa)) return false;
  if (etapa === 3 || etapa === 5) return true;
  if (!codigoOk(estado.codigo) || typeof ctx.raiz !== 'string' || ctx.raiz === '') return false;
  const dir = path.join(ctx.raiz, 'docs', 'rq', estado.codigo);
  return fs.existsSync(path.join(dir, etapa === 1 ? 'spec.md' : 'plan.md'));
}

/**
 * Etapa según la evidencia (spec.md, plan.md, tests, revisión, E2E, OK de PROD, circuito), nunca menor que la
 * registrada con rq.mjs etapa: así `etapa` es opcional y estado y SessionStart muestran dónde está el RQ.
 */
export function etapaDerivada(estado, raiz) {
  if (!esObjeto(estado)) return 0;
  const registrada = Number.isInteger(estado.etapa) ? estado.etapa : 0;
  if (registrada >= 7) return registrada;
  const dir = typeof raiz === 'string' && raiz !== '' && codigoOk(estado.codigo) ? path.join(raiz, 'docs', 'rq', estado.codigo) : null;
  const existe = (f) => dir !== null && fs.existsSync(path.join(dir, f));
  let e = 0;
  if (existe('spec.md')) e = 1;
  if (existe('plan.md')) e = 2;
  if (esObjeto(estado.tests)) e = 3;
  if (estado.tests?.ok === true && estado.revision?.ok === true) e = 4;
  if (e === 4 && (estado.e2e?.ok === true || saltoValido(estado, 'e2e'))) e = 5;
  if (lista(estado.aprobaciones).some((a) => a?.etapa === 6) || lista(estado.circuito).length > 0) e = 6;
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

/** RQ cerrados (etapa 7) con pasos pendientes: [{ codigo, pendientes }]. Sin docs/rq, []. */
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
      if (e.etapa === 7 && lista(e.pendientes).length) out.push({ codigo, pendientes: e.pendientes });
    } catch {
      // sin estado.yml legible: no cuenta
    }
  }
  return out;
}
