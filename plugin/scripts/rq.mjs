// CLI del agente para estado.yml de los RQ activos. Uso: node rq.mjs <subcomando> [args] [--rq <código>].
// Es la única vía por la que el agente escribe docs/rq/<código>/estado.yml. También lleva la fila del RQ en
// el backlog y, al cerrar, el changelog, el log del proyecto (docs/log/rq.jsonl) y el commit de docs.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { buscarRepo, cargarProyecto, carpetaProyecto, dirLineamientos, nombreRepo, CARPETA_REPO } from './lib/config.mjs';
import { rqsActivos, rqActivo, guardarActivos, cargarEstado, guardarEstado, estadoCommiteado, etapaDerivada, saltoValido, cerradosConPendientes } from './lib/estado.mjs';
import { comandosTests, comandoE2e, PISTA_SIN_TESTS, rojosConocidos, fallosDe, soloRojosConocidos, conArchivos, cola, conSpecs, shellDeTests } from './lib/cli.mjs';
import { faltaParaEtapa, sensibleSinRevisar, skillsDe } from './lib/requisitos.mjs';
import { SIN_BASE, baseDeUpstream, commitHead, pasoObligatorio, rutaQueImpide, rutasDesde, refPrincipal, nombraCodigo } from './lib/no-aplica.mjs';
import { pasosCircuito, rutasDelRq, pendientes, corresponde, esManual, faltaAntes, migracionesEnSync, RAMA_SYNC } from './lib/circuito.mjs';
import { upsertFila, rutaBacklog, leerBacklog } from './lib/backlog.mjs';
import { tipoArchivo } from './lib/rutas.mjs';
import { baseDelRepo, esMigracion, motorDatos } from './lib/stack.mjs';
import { seccionAgents, escribirAgents } from './lib/agents.mjs';
import { commitsAuditables, cerrarAuditoria, RUTA_MARCA } from './lib/auditoria.mjs';

const TIPOS = ['rq', 'bug', 'fix']; // fix: nombre anterior de bug
const CLASIFICACIONES = ['spike', 'bounded', 'arquitectonico'];
// skills: las de proceso por etapa (requisitos.mjs); seguridad: claude-security en rutas sensibles.
// ui: omite el refuerzo de UI del plugin (diseno-frontend, redesign y ## Diseño) en un cambio menor; el canon sigue.
const COMPUERTAS = ['edicion', 'commit', 'push', 'e2e', 'skills', 'seguridad', 'ui'];
const RE_CODIGO = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const USO = `Uso: node rq.mjs <subcomando> [args] [--rq <código>]   (--rq elige entre varios RQ activos; sin --rq, el más reciente)
  abrir <código> --tipo rq|bug --clasificacion spike|bounded|arquitectonico [--tarea "<texto>"] [--prioridad <p>] [--impacto <i>]
  etapa <n>                          (0-7; opcional: estado deriva la etapa de la evidencia)
  aprobar <etapa> "<frase>"          (etapa 0-7; la frase es texto literal del usuario)
  autonomia <hasta> "<frase>"        (hasta 1-5)
  saltar <compuerta> "<frase>" "<motivo>"   (compuerta: edicion|commit|push|e2e|skills|seguridad)
  commit "<mensaje>" <rutas>…        (git add de las rutas, tests relacionados, registro y commit en un paso)
  registrar-tests                    (tests de commit sobre lo que está en stage; sin E2E)
  verificar [--completo] [<specs>…]  (E2E contra la app levantada; con {specs} en tests.e2e, sólo los del RQ salvo --completo)
  revision ok|bloqueante "<nota>"
  paso manual:<texto>|sync-lineamientos   (pasos manuales de circuito_prod)
  paso hecho <paso> "<evidencia>"    (paso hecho por fuera: merge desde GitHub, migración que ya estaba aplicada)
  paso no-aplica <paso> "<motivo>"   (paso que no corresponde y no se deduce solo del diff)
  paso reabrir <paso>                (quita la marca de no aplica)
  desplegar [<handoff.md>]           (plan de despliegue: pasos que faltan, en orden, con su comando)
  entregar                           (rama, PR, CI y plan de despliegue: qué falta para terminar)
  agents                             (escribe en AGENTS.md la sección de lineamientos generada desde .como-trabajo/)
  auditar [--cerrar "<nota>"]        (commits de Lovable sin revisar; --cerrar mueve la marca y lo anota en docs/log/rq.jsonl)
  estado                             (avisa si la rama está atrasada o si el RQ ya figura cerrado en origin/main)
  cerrar [--resumen "<1-2 frases>"] [--alcance "<texto>"] [--sin-changelog]   (con --resumen: changelog, docs/log/rq.jsonl y commit de docs; --sin-changelog: sólo el log)
`;

/** Uso de un subcomando (sus líneas de USO) o, sin subcomando conocido, el uso completo. */
function usoDe(sub) {
  const [cabecera, ...lineas] = USO.trimEnd().split('\n');
  const propias = sub ? lineas.filter((l) => l.trim().startsWith(`${sub} `) || l.trim() === sub) : [];
  return propias.length ? `Uso: node rq.mjs ${propias.map((l) => l.trim()).join('\n      node rq.mjs ')}\n` : `${cabecera}\n${lineas.join('\n')}\n`;
}

class ErrorUso extends Error {}
class ErrorCli extends Error {}

const ahora = () => new Date().toISOString();
const hoy = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const entero = (s) => (typeof s === 'string' && /^\d+$/.test(s) ? Number(s) : null);
const lista = (x) => (Array.isArray(x) ? x : []);
const normPaso = (p) => (typeof p === 'string' ? p.trim().toLowerCase() : '');

function textoNoVacio(valor, nombre) {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ErrorCli(`${nombre} no puede estar vacío.`);
  return valor;
}

function etapaValida(s, nombre = 'etapa') {
  const n = entero(s);
  if (n === null || n > 7) throw new ErrorCli(`${nombre} inválida: "${s}" (tiene que ser un entero de 0 a 7).`);
  return n;
}

// `nombres`: opciones con valor (--x <valor>); `banderas`: opciones sin valor (--x queda en true).
function opciones(args, nombres, banderas = []) {
  const res = {};
  const posicionales = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const nombre = a.slice(2);
      if (banderas.includes(nombre)) {
        res[nombre] = true;
        continue;
      }
      if (!nombres.includes(nombre) || i + 1 >= args.length) throw new ErrorUso();
      res[nombre] = args[++i];
    } else {
      posicionales.push(a);
    }
  }
  return { res, posicionales };
}

function proyectoDe(repo, env) {
  try {
    return cargarProyecto(repo.proyectoId, dirLineamientos({ env }), repo.raiz);
  } catch {
    return null;
  }
}

/** RQ sobre el que actúa el comando: el de --rq o el activo más reciente. */
function activo(raiz, elegido) {
  const codigo = elegido ?? rqActivo(raiz);
  if (!codigo) throw new ErrorCli('No hay RQ activo: corré rq.mjs abrir <código> …');
  if (!RE_CODIGO.test(codigo)) throw new ErrorCli(`Código inválido: "${codigo}".`);
  try {
    return { codigo, estado: cargarEstado(raiz, codigo) };
  } catch (e) {
    if (String(e.message).startsWith('ESTADO_INEXISTENTE')) throw new ErrorCli(`El RQ ${codigo} no existe: abrilo con rq.mjs abrir.`);
    throw e;
  }
}

function guardar(raiz, estado) {
  guardarEstado(raiz, estado);
}

/** Rol del repo en proyecto.repos (padre, sede…), por su remoto origin; null si no figura. */
function rolDelRepo(repo, env) {
  const nombre = nombreRepo(repo.raiz).toLowerCase();
  const r = lista(proyectoDe(repo, env)?.repos).find((x) => String(x?.nombre ?? '').toLowerCase() === nombre);
  return typeof r?.rol === 'string' ? r.rol : null;
}

const esSede = (repo, env) => rolDelRepo(repo, env) === 'sede';

