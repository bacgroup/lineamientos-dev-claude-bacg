// Arranque de sesión (spec §4.1): dice si es un inicio (proyecto, repos locales y externos, lo último trabajado) o una
// reanudación ("dónde nos quedamos": RQ activo, etapa, qué falta, rama y último commit). Sólo lee: no escribe nada.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buscarRepo, nombreRepo, dirLineamientos } from './config.mjs';
import { rqActivo, rqsActivos, cargarEstado, etapaDerivada } from './estado.mjs';
import { ETAPA, NOMBRE_ETAPA } from './etapas.mjs';
import { nombreDe } from './clasificacion.mjs';
import { faltaParaEtapa } from './requisitos.mjs';
import { usaOdoo } from './odoo-skills.mjs';
import { ramaActual } from './ramas.mjs';
import { leerBacklog } from './backlog.mjs';
import { reposHermanos } from './multi-repo.mjs';

const lista = (x) => (Array.isArray(x) ? x : []);
const FILAS_BACKLOG = 5;
const ENTRADAS_CHANGELOG = 3;

/**
 * Repos registrados debajo de dir (hasta dos niveles): con .bacg-lineamientos o, sin marcador, por su remoto origin
 * (proyecto.repos del proyecto registrado). Sin entrar a node_modules ni a carpetas ocultas.
 */
export function reposDebajo(dir, niveles = 2, dirLin = dirLineamientos()) {
  const out = [];
  const visitar = (d, n) => {
    let entradas;
    try {
      entradas = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const sub = path.join(d, e.name);
      const esGit = fs.existsSync(path.join(sub, '.git'));
      if (fs.existsSync(path.join(sub, '.bacg-lineamientos'))) out.push(sub);
      else if (esGit && buscarRepo(sub, { dirLin })?.raiz === path.resolve(sub)) out.push(sub);
      else if (n > 1) visitar(sub, n - 1);
    }
  };
  visitar(dir, niveles);
  return out;
}

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  return { ok: r.status === 0, out: String(r.stdout ?? '').trim() };
}

/** Modo de la sesión: reanudación si hay un RQ activo sin cerrar (etapa < 6); si no, inicio. */
export function modoArranque(raiz) {
  const codigo = rqActivo(raiz);
  if (!codigo) return { modo: 'inicio' };
  try {
    const estado = cargarEstado(raiz, codigo);
    if (etapaDerivada(estado, raiz) < ETAPA.CIERRE) return { modo: 'reanudacion', codigo };
  } catch {
    // estado ilegible: lo reportan las compuertas; el arranque lo trata como inicio
  }
  return { modo: 'inicio' };
}

/** Estado git de una carpeta: rama, commits adelante/atrás del upstream y archivos sin commitear. */
export function estadoRepo(dir) {
  const clonado = Boolean(dir) && fs.existsSync(path.join(dir, '.git'));
  if (!clonado) return { nombre: path.basename(String(dir ?? '')), rama: null, adelante: 0, atras: 0, sinCommitear: 0, clonado: false };
  const cuenta = git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  const [adelante, atras] = cuenta.ok ? cuenta.out.split(/\s+/).map(Number) : [0, 0];
  const estado = git(dir, ['status', '--porcelain']);
  return {
    nombre: nombreRepo(dir),
    rama: ramaActual(dir),
    adelante: adelante || 0,
    atras: atras || 0,
    sinCommitear: estado.ok && estado.out ? estado.out.split(/\r?\n/).length : 0,
    clonado: true,
  };
}

/**
 * Lo último trabajado: 5 filas del backlog y las 3 primeras entradas del CHANGELOG.md del repo.
 * El backlog no tiene columna de fecha (la fila nueva se agrega al final y se actualiza en su lugar): "más reciente"
 * es el orden del archivo, de abajo hacia arriba; `fecha` es la primera fecha AAAA-MM-DD que traiga la fila, si hay.
 */