function anotarBacklog(repo, env, codigo, campos, io) {
  // Una sede trabaja RQ espejo del padre: el backlog del proyecto vive en el padre.
  if (esSede(repo, env)) {
    io.stdout.write('Backlog: sin cambios (sede; el backlog vive en el repo padre).\n');
    return;
  }
  try {
    const dirLin = dirLineamientos({ env });
    const r = upsertFila(dirLin, repo.proyectoId, codigo, campos, repo.raiz);
    const fuente = rutaBacklog(dirLin, repo.proyectoId, repo.raiz);
    const copia = path.join(repo.raiz, 'docs', 'backlog.md');
    if (path.resolve(fuente) === path.resolve(copia)) {
      io.stdout.write(`Backlog: fila ${codigo} ${r} (docs/backlog.md).\n`);
      return;
    }
    // Copia en el repo (docs/backlog.md): la fuente es la de lineamientos y la copia se pisa entera.
    fs.mkdirSync(path.dirname(copia), { recursive: true });
    fs.copyFileSync(fuente, copia);
    io.stdout.write(`Backlog: fila ${codigo} ${r} (lineamientos y docs/backlog.md).\n`);
  } catch (e) {
    io.stderr.write(`Aviso: no pude actualizar el backlog (${e.message}).\n`);
  }
}

function abrir(repo, args, env, io) {
  const raiz = repo.raiz;
  const { res, posicionales } = opciones(args, ['tipo', 'clasificacion', 'tarea', 'prioridad', 'impacto']);
  if (posicionales.length !== 1 || !res.tipo || !res.clasificacion) throw new ErrorUso();
  const [codigo] = posicionales;
  if (!RE_CODIGO.test(codigo)) throw new ErrorCli(`Código inválido: "${codigo}" (letras, números, "_" y "-"; empieza con letra o número).`);
  if (!TIPOS.includes(res.tipo)) throw new ErrorCli(`--tipo inválido: "${res.tipo}" (rq | bug).`);
  if (!CLASIFICACIONES.includes(res.clasificacion)) {
    throw new ErrorCli(`--clasificacion inválida: "${res.clasificacion}" (spike | bounded | arquitectonico).`);
  }
  const dir = path.join(raiz, 'docs', 'rq', codigo);
  let existente = null;
  try {
    existente = cargarEstado(raiz, codigo);
  } catch (e) {
    if (!String(e.message).startsWith('ESTADO_INEXISTENTE')) throw e;
  }
  if (!existente) {
    guardarEstado(raiz, {
      codigo,
      tipo: res.tipo,
      clasificacion: res.clasificacion,
      ...(res.tarea ? { tarea: res.tarea } : {}),
      etapa: 0,
      autonomia: null,
      aprobaciones: [],
      tests: null,
      revision: null,
      circuito: [],
      saltos: [],
      base: commitHead(raiz),
    });
  }
  fs.mkdirSync(dir, { recursive: true });
  const otros = rqsActivos(raiz).filter((c) => c !== codigo);
  guardarActivos(raiz, [...otros, codigo]);
  io.stdout.write(existente ? `RQ ${codigo} retomado (etapa ${existente.etapa}).\n` : `RQ ${codigo} abierto.\n`);
  if (otros.length) io.stdout.write(`Otros RQ activos: ${otros.join(', ')} (usá --rq para elegir).\n`);
  anotarBacklog(repo, env, codigo, {
    Tarea: res.tarea,
    Prioridad: res.prioridad,
    Impacto: res.impacto,
    Estado: 'En curso',
    Link: `docs/rq/${codigo}/`,
  }, io);
}

function cambiar(raiz, elegido, io, fn) {
  const { estado } = activo(raiz, elegido);
  const msg = fn(estado);
  guardar(raiz, estado);
  io.stdout.write(`${msg}\n`);
}

/** Archivos en stage, relativos a la raíz, que no son libres (los que tienen tests relacionados). */
function enStageDeProducto(raiz, proyecto) {
  let out;
  try {
    out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=d', '-z', '--relative'], {
      cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  return out.split('\0').filter(Boolean).filter((r) => tipoArchivo(r, proyecto) !== 'libre');
}

const arbolEnStage = (raiz) => {
  try {
    return execFileSync('git', ['write-tree'], { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new ErrorCli(`No pude calcular el árbol (git write-tree): ${String(e.stderr || e.message).trim()}`);
  }
};

/** ¿Hay cambios sin stagear en archivos trackeados? */
function hayCambiosSinStage(raiz) {
  const r = spawnSync('git', ['diff', '--quiet'], { cwd: raiz, encoding: 'utf8' });
  if (r.status === 0) return false;
  if (r.status === 1) return true;
  throw new ErrorCli(`git diff falló: ${String(r.stderr || r.error?.message).trim()}`);
}

/** BUG sin causa o sin systematic-debugging (y RQ arquitectónico sin writing-plans): no se commitea código. */
function exigirEtapa3(estado, raiz) {
  const falta = faltaParaEtapa(estado, 3, raiz);
  if (falta.length) throw new ErrorCli(`Antes de commitear código del ${estado.codigo} falta: ${falta.join('; ')}. Si el usuario decide saltearlo: $RQ saltar skills "<frase>" "<motivo>".`);
}

/**
 * Corre los tests de commit sobre lo que está en stage y los registra en estado.tests. Si todo sale bien imprime una
 * línea; si falla, la cola de la salida. No guarda el estado (lo guarda quien llama). Devuelve el código de salida.
 */
function correrTests(raiz, estado, proyecto, io, { silencioso = false } = {}) {
  const comandos = comandosTests(proyecto);
  if (comandos.length === 0) {
    throw new ErrorCli(`El proyecto no declara comandos de tests en proyecto.yml. ${PISTA_SIN_TESTS}`);
  }
  const arbol = arbolEnStage(raiz);
  const archivos = enStageDeProducto(raiz, proyecto);
  const conocidos = rojosConocidos(proyecto);
  const corridos = [];
  const rojos = [];
  let codigo = 0;
  for (const base of comandos) {
    const cmd = conArchivos(base, archivos);
    if (cmd === null) continue;
    corridos.push(cmd);
    const r = spawnSync(cmd, { shell: shellDeTests(proyecto), cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) io.stderr.write(`No pude ejecutar "${cmd}": ${r.error.message}\n`);
    if (r.status === 0) continue;
    const salidaTest = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    const fallos = fallosDe(salidaTest);
    if (soloRojosConocidos(fallos, conocidos)) {
      rojos.push(...fallos);
      continue;
    }
    io.stdout.write(`${cola(salidaTest)}\n`);
    codigo = r.status ?? 1;
    break;
  }
  estado.tests = { ok: codigo === 0, arbol, fecha: ahora(), comandos: corridos };
  if (rojos.length) estado.tests.rojos_conocidos = [...new Set(rojos)];
  const extra = rojos.length ? `, ${new Set(rojos).size} rojo(s) conocido(s)` : '';
  if (silencioso && codigo === 0) return 0; // commit resume los tests en su propia línea
  if (corridos.length === 0) io.stdout.write('Sin archivos de producto en stage: no corrió ningún test.\n');
  io.stdout.write(codigo === 0 ? `Tests ok (${corridos.length} comando(s)${extra}).\n` : `Tests fallaron: ${corridos[corridos.length - 1]}\n`);
  return codigo;
}

function registrarTests(repo, elegido, env, io) {
  const raiz = repo.raiz;
  const { estado } = activo(raiz, elegido);
  const proyecto = proyectoDe(repo, env);
  if (comandosTests(proyecto).length === 0) {
    throw new ErrorCli(`El proyecto no declara comandos de tests en proyecto.yml. ${PISTA_SIN_TESTS}`);
  }
  if (hayCambiosSinStage(raiz)) {
    throw new ErrorCli('Hay cambios sin stagear en archivos trackeados: usá $RQ commit "<mensaje>" <rutas> (los deja aparte mientras corren los tests) o hacé git add antes.');
  }
  if (enStageDeProducto(raiz, proyecto).length) exigirEtapa3(estado, raiz);
  const r = correrTests(raiz, estado, proyecto, io);
  guardar(raiz, estado);
  return r;
}

/** Mensaje con el código: `tipo: x` pasa a `tipo(<código>): x`; si no nombra el código ni tiene tipo, `<código>: x`. */
function conCodigo(mensaje, codigo) {
  if (nombraCodigo(codigo, mensaje)) return mensaje;
  const m = /^([a-z]+)(?:\([^)]*\))?(!?):\s*/.exec(mensaje);
  return m ? `${m[1]}(${codigo})${m[2]}: ${mensaje.slice(m[0].length)}` : `${codigo}: ${mensaje}`;
}

// Un RQ abierto sólo para tener la fila en el backlog guarda una base vieja: al empezar el trabajo (primer commit o
// paso de etapa desde 0) sin commits propios, la base pasa a HEAD para que el diff del RQ no traiga commits ajenos.
function rebasarSiNoEmpezo(raiz, codigo, estado) {
  if (etapaDerivada(estado, raiz) > 2 || commitsDelRq(raiz, codigo, estado).length > 0) return;
  const head = commitHead(raiz);
  if (head && head !== estado.base) estado.base = head;
}

/**
 * git add de las rutas, tests relacionados sobre lo que queda en stage (los cambios sin stagear se guardan aparte con
 * git stash mientras corren), registro y commit, todo en un paso. Docs y tests solos no corren tests.
 */
function commit(repo, elegido, args, env, io) {
  const raiz = repo.raiz;
  const [mensaje, ...rutas] = args;
  textoNoVacio(mensaje, 'El mensaje');
  if (rutas.length === 0) throw new ErrorUso();
  const { codigo, estado } = activo(raiz, elegido);
  const proyecto = proyectoDe(repo, env);
  const add = spawnSync('git', ['add', '-A', '--', ...rutas], { cwd: raiz, encoding: 'utf8' });
  if (add.status !== 0) throw new ErrorCli(`git add falló: ${String(add.stderr).trim()}`);
  rebasarSiNoEmpezo(raiz, codigo, estado);
  const producto = enStageDeProducto(raiz, proyecto);
  let tests = 'sólo docs y tests: sin correr tests';
  if (producto.length && saltoValido(estado, 'commit')) tests = 'tests salteados (saltar commit)';
  else if (producto.length) {
    exigirEtapa3(estado, raiz);
    const aparte = hayCambiosSinStage(raiz);
    if (aparte) {
      const st = spawnSync('git', ['stash', 'push', '-q', '--keep-index', '-m', `rq.mjs commit ${codigo}`], { cwd: raiz, encoding: 'utf8' });
      if (st.status !== 0) throw new ErrorCli(`No pude guardar aparte los cambios sin stagear (git stash): ${String(st.stderr).trim()}`);
    }
    let r;
    try {
      r = correrTests(raiz, estado, proyecto, io, { silencioso: true });
    } finally {
      if (aparte) {
        const pop = spawnSync('git', ['stash', 'pop', '-q', '--index'], { cwd: raiz, encoding: 'utf8' });
        if (pop.status !== 0) io.stderr.write(`Aviso: los cambios sin stagear quedaron en git stash (git stash pop): ${String(pop.stderr).trim()}\n`);
      }
    }
    if (r !== 0) {
      guardar(raiz, estado);
      return r;
    }
    tests = `tests ok (${estado.tests.comandos.length} comando(s))`;
  }
  guardar(raiz, estado);
  const propios = [`docs/rq/${codigo}/estado.yml`, 'docs/rq/ACTIVO'].filter((p) => fs.existsSync(path.join(raiz, p)));
  spawnSync('git', ['add', '--', ...propios], { cwd: raiz });
  const msg = conCodigo(mensaje, codigo);
  const c = spawnSync('git', ['commit', '-q', '-m', msg], { cwd: raiz, encoding: 'utf8' });
  if (c.status !== 0) throw new ErrorCli(`git commit falló: ${String(c.stderr || c.stdout).trim()}`);
  const hash = salida(raiz, ['rev-parse', '--short', 'HEAD']);
  io.stdout.write(`Commit ${hash} ${msg.split('\n')[0]} · ${tests}.\n`);
  return 0;
}

/** Specs E2E que toca el RQ (e2e/** o *.spec.* en su diff) y siguen existiendo. */
function specsDelRq(raiz, estado) {
  const esSpec = (r) => r.startsWith('e2e/') || /\.spec\.[cm]?[jt]sx?$/.test(r);
  return (rutasDelRq(raiz, estado) ?? []).filter((r) => esSpec(r) && fs.existsSync(path.join(raiz, r)));
}

/**
 * Corre tests.e2e del proyecto y registra el resultado contra HEAD. Si el comando trae {specs}, corre los specs dados
 * o los del RQ; --completo (o ningún spec) corre la suite entera, que es la que exige publicar en PROD.
 */
function verificar(repo, elegido, args, env, io) {
  const raiz = repo.raiz;
  const { res, posicionales } = opciones(args, [], ['completo']);
  const { codigo: rq, estado } = activo(raiz, elegido);
  const proyecto = proyectoDe(repo, env);
  const base = comandoE2e(proyecto);
  if (!base) {
    throw new ErrorCli(
      'El proyecto no declara tests.e2e en proyecto.yml. Declaralo (y tests.e2e_url) o, si el cambio no tiene superficie de app, que el usuario lo diga y registrá saltar e2e.',
    );
  }
  const specs = res.completo || !base.includes('{specs}') ? [] : posicionales.length ? posicionales : specsDelRq(raiz, estado);
  let cmd;
  try {
    cmd = conSpecs(base, specs);
  } catch (e) {
    throw new ErrorCli(e.message);
  }
  const completo = specs.length === 0;
  const url = proyecto?.tests?.e2e_url;
  const r = spawnSync(cmd, {
    shell: shellDeTests(proyecto), cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: url ? { ...process.env, ...env, E2E_URL: String(url), BASE_URL: String(url) } : { ...process.env, ...env },
  });
  if (r.error) io.stderr.write(`No pude ejecutar "${cmd}": ${r.error.message}\n`);
  const ok = r.status === 0;
  if (!ok) io.stdout.write(`${cola(`${r.stdout ?? ''}\n${r.stderr ?? ''}`, 80)}\n`);
  estado.e2e = { ok, fecha: ahora(), comando: cmd, head: commitHead(raiz), completo };
  guardar(raiz, estado);
  const alcance = completo ? 'suite completa' : `${specs.length} spec(s) del RQ; antes de PROD: $RQ verificar --completo`;
  io.stdout.write(`E2E de ${rq} ${ok ? 'ok' : 'falló'} (${alcance}${url ? `, app ${url}` : ''}).\n`);
  return ok ? 0 : (r.status ?? 1);
}

function salida(raiz, args) {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const gitOk = (raiz, args) => spawnSync('git', args, { cwd: raiz, stdio: 'ignore' }).status === 0;


/** Commits que `ref` tiene y HEAD no (según el último fetch). */
const detrasDe = (raiz, ref) => Number(salida(raiz, ['rev-list', '--count', `HEAD..${ref}`]) ?? 0);

// Un worktree atrasado lee su docs/rq/ACTIVO y su estado.yml viejos (pasó con R-VTA-FUT2: 175 commits atrás,
// mostraba etapa 6 de un RQ que en main ya estaba cerrado). Avisos para estado y entregar.
function avisosDeAtraso(raiz, codigo, estado) {
  const avisos = [];
  const principal = refPrincipal(raiz);
  for (const ref of new Set([salida(raiz, ['rev-parse', '--abbrev-ref', '@{u}']), principal].filter(Boolean))) {
    const n = detrasDe(raiz, ref);
    if (n > 0) avisos.push(`Aviso: la rama está ${n} commit(s) detrás de ${ref} (según el último fetch): actualizala (git merge ${ref}) antes de seguir; lo que se lee acá puede estar viejo.`);
  }
  const remoto = principal ? estadoCommiteado(raiz, codigo, principal) : null;
  if (remoto?.etapa === 7 && estado?.etapa !== 7) {
    avisos.push(`Aviso: en ${principal} el RQ ${codigo} figura cerrado (etapa 7). Este docs/rq/ACTIVO es local: actualizá la rama antes de seguir.`);
  }
  return avisos;
}

/** Proyecto del repo o ErrorCli con dónde se buscó y, si la rama principal sí tiene la configuración, que la rama está atrasada. */
function exigirProyecto(repo, env) {
  const dirLin = dirLineamientos({ env });
  const archivo = path.join(carpetaProyecto(repo.proyectoId, dirLin, repo.raiz), 'proyecto.yml');
  try {
    return cargarProyecto(repo.proyectoId, dirLin, repo.raiz);
  } catch (e) {
    if (fs.existsSync(archivo)) throw new ErrorCli(`No pude leer ${archivo}: ${e.message}`);
  }
  const l = [`El proyecto ${repo.proyectoId} no tiene proyecto.yml en este checkout (${CARPETA_REPO}/proyecto.yml) ni en ${path.join(dirLin, 'proyectos', repo.proyectoId)}.`];
  const principal = refPrincipal(repo.raiz);
  if (principal && gitOk(repo.raiz, ['cat-file', '-e', `${principal}:${CARPETA_REPO}/proyecto.yml`])) {
    l.push(`${principal} sí tiene ${CARPETA_REPO}/proyecto.yml: la rama está ${detrasDe(repo.raiz, principal)} commit(s) atrás; actualizala (git merge ${principal}).`);
  }
  throw new ErrorCli(l.join(' '));
}

/** Qué falta para terminar el RQ: rama y upstream, PR y CI, evidencia y plan de PROD. */
function entregar(repo, elegido, env, io) {
  const raiz = repo.raiz;
  const { codigo, estado } = activo(raiz, elegido);
  const l = [`Entrega de ${codigo}`, ...avisosDeAtraso(raiz, codigo, estado)];
  const rama = salida(raiz, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '?';
  const cuenta = salida(raiz, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
  if (cuenta === null) l.push(`Rama: ${rama}, sin upstream (git push -u origin ${rama}).`);
  else {
    const [atras, adelante] = cuenta.split(/\s+/).map(Number);
    l.push(`Rama: ${rama}, ${adelante} commit(s) sin pushear, ${atras} detrás del upstream.`);
  }
  const t = estado.tests;
  l.push(`Tests de commit: ${t ? (t.ok ? 'ok' : 'fallaron') : 'sin registrar'}.`);
  const e = estado.e2e;
  const saltoE2e = lista(estado.saltos).some((s) => s?.compuerta === 'e2e');
  const parcial = e?.ok && e.completo === false ? ' (sólo specs del RQ: antes de PROD, $RQ verificar --completo)' : '';
  l.push(`E2E: ${e ? (e.ok ? `ok${parcial}` : 'falló') : saltoE2e ? 'salteado por el usuario' : 'sin correr ($RQ verificar)'}.`);
  const falta6 = faltaParaEtapa(estado, 6, raiz);
  if (falta6.length) l.push(`Falta para PROD: ${falta6.join('; ')}.`);
  const rv = estado.revision;
  l.push(`Revisión: ${rv ? (rv.ok ? 'ok' : 'bloqueante') : 'sin registrar'}.`);
  // Commits ya integrados en la rama principal (merge hecho, o commiteados directo en main): no hay PR que abrir.
  const principal = refPrincipal(raiz);
  if (principal && gitOk(raiz, ['merge-base', '--is-ancestor', 'HEAD', principal])) {
    l.push(`Rama integrada: HEAD ya está en ${principal} (merge-base --is-ancestor); no hace falta PR.`);
  } else if (env.COMO_TRABAJO_SIN_GH === '1') {
    l.push('PR y CI: sin consultar (COMO_TRABAJO_SIN_GH).');
  } else {
    const r = spawnSync('gh', ['pr', 'view', '--json', 'number,state,url,statusCheckRollup'], { cwd: raiz, encoding: 'utf8' });
    if (r.status !== 0) l.push(`PR: no hay PR de esta rama (gh pr create --fill).`);
    else {
      try {
        const pr = JSON.parse(r.stdout);
        const checks = lista(pr.statusCheckRollup);
        const de = (f) => checks.filter(f).length;
        const fallados = de((c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'].includes(c.conclusion ?? c.state));
        const pendientesCi = de((c) => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING');
        l.push(`PR #${pr.number} (${pr.state}): ${pr.url}`);
        l.push(
          checks.length === 0
            ? 'CI: sin checks.'
            : `CI: ${checks.length - fallados - pendientesCi} ok, ${fallados} fallados, ${pendientesCi} en curso${pendientesCi ? ' (gh pr checks --watch en segundo plano)' : ''}.`,
        );
      } catch {
        l.push('PR: no pude leer la respuesta de gh.');
      }
    }
  }
  io.stdout.write(`${l.join('\n')}\n\n`);
  desplegar(repo, elegido, [], env, io);
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Commits del RQ: los de base..HEAD (sin base, los últimos 500 de HEAD) que nombran el código en el mensaje, sin
 * merges. Después de actualizar la rama con main, base..HEAD también trae commits ajenos.
 */
function commitsDelRq(raiz, codigo, estado) {
  const base = typeof estado.base === 'string' && estado.base ? estado.base : null;
  const out = salida(raiz, ['log', '--no-merges', '--format=%h%x1f%B%x1e', ...(base ? [`${base}..HEAD`] : ['-n', '500', 'HEAD'])]);
  return (out ?? '').split('\x1e').map((s) => s.trim().split('\x1f')).filter(([h, cuerpo]) => h && nombraCodigo(codigo, cuerpo)).map(([h]) => h);
}

/** Directorios de producto que tocó el RQ (dos niveles), para el "Dónde": los de sus commits o, sin ellos, el diff del RQ. */
function dondeDelRq(raiz, estado, proyecto, commits) {
  const deCommits = commits.flatMap((h) => (salida(raiz, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', h]) ?? '').split('\n'));
  const rutas = (commits.length ? deCommits : rutasDelRq(raiz, estado) ?? []).filter((r) => r && tipoArchivo(r, proyecto) !== 'libre');
  const dirs = [...new Set(rutas.map((r) => r.split('/').slice(0, 2).join('/')))];
  return dirs.length ? dirs.slice(0, 6).join(', ') + (dirs.length > 6 ? ', …' : '') : 'sin archivos de producto';
}

/** Changelog (docs/log/changelog/*.md) que ya tiene una entrada `### … · <código> · …`, o null. */
function changelogConEntrada(raiz, codigo) {
  const dir = path.join(raiz, 'docs', 'log', 'changelog');
  const re = new RegExp(`^###\\s.*·\\s*${escRe(codigo)}\\s*·`, 'm');
  let nombres = [];
  try {
    nombres = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return null;
  }
  const n = nombres.find((x) => re.test(fs.readFileSync(path.join(dir, x), 'utf8')));
  return n ? `docs/log/changelog/${n}` : null;
}

function fechaLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Changelog del mes (salvo que ya haya una entrada del código, o --sin-changelog), línea en docs/log/rq.jsonl y un
 * único commit con los docs del cierre.
 */
function registrarCierre(repo, codigo, estado, proyecto, { resumen, alcance, sinChangelog }, pend, io) {
  const raiz = repo.raiz;
  const fecha = fechaLocal();
  const titulo = estado.tarea || codigo;
  const commits = commitsDelRq(raiz, codigo, estado);
  if (commits.length === 0) io.stdout.write(`Ningún commit del RQ nombra ${codigo}: el log va sin commits.\n`);
  const donde = dondeDelRq(raiz, estado, proyecto, commits);
  const previa = sinChangelog ? null : changelogConEntrada(raiz, codigo);
  let avisoChangelog;
  if (sinChangelog) avisoChangelog = 'no se escribió (--sin-changelog)';
  else if (previa) avisoChangelog = `ya tenía una entrada de ${codigo} (${previa}): no se agrega otra`;
  else {
    const changelog = path.join(raiz, 'docs', 'log', 'changelog', `${fecha.slice(0, 7)}.md`);
    fs.mkdirSync(path.dirname(changelog), { recursive: true });
    const previo = fs.existsSync(changelog) ? fs.readFileSync(changelog, 'utf8').replace(/\s*$/, '\n\n') : `# Changelog ${fecha.slice(0, 7)}\n\n`;
    const entrada = [
      `### ${fecha} · ${codigo} · ${titulo}`,
      `- Qué cambió: ${resumen}`,
      `- Dónde: ${donde}`,
      `- Alcance: ${alcance || nombreRepo(raiz)}`,
    ].join('\n');
    fs.writeFileSync(changelog, `${previo}${entrada}\n`);
    avisoChangelog = path.relative(raiz, changelog).split(path.sep).join('/');
  }

  const log = path.join(raiz, 'docs', 'log', 'rq.jsonl');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const linea = {
    fecha, codigo, tipo: estado.tipo, titulo, resumen, repo: nombreRepo(raiz), donde,
    commits: commits.slice(0, 50), e2e: estado.e2e ? estado.e2e.ok === true : null, pendientes: pend,
  };
  fs.appendFileSync(log, `${JSON.stringify(linea)}\n`);

  // ACTIVO puede haber desaparecido (era el último RQ activo): un archivo trackeado que se borró también va al commit.
  const trackeado = (p) => spawnSync('git', ['ls-files', '--error-unmatch', '--', p], { cwd: raiz, stdio: 'ignore' }).status === 0;
  const rutas = [`docs/rq/${codigo}`, 'docs/rq/ACTIVO', 'docs/log', 'docs/backlog.md']
    .filter((p) => fs.existsSync(path.join(raiz, p)) || trackeado(p));
  const add = spawnSync('git', ['add', '-A', '--', ...rutas], { cwd: raiz, encoding: 'utf8' });
  const commit = add.status === 0
    ? spawnSync('git', ['commit', '-q', '-m', `docs(${codigo}): cierre`, '--', ...rutas], { cwd: raiz, encoding: 'utf8' })
    : add;
  io.stdout.write(`Changelog: ${avisoChangelog}. Log: docs/log/rq.jsonl.\n`);
  io.stdout.write(
    commit.status === 0
      ? `Commit de cierre: docs(${codigo}): cierre. Falta el push (sólo docs: no necesita RQ).\n`
      : `Aviso: no pude commitear los docs del cierre (${String(commit.stderr || commit.stdout).trim()}). Commitealos a mano.\n`,
  );
}

/** AGENTS.md con la sección generada desde .como-trabajo/ (para agentes sin el plugin, como Lovable). */
function agents(repo, env, io) {
  const proyecto = exigirProyecto(repo, env);
  const r = escribirAgents(repo.raiz, seccionAgents(proyecto));
  io.stdout.write(`AGENTS.md: sección de como-trabajo ${r}. Es documentación: se commitea sin RQ.\n`);
}

/** Lista los commits de Lovable sin revisar; con --cerrar mueve la marca y anota la revisión en el log. */
function auditar(repo, args, env, io) {
  const raiz = repo.raiz;
  const proyecto = proyectoDe(repo, env);
  const r = commitsAuditables(raiz, proyecto);
  if (r === null) throw new ErrorCli('No pude leer el historial con git log.');
  const { marca, commits } = r;
  if (args[0] === '--cerrar') {
    const nota = textoNoVacio(args[1], 'La nota');
    const hasta = salida(raiz, ['rev-parse', 'HEAD']);
    if (!hasta) throw new ErrorCli('No pude leer HEAD.');
    const linea = cerrarAuditoria(raiz, { hasta, nota, commits, fecha: fechaLocal() });
    fs.appendFileSync(path.join(raiz, 'docs', 'log', 'rq.jsonl'), `${JSON.stringify(linea)}\n`);
    io.stdout.write(
      `Auditoría cerrada hasta ${hasta.slice(0, 9)} (${commits.length} commit(s)). Marca: ${RUTA_MARCA.split(path.sep).join('/')}; línea en docs/log/rq.jsonl. Commitealos (son docs).\n`,
    );
    return;
  }
  const l = [marca ? `Auditoría de Lovable desde ${marca.revisado_hasta.slice(0, 9)} (${marca.fecha ?? '?'})` : 'Auditoría de Lovable sin iniciar: últimos 30 días'];
  if (commits.length === 0) {
    l.push('Nada que revisar.');
  } else {
    const de = (f) => commits.filter(f).length;
    l.push(`${commits.length} commit(s): ${de((c) => c.migraciones)} con migraciones, ${de((c) => c.sensible)} en rutas sensibles, ${de((c) => c.sinTests)} con código sin tests.`);
    l.push('');
    for (const c of commits.slice(0, 50)) {
      const marcas = [c.migraciones && 'MIGRACIÓN', c.sensible && 'SENSIBLE', c.sinTests && 'sin tests'].filter(Boolean);
      l.push(`- ${c.hash.slice(0, 9)} ${c.fecha} ${c.asunto}${marcas.length ? `  [${marcas.join(', ')}]` : ''}`);
    }
    if (commits.length > 50) l.push(`… y ${commits.length - 50} más.`);
    l.push('', 'Revisá primero los marcados. Lo que corresponda, regularizalo como RQ o BUG (abrir, tests, changelog). Después: rq.mjs auditar --cerrar "<qué se revisó y qué se abrió>".');
  }
  io.stdout.write(`${l.join('\n')}\n`);
}

function pasoOficial(repo, env, p) {
  const proyecto = proyectoDe(repo, env);
  const oficial = pasosCircuito(proyecto).map((x) => x.paso).find((x) => normPaso(x) === normPaso(p));
  if (!oficial) throw new ErrorCli(`El paso "${p}" no figura en circuito_prod del proyecto ${repo.proyectoId}.`);
  return { proyecto, oficial };
}

// Registra un paso manual del circuito de PROD (manual:<texto> o sync-lineamientos). Los sql:/push:/
// merge-prs-sync: los registra solo el hook PostToolUse cuando la operación sale bien (o `paso hecho`).
function registrarPaso(repo, elegido, paso, env, io) {
  const p = paso.trim();
  if (!esManual(p)) {
    throw new ErrorCli('Los pasos sql:/push:/merge-prs-sync: se registran solos; si los hiciste por fuera, usá paso hecho <paso> "<evidencia>".');
  }
  const { estado } = activo(repo.raiz, elegido);
  const { oficial } = pasoOficial(repo, env, p);
  const hechos = lista(estado.circuito);
  if (hechos.some((c) => normPaso(c?.paso) === normPaso(oficial))) {
    io.stdout.write(`El paso ${oficial} ya estaba registrado.\n`);
    return;
  }
  estado.circuito = [...hechos, { paso: oficial, fecha: ahora() }];
  guardar(repo.raiz, estado);
  io.stdout.write(`Paso ${oficial} registrado.\n`);
}

// Registra un paso hecho por fuera (un merge desde la web de GitHub, una migración que ya estaba aplicada),
// con la evidencia que lo muestra.
function registrarHecho(repo, elegido, paso, evidencia, env, io) {
  const p = textoNoVacio(paso, 'El paso').trim();
  textoNoVacio(evidencia, 'La evidencia');
  const { estado } = activo(repo.raiz, elegido);
  const { oficial } = pasoOficial(repo, env, p);
  const hechos = lista(estado.circuito);
  if (hechos.some((c) => normPaso(c?.paso) === normPaso(oficial) && c?.no_aplica !== true)) {
    io.stdout.write(`El paso ${oficial} ya estaba registrado.\n`);
    return;
  }
  estado.circuito = [...hechos.filter((c) => normPaso(c?.paso) !== normPaso(oficial)), { paso: oficial, fecha: ahora(), evidencia }];
  guardar(repo.raiz, estado);
  io.stdout.write(`Paso ${oficial} registrado como hecho.\n`);
}

// Marca un paso de circuito_prod que no corresponde a este RQ. Los sql:<ref> se rechazan si lo que se
// publica trae migraciones; sync-lineamientos, si trae estándares; push: y merge-prs-sync: nunca.
// Los pasos que no corresponden por el diff ya se deducen solos: esto queda para los demás casos.
function marcarNoAplica(repo, elegido, paso, motivo, env, io) {
  const p = textoNoVacio(paso, 'El paso').trim();
  if (pasoObligatorio(p)) throw new ErrorCli('Los pasos push: y merge-prs-sync: no se pueden marcar como no aplica.');
  textoNoVacio(motivo, 'El motivo');
  const { codigo, estado } = activo(repo.raiz, elegido);
  const { oficial } = pasoOficial(repo, env, p);
  const hechos = lista(estado.circuito);
  if (hechos.some((c) => normPaso(c?.paso) === normPaso(oficial))) {
    io.stdout.write(`El paso ${oficial} ya estaba registrado.\n`);
    return;
  }
  const tieneBase = typeof estado.base === 'string' && estado.base;
  // Sin base, el upstream sólo sirve antes del push: después ya tiene los commits del RQ.
  if (!tieneBase && hechos.some((c) => /^push:/i.test(String(c?.paso ?? '')))) {
    throw new ErrorCli('El RQ no tiene base y ya pusheó: el upstream ya no muestra lo que se publicó. Hacé el paso.');
  }
  const base = tieneBase ? estado.base : baseDeUpstream(repo.raiz);
  if (!base) throw new ErrorCli(`${SIN_BASE}.`);
  const { rutas, error } = rutasDesde(repo.raiz, base, codigo);
  if (error) throw new ErrorCli(`${error}.`);
  const ruta = rutaQueImpide(oficial, rutas, exigirProyecto(repo, env));
  if (ruta) throw new ErrorCli(`${oficial} no puede marcarse como no aplica: el cambio trae ${ruta}.`);
  estado.base = base;
  estado.circuito = [...hechos, { paso: oficial, fecha: ahora(), no_aplica: true, motivo }];
  guardar(repo.raiz, estado);
  io.stdout.write(`Paso ${oficial} marcado como no aplica.\n`);
}

// Quita la marca de no aplica de un paso (por ejemplo, porque al final el RQ sí necesita SQL).
function reabrirPaso(repo, elegido, paso, env, io) {
  const p = textoNoVacio(paso, 'El paso').trim();
  const { estado } = activo(repo.raiz, elegido);
  const proyecto = proyectoDe(repo, env);
  const nombre = pasosCircuito(proyecto).map((x) => x.paso).find((x) => normPaso(x) === normPaso(p)) ?? p;
  const hechos = lista(estado.circuito);
  const esMarca = (c) => c?.no_aplica === true && normPaso(c?.paso) === normPaso(p);
  if (!hechos.some(esMarca)) throw new ErrorCli(`${nombre} no figura como no aplica en este RQ.`);
  estado.circuito = hechos.filter((c) => !esMarca(c));
  guardar(repo.raiz, estado);
  io.stdout.write(`Paso ${nombre} reabierto: ya no figura como no aplica.\n`);
}

/** Bloques SQL de un handoff SEDE_DB_*.md: [{ titulo, sql }] en orden. */
export function bloquesHandoff(texto) {
  const out = [];
  let titulo = '';
  let dentro = false;
  let buf = [];
  for (const l of String(texto).split(/\r?\n/)) {
    if (!dentro && /^#{2,3}\s+/.test(l)) titulo = l.replace(/^#+\s+/, '').trim();
    else if (!dentro && /^```sql\s*$/i.test(l.trim())) {
      dentro = true;
      buf = [];
    } else if (dentro && /^```\s*$/.test(l.trim())) {
      dentro = false;
      out.push({ titulo, sql: buf.join('\n').trim() });
    } else if (dentro) buf.push(l);
  }
  return out;
}

function buscarHandoff(raiz, codigo, arg) {
  if (arg) {
    const r = path.resolve(raiz, arg);
    if (!fs.existsSync(r)) throw new ErrorCli(`No existe el handoff ${arg}.`);
    return r;
  }
  try {
    const dir = path.join(raiz, 'docs', 'planes');
    const f = fs.readdirSync(dir).find((n) => n.startsWith(`SEDE_DB_${codigo}`) && n.endsWith('.md'));
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
}

// Plan de despliegue: los pasos del circuito que corresponden al RQ, en orden, marcando los hechos, con el
// comando o la herramienta de cada uno. Con migraciones, cada sql:<ref> nombra los bloques del handoff.
function desplegar(repo, elegido, args, env, io) {
  const raiz = repo.raiz;
  const { codigo, estado } = activo(raiz, elegido);
  const proyecto = exigirProyecto(repo, env);
  const rutas = rutasDelRq(raiz, estado);
  const migraciones = (rutas ?? []).filter((r) => esMigracion(r, proyecto));
  const handoff = buscarHandoff(raiz, codigo, args[0]);
  const bloques = handoff ? bloquesHandoff(fs.readFileSync(handoff, 'utf8')).filter((b) => !/rollback/i.test(b.titulo)) : [];
  const repos = lista(proyecto.repos);
  const cuenta = proyecto.cuenta_github;
  const rama = proyecto?.sync?.rama || RAMA_SYNC;
  // COMO_TRABAJO_SIN_GH=1: no consulta GitHub (tests, o sin red).
  const sedes = env.COMO_TRABAJO_SIN_GH === '1' ? {} : migracionesEnSync(proyecto);
  const pend = new Set(pendientes({ proyecto, estado, raiz, rutas, sedes }).map(normPaso));
  const l = [`Plan de despliegue de ${codigo}`];
  l.push(rutas === null ? 'No pude leer el diff del RQ: se listan todos los pasos.' : `Migraciones en el RQ: ${migraciones.length ? migraciones.join(', ') : 'ninguna'}.`);
  const conSedes = repos.some((x) => x?.rol === 'sede');
  if (migraciones.length && !handoff && (conSedes || motorDatos(proyecto) === 'supabase')) l.push('Falta el handoff docs/planes/SEDE_DB_<código>.md con el SQL completo para las sedes.');
  if (handoff) l.push(`Handoff: ${path.relative(raiz, handoff)} (${bloques.length} bloques SQL sin contar el rollback).`);
  l.push('Un paso se puede hacer apenas están hechos los que lo preceden en proyecto.yml (despues_de); entre sedes no hay orden.', '');
  let n = 0;
  for (const { paso } of pasosCircuito(proyecto)) {
    if (!corresponde(paso, rutas, sedes, proyecto)) continue;
    n += 1;
    const hecho = !pend.has(normPaso(paso));
    const falta = hecho ? undefined : faltaAntes({ proyecto, estado, paso, raiz, rutas, sedes });
    const p = paso.trim();
    let como = '';
    if (/^push:/i.test(p)) como = `git push en ${p.slice(5)}`;
    else if (/^sql:/i.test(p)) {
      const ref = p.slice(4);
      const r = repos.find((x) => String(baseDelRepo(x) ?? '').toLowerCase() === ref.toLowerCase());
      const bl = bloques.map((b) => `"${b.titulo}"`).join(', ');
      const aplicar = typeof proyecto?.datos?.aplicar === 'string' ? proyecto.datos.aplicar.trim() : '';
      const enSupabase = lista(proyecto?.entornos?.prod?.supabase_refs).some((x) => String(x).toLowerCase() === ref.toLowerCase());
      // El modo automático bloquea escribir en PROD con la CLI de Supabase: va por el conector, una celda por llamada.
      // Otro motor aplica las migraciones con lo que declare datos.aplicar (un comando o una instrucción).
      como = aplicar
        ? `${aplicar} sobre ${ref}${r ? ` (${r.nombre})` : ''}${bl ? `; bloques del handoff en orden: ${bl}` : ''}`
        : enSupabase || motorDatos(proyecto) === 'supabase'
          ? `execute_sql del conector (no la CLI) con project_id ${ref}${r ? ` (${r.nombre})` : ''}, una llamada por bloque${bl ? `, en orden: ${bl}` : ''}`
          : `aplicar las migraciones en ${ref} con el mecanismo de ${motorDatos(proyecto)} (declaralo en datos.aplicar de proyecto.yml)`;
    } else if (/^merge-prs-sync:/i.test(p)) {
      const sede = p.slice('merge-prs-sync:'.length);
      como = cuenta
        ? `gh pr list -R ${cuenta}/${sede} --head ${rama}; gh pr merge <n> --merge -R ${cuenta}/${sede}`
        : `mergear el PR ${rama} de ${sede}`;
    } else if (esManual(p)) como = 'manual: lo hace el usuario; no bloquea el cierre';
    l.push(`${n}. [${hecho ? 'x' : ' '}] ${p}: ${como}${falta ? ` (antes: ${falta})` : ''}`);
  }
  if (n === 0) l.push('El circuito no tiene pasos para este RQ.');
  io.stdout.write(`${l.join('\n')}\n`);
}

function imprimirEstado(repo, codigo, estado, io) {
  const l = [];
  l.push(`Código: ${estado.codigo}`);
  l.push(`Tipo: ${estado.tipo}`);
  l.push(`Clasificación: ${estado.clasificacion}`);
  const derivada = etapaDerivada(estado, repo.raiz);
  l.push(`Etapa: ${derivada}${derivada !== estado.etapa ? ` (según la evidencia; registrada: ${estado.etapa})` : ''}`);
  const sk = skillsDe(estado);
  l.push(`Skills del RQ: ${sk.length ? sk.join(', ') : 'ninguna'}`);
  const proxima = [3, 4, 6].find((n) => n > derivada - 1 && faltaParaEtapa(estado, n, repo.raiz).length);
  if (proxima) l.push(`Falta para la etapa ${proxima}: ${faltaParaEtapa(estado, proxima, repo.raiz).join('; ')}`);
  const aps = lista(estado.aprobaciones);
  l.push(aps.length ? 'Aprobaciones:' : 'Aprobaciones: ninguna');
  for (const a of aps) l.push(`  ${a.etapa}: ${a.frase}`);
  const au = estado.autonomia;
  const porDefecto = ['spike', 'bounded'].includes(estado.clasificacion) ? 'hasta etapa 5 (por defecto)' : 'ninguna';
  l.push(au ? `Autonomía: hasta etapa ${au.hasta} ("${au.frase}")` : `Autonomía: ${porDefecto}`);
  const t = estado.tests;
  const rojos = lista(t?.rojos_conocidos).length;
  l.push(t ? `Tests: ${t.ok ? 'ok' : 'fallaron'} (${t.fecha})${rojos ? `, con ${rojos} rojos conocidos` : ''}` : 'Tests: sin registrar');
  const e = estado.e2e;
  l.push(e ? `E2E: ${e.ok ? 'ok' : 'falló'} (${e.fecha})` : 'E2E: sin correr');
  const r = estado.revision;
  l.push(r ? `Revisión: ${r.ok ? 'ok' : 'bloqueante'}${r.nota ? ` — ${r.nota}` : ''}` : 'Revisión: sin registrar');
  const circuito = lista(estado.circuito);
  l.push(circuito.length ? `Circuito: ${circuito.map((c) => (c.no_aplica ? `${c.paso} (no aplica)` : c.paso)).join(', ')}` : 'Circuito: sin pasos');
  const otros = rqsActivos(repo.raiz).filter((c) => c !== codigo);
  if (otros.length) l.push(`Otros RQ activos: ${otros.join(', ')}`);
  io.stdout.write(`${l.join('\n')}\n`);
}

/** Pasos del circuito que le faltan al RQ (en una sede, sólo los de esa sede). Sin despliegue empezado, ninguno. */
function pendientesDel(repo, estado, proyecto, env) {
  const raiz = repo.raiz;
  const desplego = (Number(estado.etapa) || 0) >= 5 || etapaDerivada(estado, raiz) >= 5 || lista(estado.circuito).length > 0;
  if (!proyecto || !desplego) return [];
  const sedes = env.COMO_TRABAJO_SIN_GH !== '1' ? migracionesEnSync(proyecto) : {};
  let pend = pendientes({ proyecto, estado, raiz, rutas: rutasDelRq(raiz, estado), sedes });
  // En una sede (RQ espejo) sólo quedan pendientes los pasos de esta sede: el resto es del RQ del padre.
  if (esSede(repo, env)) {
    const nombre = nombreRepo(raiz).toLowerCase();
    const ref = String(baseDelRepo(lista(proyecto?.repos).find((x) => String(x?.nombre ?? '').toLowerCase() === nombre)) ?? '').toLowerCase();
    pend = pend.filter((p) => {
      const destino = p.slice(p.indexOf(':') + 1).toLowerCase();
      return (/^(push|merge-prs-sync):/i.test(p) && destino === nombre) || (/^sql:/i.test(p) && ref !== '' && destino === ref);
    });
  }
  return pend;
}

// Un paso registrado después de cerrar (Lovable publicado, sync hecho a mano) recalcula los pendientes del RQ cerrado
// y los lleva a estado.yml, a la fila del backlog y al log (línea pendiente-resuelto).
function trasPasoDeCerrado(repo, elegido, env, io) {
  const { codigo, estado } = activo(repo.raiz, elegido);
  if (estado.etapa !== 7) return;
  let proyecto = null;
  try {
    proyecto = exigirProyecto(repo, env);
  } catch {
    return;
  }
  const antes = lista(estado.pendientes);
  const pend = pendientesDel(repo, estado, proyecto, env);
  if (pend.length === antes.length && pend.every((p, i) => p === antes[i])) return;
  if (pend.length) estado.pendientes = pend;
  else delete estado.pendientes;
  guardar(repo.raiz, estado);
  const previa = filaDelBacklog(repo, env, codigo);
  const fecha = /Hecho (\d{2}\/\d{2}\/\d{4})/.exec(previa.Estado ?? '')?.[1] ?? hoy();
  anotarBacklog(repo, env, codigo, { Estado: `Hecho ${fecha}${pend.length ? ` (falta: ${pend.join(', ')})` : ''}` }, io);
  const log = path.join(repo.raiz, 'docs', 'log', 'rq.jsonl');
  if (fs.existsSync(log)) {
    const linea = { fecha: fechaLocal(), codigo, tipo: 'pendiente-resuelto', resueltos: antes.filter((p) => !pend.includes(p)), pendientes: pend };
    fs.appendFileSync(log, `${JSON.stringify(linea)}\n`);
  }
  io.stdout.write(`RQ cerrado: ${pend.length ? `quedan ${pend.join(', ')}` : 'sin pendientes'} (estado.yml, backlog y log). Commitealos (son docs).\n`);
}

// Cierra el RQ aunque queden pasos manuales o de PROD sin hacer: quedan como pendientes en estado.yml, en la
// fila del backlog y en el log. Con --resumen escribe el changelog y el log y commitea los docs del cierre.
function cerrar(repo, elegido, args, env, io) {
  const { res, posicionales } = opciones(args, ['resumen', 'alcance'], ['sin-changelog']);
  if (posicionales.length) throw new ErrorUso();
  const resumen = res.resumen === undefined ? null : textoNoVacio(res.resumen, 'El resumen');
  const raiz = repo.raiz;
  const { codigo, estado } = activo(raiz, elegido);
  let proyecto = null;
  try {
    proyecto = exigirProyecto(repo, env);
  } catch (e) {
    io.stderr.write(`Aviso: ${e.message} Sin proyecto no se calculan los pendientes del circuito.\n`);
  }
  const pend = pendientesDel(repo, estado, proyecto, env);
  // Un RQ abierto con una versión vieja no tiene estado.tarea: el título sale de la fila del backlog o del spec.
  const previa = filaDelBacklog(repo, env, codigo);
  const spec = datosDelSpec(raiz, codigo);
  if (!estado.tarea && (previa.Tarea || spec.Tarea)) estado.tarea = previa.Tarea || spec.Tarea;
  estado.etapa = 7;
  if (pend.length) estado.pendientes = pend;
  else delete estado.pendientes;
  guardar(raiz, estado);
  guardarActivos(raiz, rqsActivos(raiz).filter((c) => c !== codigo));
  io.stdout.write(`RQ ${codigo} cerrado.\n`);
  if (pend.length) io.stdout.write(`Quedan pendientes (anotados en estado.yml y el backlog): ${pend.join(', ')}.\n`);
  // Sólo completa lo que la fila no tiene: no pisa Tarea, Prioridad ni Impacto vigentes.
  const completar = { Tarea: estado.tarea, Prioridad: spec.Prioridad, Impacto: spec.Impacto };
  for (const k of Object.keys(completar)) if (previa[k]) delete completar[k];
  anotarBacklog(repo, env, codigo, { ...completar, Estado: `Hecho ${hoy()}${pend.length ? ` (falta: ${pend.join(', ')})` : ''}`, Link: `docs/rq/${codigo}/` }, io);
  const vacias = ['Tarea', 'Prioridad', 'Impacto'].filter((k) => !previa[k] && !completar[k]);
  if (vacias.length && !esSede(repo, env)) {
    io.stderr.write(`Aviso: la fila de ${codigo} en el backlog quedó sin ${vacias.join(', ')}: completala a mano (no está en estado.yml ni en spec.md).\n`);
  }
  if (resumen) registrarCierre(repo, codigo, estado, proyecto, { resumen, alcance: res.alcance, sinChangelog: res['sin-changelog'] === true }, pend, io);
  else io.stdout.write('Sin --resumen: no se escribió changelog ni log.\n');
}

/** Fila del RQ en el backlog del proyecto ({} si no está o no se puede leer). */
function filaDelBacklog(repo, env, codigo) {
  try {
    return leerBacklog(dirLineamientos({ env }), repo.proyectoId, repo.raiz).find((f) => f['Código'] === codigo) ?? {};
  } catch {
    return {};
  }
}

/** Tarea (el `# ` de spec.md sin el código) y, si el encuadre las dice, Prioridad e Impacto. */
function datosDelSpec(raiz, codigo) {
  let lineas;
  try {
    lineas = fs.readFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), 'utf8').split(/\r?\n/).slice(0, 60);
  } catch {
    return {};
  }
  const h1 = lineas.find((l) => /^#\s+\S/.test(l));
  let tarea = h1 ? h1.replace(/^#\s+/, '').trim() : '';
  if (tarea.startsWith(codigo)) tarea = tarea.slice(codigo.length).replace(/^\s*[·:—–-]\s*/, '').trim();
  const campo = (nombre) => {
    const re = new RegExp(`^\\s*(?:[-*]\\s+)?\\**${nombre}\\**\\s*:\\s*\\**\\s*(.+?)\\s*$`, 'i');
    for (const l of lineas) {
      const m = re.exec(l);
      if (m) return m[1].replace(/\*+$/, '').trim() || undefined;
    }
    return undefined;
  };
  return { Tarea: tarea || undefined, Prioridad: campo('Prioridad'), Impacto: campo('Impacto') };
}

/** Saca `--rq <código>` de los argumentos (puede ir en cualquier lugar). */
function sacarRq(argv) {
  const out = [];
  let rq = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rq') {
      if (i + 1 >= argv.length) throw new ErrorUso();
      rq = argv[++i];
    } else {
      out.push(argv[i]);
    }
  }
  return { argv: out, rq };
}

export async function main(argvCompleto, { cwd = process.cwd(), env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const io = { stdout, stderr };
  let sub;
  try {
    const { argv, rq: elegido } = sacarRq(argvCompleto);
    let args;
    [sub, ...args] = argv;
    const n = args.length;
    const uso = (ok) => { if (!ok) throw new ErrorUso(); };
    const SUBS = ['abrir', 'etapa', 'aprobar', 'autonomia', 'saltar', 'commit', 'registrar-tests', 'verificar', 'revision', 'paso', 'desplegar', 'entregar', 'agents', 'auditar', 'estado', 'cerrar'];
    if (!SUBS.includes(sub)) sub = null;
    uso(sub !== null);
    const aridad = { etapa: 1, aprobar: 2, autonomia: 2, saltar: 3, revision: 2, paso: 1, 'registrar-tests': 0, entregar: 0, agents: 0, estado: 0 };
    if (sub === 'paso' && (args[0] === 'no-aplica' || args[0] === 'hecho')) uso(n === 3);
    else if (sub === 'paso' && args[0] === 'reabrir') uso(n === 2);
    else if (sub === 'desplegar') uso(n <= 1);
    else if (sub === 'commit') uso(n >= 2);
    else if (sub === 'auditar') uso(n === 0 || (n === 2 && args[0] === '--cerrar'));
    else if (!['abrir', 'cerrar', 'verificar'].includes(sub)) uso(n === aridad[sub]);

    const repo = buscarRepo(cwd);
    if (!repo) throw new ErrorCli('No es un repo con .lineamientos ni .como-trabajo/proyecto.yml.');
    const raiz = repo.raiz;
    // El RQ elegido con --rq pasa a ser el "en curso" (último de ACTIVO): ahí registra las skills el hook.
    const activos = rqsActivos(raiz);
    if (elegido && activos.includes(elegido) && activos[activos.length - 1] !== elegido) {
      guardarActivos(raiz, [...activos.filter((c) => c !== elegido), elegido]);
    }

    switch (sub) {
      case 'abrir':
        abrir(repo, args, env, io);
        break;
      case 'etapa': {
        const e = etapaValida(args[0]);
        const { codigo, estado } = activo(raiz, elegido);
        const falta = faltaParaEtapa(estado, e, raiz);
        // Aviso, no bloqueo: la etapa es opcional; lo exigen revision, el commit de código y la publicación a PROD.
        if (falta.length) io.stderr.write(`Aviso: para la etapa ${e} del ${codigo} falta: ${falta.join('; ')}.\n`);
        if (e >= 1) rebasarSiNoEmpezo(raiz, codigo, estado);
        estado.etapa = e;
        guardar(raiz, estado);
        io.stdout.write(`Etapa ${e}.\n`);
        break;
      }
      case 'aprobar': {
        const e = etapaValida(args[0]);
        const frase = textoNoVacio(args[1], 'La frase');
        cambiar(raiz, elegido, io, (s) => {
          s.aprobaciones = [...lista(s.aprobaciones), { etapa: e, frase, fecha: ahora() }];
          return `Aprobación de la etapa ${e} registrada.`;
        });
        break;
      }
      case 'autonomia': {
        const h = entero(args[0]);
        if (h === null || h < 1 || h > 5) throw new ErrorCli(`hasta inválido: "${args[0]}" (tiene que ser un entero de 1 a 5).`);
        const frase = textoNoVacio(args[1], 'La frase');
        cambiar(raiz, elegido, io, (s) => { s.autonomia = { hasta: h, frase, fecha: ahora() }; return `Autonomía hasta la etapa ${h} registrada.`; });
        break;
      }
      case 'saltar': {
        const [compuerta, frase, motivo] = args;
        if (!COMPUERTAS.includes(compuerta)) throw new ErrorCli(`Compuerta inválida: "${compuerta}" (${COMPUERTAS.join(' | ')}).`);
        textoNoVacio(frase, 'La frase');
        textoNoVacio(motivo, 'El motivo');
        cambiar(raiz, elegido, io, (s) => {
          s.saltos = [...lista(s.saltos), { compuerta, frase, motivo, fecha: ahora() }];
          return `Salto de la compuerta ${compuerta} registrado.`;
        });
        break;
      }
      case 'revision': {
        const [veredicto, nota] = args;
        if (veredicto !== 'ok' && veredicto !== 'bloqueante') throw new ErrorCli(`Veredicto inválido: "${veredicto}" (ok | bloqueante).`);
        const { codigo, estado } = activo(raiz, elegido);
        if (veredicto === 'ok') {
          const falta = faltaParaEtapa(estado, 4, raiz);
          if (falta.length) throw new ErrorCli(`Antes de la revisión del ${codigo} falta: ${falta.join('; ')}. Si el usuario decide saltearlo: $RQ saltar skills "<frase>" "<motivo>".`);
          const sensible = sensibleSinRevisar(estado, rutasDelRq(raiz, estado), proyectoDe(repo, env));
          if (sensible) throw new ErrorCli(`El ${codigo} toca ${sensible} (ruta sensible): falta claude-security (Skill "claude-security:claude-security") o, si el usuario lo decide, $RQ saltar seguridad "<frase>" "<motivo>".`);
        }
        estado.revision = { ok: veredicto === 'ok', fecha: ahora(), nota };
        guardar(raiz, estado);
        io.stdout.write(`Revisión registrada: ${veredicto}.\n`);
        break;
      }
      case 'commit':
        return commit(repo, elegido, args, env, io);
      case 'registrar-tests':
        return registrarTests(repo, elegido, env, io);
      case 'verificar':
        return verificar(repo, elegido, args, env, io);
      case 'entregar':
        entregar(repo, elegido, env, io);
        break;
      case 'agents':
        agents(repo, env, io);
        break;
      case 'auditar':
        auditar(repo, args, env, io);
        break;
      case 'paso':
        if (args[0] === 'no-aplica') marcarNoAplica(repo, elegido, args[1], args[2], env, io);
        else if (args[0] === 'hecho') registrarHecho(repo, elegido, args[1], args[2], env, io);
        else if (args[0] === 'reabrir') reabrirPaso(repo, elegido, args[1], env, io);
        else registrarPaso(repo, elegido, args[0], env, io);
        trasPasoDeCerrado(repo, elegido, env, io);
        break;
      case 'desplegar':
        desplegar(repo, elegido, args, env, io);
        break;
      case 'estado': {
        const cerrados = cerradosConPendientes(raiz).filter((c) => c.codigo !== elegido);
        if (!elegido && rqsActivos(raiz).length === 0) io.stdout.write('RQ activo: ninguno.\n');
        else {
          const { codigo, estado } = activo(raiz, elegido);
          imprimirEstado(repo, codigo, estado, io);
          for (const a of avisosDeAtraso(raiz, codigo, estado)) io.stdout.write(`${a}\n`);
        }
        for (const c of cerrados) io.stdout.write(`Cerrado con pendientes: ${c.codigo} (falta: ${c.pendientes.join(', ')}; al hacerlos, $RQ paso … --rq ${c.codigo}).\n`);
        break;
      }
      case 'cerrar':
        cerrar(repo, elegido, args, env, io);
        break;
    }
    return 0;
  } catch (e) {
    if (e instanceof ErrorUso) {
      stderr.write(usoDe(sub));
      return 2;
    }
    stderr.write(`${e instanceof ErrorCli ? e.message : String(e?.message ?? e)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