export function ultimoTrabajado(raiz, proyecto, dirLin) {
  let filas = [];
  try {
    filas = leerBacklog(dirLin, proyecto?.id, raiz);
  } catch {
    // sin backlog legible
  }
  const backlog = filas
    .slice(-FILAS_BACKLOG)
    .reverse()
    .map((f) => ({
      codigo: f['Código'] ?? '',
      estado: f.Estado ?? '',
      fecha: Object.values(f).join(' ').match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
    }));
  let changelog = [];
  try {
    changelog = fs.readFileSync(path.join(raiz, 'CHANGELOG.md'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^##\s+\S/.test(l))
      .slice(0, ENTRADAS_CHANGELOG)
      .map((l) => l.replace(/^##\s+/, '').trim());
  } catch {
    // sin changelog
  }
  return { backlog, changelog };
}

function lineaRepo(e, etiqueta = e.nombre) {
  if (!e.clonado) return `- ${etiqueta}: no clonado`;
  const partes = [`rama ${e.rama ?? '(detached)'}`];
  if (e.adelante) partes.push(`${e.adelante} adelante`);
  if (e.atras) partes.push(`${e.atras} atrás`);
  partes.push(e.sinCommitear ? `${e.sinCommitear} sin commitear` : 'limpio');
  return `- ${etiqueta}: ${partes.join(', ')}`;
}

function textoPadre(raiz, dirLin) {
  const repos = reposDebajo(raiz, 2, dirLin);
  const lineas = ['# Arranque: carpeta con varios repos', 'Repos registrados debajo de esta carpeta:'];
  if (repos.length === 0) lineas.push('(ninguno)');
  for (const d of repos) lineas.push(lineaRepo(estadoRepo(d), path.relative(raiz, d)));
  return lineas.join('\n');
}

function reanudacion(raiz, proyecto, codigo) {
  const estado = cargarEstado(raiz, codigo);
  const etapa = etapaDerivada(estado, raiz);
  const lineas = ['# Arranque: reanudación. Dónde nos quedamos'];
  lineas.push(`RQ ${codigo} (${estado.tipo ?? '?'}), ${nombreDe(estado.clasificacion)}, etapa ${etapa}: ${NOMBRE_ETAPA[etapa] ?? '?'}.`);
  const otros = rqsActivos(raiz).filter((c) => c !== codigo);
  if (otros.length) lineas.push(`Otros RQ abiertos: ${otros.join(', ')}.`);
  const siguiente = etapa + 1;
  if (siguiente <= ETAPA.CIERRE) {
    let falta = [];
    try {
      falta = faltaParaEtapa(estado, siguiente, raiz, proyecto ?? undefined);
    } catch {
      // proyecto ilegible: sin detalle de faltantes
    }
    lineas.push(falta.length ? `Falta para la etapa ${siguiente} (${NOMBRE_ETAPA[siguiente]}): ${falta.join('; ')}.` : `Nada pendiente para pasar a la etapa ${siguiente} (${NOMBRE_ETAPA[siguiente]}).`);
  }
  const e = estadoRepo(raiz);
  const ultimo = git(raiz, ['log', '-1', '--format=%h %s']);
  lineas.push(`Rama ${e.rama ?? '(detached)'}${ultimo.ok && ultimo.out ? `, último commit: ${ultimo.out}` : ''}.`);
  if (e.sinCommitear) lineas.push(`Cambios sin commitear: ${e.sinCommitear} archivo(s).`);
  const hermanos = reposHermanos(raiz, proyecto?.id, proyecto);
  lineas.push('Repos:', lineaRepo(e), ...hermanos.map((h) => lineaRepo(estadoRepo(h))));
  return lineas.join('\n');
}

function inicio(raiz, proyecto, dirLin) {
  const lineas = [`# Arranque: inicio. Proyecto ${proyecto?.nombre ?? proyecto?.id ?? '?'}`];
  if (usaOdoo(proyecto, raiz)) lineas.push('El proyecto trabaja con Odoo.');
  const propio = estadoRepo(raiz);
  const hermanos = new Map(reposHermanos(raiz, proyecto?.id, proyecto).map((r) => [nombreRepo(r).toLowerCase(), r]));
  const externos = lista(proyecto?.repos)
    .map((r) => r?.nombre)
    .filter((n) => typeof n === 'string' && n.toLowerCase() !== propio.nombre.toLowerCase());
  lineas.push('Repos:', lineaRepo(propio, `${propio.nombre} (este)`));
  for (const n of externos) lineas.push(hermanos.has(n.toLowerCase()) ? lineaRepo(estadoRepo(hermanos.get(n.toLowerCase())), n) : `- ${n}: no clonado`);
  const u = ultimoTrabajado(raiz, proyecto, dirLin);
  lineas.push('Lo último trabajado:');
  if (u.backlog.length === 0 && u.changelog.length === 0) lineas.push('- (sin backlog ni changelog)');
  for (const f of u.backlog) lineas.push(`- backlog ${f.codigo}: ${f.estado}${f.fecha ? ` (${f.fecha})` : ''}`);
  for (const c of u.changelog) lineas.push(`- changelog ${c}`);
  const abiertos = rqsActivos(raiz);
  if (abiertos.length) lineas.push(`RQ abiertos: ${abiertos.join(', ')}.`);
  return lineas.join('\n');
}

/** Texto del arranque (inicio o reanudación) para la raíz de un repo o una carpeta padre. No escribe nada. */
export function textoArranque({ raiz, proyecto, dirLin = dirLineamientos() }) {
  if (!buscarRepo(raiz, { dirLin })) return textoPadre(raiz, dirLin);
  const m = modoArranque(raiz);
  return m.modo === 'reanudacion' ? reanudacion(raiz, proyecto, m.codigo) : inicio(raiz, proyecto, dirLin);
}
