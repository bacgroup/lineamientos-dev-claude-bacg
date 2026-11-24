// CLI del agente para estado.yml de los RQ activos. Uso: node rq.mjs <subcomando> [args] [--rq <código>].
// Es la única vía por la que el agente escribe docs/rq/<código>/estado.yml. También lleva la fila del RQ en
// el backlog y, al cerrar, el changelog, el log del proyecto (docs/log/rq.jsonl) y el commit de docs.

import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { buscarRepo, cargarProyecto, carpetaProyecto, dirLineamientos, nombreRepo, CARPETA_REPO } from './lib/config.mjs';
import { rqsActivos, rqActivo, guardarActivos, cargarEstado, guardarEstado, estadoCommiteado, etapaDerivada, saltoValido, cerradosConPendientes } from './lib/estado.mjs';
import { conRutas, comandosTests, comandoE2e, PISTA_SIN_TESTS, rojosConocidos, fallosDe, soloRojosConocidos, claseFalla, conArchivos, resumenFalla, conSpecs, shellDeTests } from './lib/cli.mjs';
import { faltaParaEtapa, pasadasSinRepetir, PASADAS_REVISION, nombreSkill as nombreSkillDe, fueraDeSonda, MSG_EXPLORACION_FUERA, sensibleSinRevisar, skillsDe, tieneSkill, tocaUi, verificacionLocalOk } from './lib/requisitos.mjs';
import { SIN_BASE, baseDeUpstream, commitHead, pasoObligatorio, rutaQueImpide, rutasDesde, refPrincipal, nombraCodigo } from './lib/no-aplica.mjs';
import { pasosCircuito, rutasDelRq, pendientes, corresponde, esManual, faltaAntes, migracionesEnSync, RAMA_SYNC } from './lib/circuito.mjs';
import { upsertFila, upsertEnArchivo, fusionarEnArchivo, columnasDe, crearConEncabezadoDe, rutaBacklog, rutaCentral, leerBacklog, filasDe, diferencias as diferenciasBacklog } from './lib/backlog.mjs';
import { tipoArchivo, globARegExp } from './lib/rutas.mjs';
import { baseDelRepo, esMigracion, motorDatos } from './lib/stack.mjs';
import { rutaCanon, seccionAgents, escribirAgents } from './lib/agents.mjs';
import { commitsAuditables, cerrarAuditoria, RUTA_MARCA } from './lib/auditoria.mjs';
import { espejar, heredar, reposHermanos } from './lib/multi-repo.mjs';
import { pasosAlta, formatoAlta, bloqueante, scriptDelComando, comandoRelacionado } from './lib/alta.mjs';
import { validacionPrevia, mensajeBloqueo } from './lib/previa.mjs';
import { ordenDeRamas } from './lib/promocion.mjs';
import { textoArranque } from './lib/arranque.mjs';
import { instalarSkillsOdoo, ramaSkills, SKILLS_ODOO, dirSkills } from './lib/odoo-skills.mjs';
import { ETAPA, NOMBRE_ETAPA } from './lib/etapas.mjs';
import { clasificacionDe, nombreDe, implicancias } from './lib/clasificacion.mjs';
import { enRamaProtegida, pasarARamaDelRq, ramaDelRq, cambiosDeOtrosRq } from './lib/ramas.mjs';
import { arbolTesteado, esPropioDeLaCli } from './lib/arbol.mjs';
import { leerTranscript, vecesQueLoDijo, mismaFrase } from './lib/transcript.mjs';
import { RE_SESION, dirSesiones, homeReal, transcripcionRegistrada } from './lib/sesiones.mjs';
import { intentarLock, soltarLock, lockTomado } from './lib/lock.mjs';
import { lockE2e, firmaE2e, msgE2eEnCurso } from './lib/e2e-lock.mjs';
import { avisoMergeado } from './lib/rq-rama.mjs';
import { REGLAS_ACTUALES, reglas44 } from './lib/reglas.mjs';
import { prsDeRama, checksDe, REST } from './lib/github.mjs';
import { compiladosCompartidos } from './lib/compilados.mjs';
import { remotoGh } from './lib/config.mjs';
import { faltasCapturas, refExigida } from './lib/diseno-ui.mjs';
import { agregar as agregarDevolucion, marcar as marcarDevolucion, listado as listadoDevoluciones, PROTOCOLO_CORTE } from './lib/devoluciones.mjs';
import { trazar as trazarSpec } from './lib/traza.mjs';
import { instalarRevisor, RUTA_WORKFLOW } from './lib/revisor-pr.mjs';

const TIPOS = ['rq', 'bug', 'fix']; // fix: nombre anterior de bug
// skills: las de proceso por etapa (requisitos.mjs); seguridad: claude-security en rutas sensibles.
// verificacion-local: omite el recorrido local con el rol real en un RQ que toca UI.
// plugins: seguir sin un plugin requerido (PLG-DEPS); el usuario lo decide.
// ui: omite el refuerzo de UI del plugin (diseno-frontend, redesign y ## Diseño) en un cambio menor; el canon sigue.
// mockup: el usuario decidió que un cambio técnico o chico no necesita mockup; journey, referencias y paridad siguen.
const COMPUERTAS = ['edicion', 'commit', 'push', 'e2e', 'skills', 'seguridad', 'ui', 'mockup', 'verificacion-local', 'rama', 'plugins'];
const RE_CODIGO = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const USO = `Uso: node rq.mjs <subcomando> [args] [--rq <código>]   (--rq elige entre varios RQ activos; sin --rq, el más reciente)
  alta                                     (stepper de primer uso: qué falta configurar en esta PC antes del primer RQ)
  odoo-skills [--rama <rama>]              (instala en ~/.claude/skills (o CLAUDE_CONFIG_DIR/skills) las skills oficiales de Odoo: odoo/odoo skills/, rama 20.0)
  previa [<código>]                        (proyecto detectado, fetch de los repos, atraso contra la rama de DEV, ramas y PR en paralelo, backlog remoto)
  abrir <código> --tipo rq|bug --clasificacion exploracion|acotado|arquitectonico [--tarea "<texto>"] [--prioridad <p>] [--impacto <i>] [--sin-alta] [--sin-previa] [--frase "<frase del usuario para saltear alta o previa>"] [--llevar-cambios]
  clasificacion confirmar "<frase>"   (el usuario confirma la clasificación propuesta; hasta entonces no se edita código)
  clasificacion cambiar <exploracion|acotado|arquitectonico> "<frase>"   (cambia y confirma; la frase es texto literal del usuario)
  ejecucion inline|subagentes "<frase>"   (cómo se ejecuta el plan, antes del primer commit de código; acepta executing-plans y subagent-driven-development)
  etapa <n>                          (0-6; opcional: estado deriva la etapa de la evidencia)
  aprobar <etapa> "<frase>"          (etapa 0-6: 1 diseño y plan, 4 DEV en arquitectónico, 5 PROD; la frase es texto literal del usuario)
  autonomia <hasta> "<frase>"        (hasta 1-4: cubre desarrollo (2) y DEV (4), nunca el diseño ni PROD)
  autonomia sesion "<frase>"         (autonomía de la sesión: en los RQ que se trabajen en esta sesión confirma la clasificación propuesta, aprueba el diseño con ## Diseño y ## Tareas (salvo Arquitectónico) y cubre desarrollo y DEV; nunca PROD)
  autonomia total "<frase>" [--ejecucion inline|subagentes]   (autonomía total de la sesión: además, en toda clasificación aprueba diseño y plan escritos y registra la ejecución; nunca PROD ni saltos)
  autonomia aplicar                  (aplica la autonomía de la sesión al RQ, p. ej. después de escribir ## Diseño y ## Tareas)
  ok "<frase>" [--ejecucion inline|subagentes]   (una respuesta del usuario registra todo lo pendiente del RQ hasta DEV: clasificación, diseño y plan escritos, ejecución y autonomía; nunca PROD)
  reglas actualizar                  (pasa el RQ a las reglas de cumplimiento de la 4.4)
  devolucion [agregar "<punto>" [--elemento <x>] | <n> hecho|consultado|rechazado "<evidencia>"]   (lista cerrada de devoluciones del usuario; corta la iteración al segundo punto sobre el mismo elemento)
  backlog migrar                     (fusiona el backlog central en docs/backlog.md del repo y lo deja como única fuente: declarar backlog: repo)
  trazar                             (arma o completa docs/rq/<código>/traza.yml desde el criterio de aceptación del spec)
  lote aprobar "<frase>" <código>…   (una frase del usuario que nombra los RQ o dice "todos": confirma la clasificación y aprueba el diseño de cada uno; PROD sigue siendo por RQ)
  skills importar                    (anota en el RQ las skills ya cargadas en esta sesión de Claude Code)
  activo reparar                     (rehace docs/rq/ACTIVO con los RQ abiertos que hay en el árbol; resuelve un conflicto de merge)
  saltar <compuerta> "<frase>" "<motivo>"   (compuerta: edicion|commit|push|e2e|skills|seguridad|ui|mockup|verificacion-local|rama|plugins)
  commit "<mensaje>" <rutas>…        (git add de las rutas, tests relacionados, registro y commit en un paso)
  registrar-tests                    (tests de commit sobre lo que está en stage; sin E2E)
  verificar [--completo] [<specs>…]  (E2E contra la app levantada; con {specs} en tests.e2e, sólo los del RQ salvo --completo)
  verificar --local "<qué se recorrió con el rol real>" <capturas…>   (RQ que toca UI, navegador o Playwright, rol real, sin mocks: capturas en docs/rq/<código>/qa/)
  revision ok|bloqueante "<nota>"
  paso manual:<texto>|sync-lineamientos   (pasos manuales de circuito_prod)
  paso hecho <paso> "<evidencia>"    (paso hecho por fuera: merge desde GitHub, migración que ya estaba aplicada)
  paso no-aplica <paso> "<motivo>"   (paso que no corresponde y no se deduce solo del diff)
  paso reabrir <paso>                (quita la marca de no aplica)
  desplegar [<handoff.md>]           (plan de despliegue: pasos que faltan, en orden, con su comando)
  entregar                           (rama, PR, CI y plan de despliegue: qué falta para terminar)
  agents                             (escribe en AGENTS.md la sección de lineamientos generada desde .bacg-dev/)
  revisor-pr [--forzar]              (instala .github/workflows/bacg-revisor.yml: revisor independiente en PR y push; necesita el secret ANTHROPIC_API_KEY)
  auditar [--cerrar "<nota>"]        (commits de Lovable sin revisar; --cerrar mueve la marca y lo anota en docs/log/rq.jsonl)
  estado                             (avisa si la rama está atrasada o si el RQ ya figura cerrado en origin/main)
  arranque                           (inicio o reanudación de la sesión: proyecto, repos, lo último trabajado o dónde quedó el RQ activo; sólo lee)
  canon no "<frase>" | documentado   (al cerrar un RQ que tocó UI: si dejó un lineamiento nuevo para el canon de UI)
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

/** Transcripciones de la sesión: <home>/.claude/projects/<carpeta>/<id>.jsonl (un nivel de carpeta). */
function transcripcionesDe(home, id) {
  const base = path.join(home, '.claude', 'projects');
  let carpetas;
  try {
    carpetas = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  return carpetas
    .filter((c) => c.isDirectory())
    .map((c) => path.join(base, c.name, `${id}.jsonl`))
    .filter((r) => {
      try {
        return fs.statSync(r).isFile();
      } catch {
        return false;
      }
    });
}


/** Una línea tipeada en la terminal; si nadie escribe en 2 minutos, falla. */
function leerLineaDeTerminal(pregunta, stderr) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    const t = setTimeout(() => { rl.close(); reject(new Error('sin respuesta')); }, 120000);
    stderr.write(pregunta);
    rl.once('line', (l) => { clearTimeout(t); rl.close(); resolve(l); });
    rl.once('close', () => { clearTimeout(t); reject(new Error('sin respuesta')); });
  });
}

/** Cuántas veces quedó registrada ya una frase en el RQ (aprobaciones, saltos, autonomía, ejecución, clasificación). */
function usosDeFrase(estado, frase, { sinSesion = false } = {}) {
  let n = 0;
  // Los registros de un mismo `ok` (via: ok, mismo grupo) son una sola respuesta del usuario: cuentan una vez.
  const grupos = new Set();
  const visitar = (v, clave) => {
    if (clave === 'frase' && typeof v === 'string' && mismaFrase(v, frase)) n += 1;
    else if (Array.isArray(v)) v.forEach((x) => visitar(x));
    else if (v && typeof v === 'object') {
      // Un punto de devolución rechazado o consultado lleva como evidencia una frase del usuario: también es un uso.
      if ((v.estado === 'rechazado' || v.estado === 'consultado') && typeof v.evidencia === 'string' && mismaFrase(v.evidencia, frase)) n += 1;
      if (v.via === 'ok' && typeof v.grupo === 'string') {
        if (!grupos.has(v.grupo) && typeof v.frase === 'string' && mismaFrase(v.frase, frase)) {
          grupos.add(v.grupo);
          n += 1;
        }
        return;
      }
      // sinSesion: no cuentan los registros de la autonomía de sesión (una frase que vale para varios registros).
      if (sinSesion && (v.via === 'sesion' || v.via === 'sesion-total')) return;
      for (const [k, x] of Object.entries(v)) visitar(x, k);
    }
  };
  visitar(estado);
  return n;
}

/** Id de la sesión de Claude Code (CLAUDE_CODE_SESSION_ID) o ErrorCli: `para` dice qué no se puede hacer sin ella. */
function idDeSesion(env, para) {
  const id = env?.CLAUDE_CODE_SESSION_ID;
  if (id === undefined) throw new ErrorCli(`Sin sesión de Claude Code no se puede ${para}.`);
  if (typeof id !== 'string' || !RE_SESION.test(id)) throw new ErrorCli(`Id de sesión inválido (${JSON.stringify(String(id))}): no se puede ${para}.`);
  return id;
}

/** Mensajes del usuario y skills cargadas en la sesión de Claude Code en curso (su transcripción). Falla cerrada. */
async function transcriptDeLaSesion({ env, home }, para) {
  const id = idDeSesion(env, para);
  // Cuenta por defecto: <home real>/.claude/projects; otra cuenta (CLAUDE_CONFIG_DIR): la que anotó el hook.
  let rutas = transcripcionesDe(home, id);
  if (rutas.length === 0) {
    const registrada = transcripcionRegistrada(id, { home });
    if (registrada) rutas = [registrada];
  }
  if (rutas.length > 1) throw new ErrorCli(`Hay más de una transcripción de la sesión ${id}: no se puede ${para}.`);
  try {
    if (rutas.length === 0) throw new Error('TRANSCRIPT_NO_DISPONIBLE');
    return { id, ...(await leerTranscript(rutas[0])) };
  } catch {
    throw new ErrorCli(`No se encontró la transcripción de la sesión ${id}: no se puede ${para}.`);
  }
}

/**
 * La frase de aprobar, autonomia, saltar, clasificacion y ejecucion tiene que ser texto literal del usuario: un
 * mensaje entero o una oración entera de lo que escribió en la sesión de Claude Code (CLAUDE_CODE_SESSION_ID), con
 * las reglas de las compuertas (sin subagentes, mensajes meta, resultados de herramientas, eventos del sistema ni
 * resúmenes de compactación). Cada vez que el usuario la dijo vale para un solo registro en el RQ. Sin sesión sólo
 * vale desde una terminal interactiva y volviendo a tipear la frase (una persona). Falla cerrada.
 */
async function verificarFrase(frase, { env, home, tty, leerLinea, stderr }, estado, { flexible = false } = {}) {
  const id = env?.CLAUDE_CODE_SESSION_ID;
  if (id === undefined) {
    // Dentro de Claude Code la variable siempre está: si falta, alguien la borró.
    if (env?.CLAUDECODE || env?.CLAUDE_CODE_ENTRYPOINT) {
      throw new ErrorCli('Dentro de Claude Code sin id de sesión: no se puede verificar la frase.');
    }
    if (tty !== true) {
      throw new ErrorCli('Sin sesión de Claude Code ni terminal interactiva: la frase sólo la puede registrar el usuario desde su terminal.');
    }
    let linea;
    try {
      linea = await leerLinea(`Para registrar "${frase}", tipeá de nuevo la frase: `, stderr);
    } catch {
      throw new ErrorCli('No se tipeó la frase: no se registra nada.');
    }
    if (!mismaFrase(linea, frase)) throw new ErrorCli('La frase tipeada no coincide: no se registra nada.');
    return;
  }
  const { textosUsuario: textos } = await transcriptDeLaSesion({ env, home }, 'verificar la frase');
  const dichas = vecesQueLoDijo(frase, textos, { flexible });
  if (dichas === 0) {
    throw new ErrorCli(`La frase "${frase}" no aparece en lo que escribió el usuario en esta sesión (tiene que ser un mensaje o una oración enteros). Registrá sólo palabras literales del usuario.`);
  }
  if (estado && usosDeFrase(estado, frase) >= dichas) {
    throw new ErrorCli(`La frase "${frase}" ya está registrada en el RQ: cada vez que el usuario la escribe vale para un solo registro. Si su mensaje trae varias decisiones (clasificación, aprobar 1, ejecución), registrá cada una con su propio tramo: una oración entera, separada por . ; salto de línea o " + ".`);
  }
}

function etapaValida(s, nombre = 'etapa') {
  const n = entero(s);
  if (n === null || n > ETAPA.CIERRE) throw new ErrorCli(`${nombre} inválida: "${s}" (tiene que ser un entero de 0 a ${ETAPA.CIERRE}).`);
  return n;
}

// En 3.x el OK de PROD era la etapa 6 (hoy Cierre): `aprobar 6` y `etapa 6` sobre un RQ abierto con 3.x (cargado con `_v3`) se
// registra como 5, con aviso. Una vez guardado en v4, 6 es el cierre.
const AVISO_PROD_V3 = `Etapa 6 de la numeración vieja: registrada como ${ETAPA.PROD} (${NOMBRE_ETAPA[ETAPA.PROD]}).`;

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

/** Comando de tests con {raiz} y {repo:<nombre>} resueltos; un repo que no está en la máquina es un error del CLI. */
function rutasEn(comando, raiz, proyecto) {
  const propio = nombreRepo(raiz).toLowerCase();
  const resolver = (n) => {
    if (n.toLowerCase() === propio) return raiz;
    const id = buscarRepo(raiz)?.proyectoId;
    return reposHermanos(raiz, id, proyecto).find((r) => nombreRepo(r).toLowerCase() === n.toLowerCase()) ?? null;
  };
  try {
    return conRutas(comando, raiz, resolver);
  } catch (e) {
    throw new ErrorCli(e.message);
  }
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
    const proyecto = proyectoDe(repo, env);
    const fuente = rutaBacklog(dirLin, repo.proyectoId, repo.raiz, proyecto);
    const copia = path.join(repo.raiz, 'docs', 'backlog.md');
    if (path.resolve(fuente) === path.resolve(copia)) {
      const r = upsertFila(dirLin, repo.proyectoId, codigo, campos, repo.raiz, proyecto);
      io.stdout.write(`Backlog: fila ${codigo} ${r} (docs/backlog.md).\n`);
      return;
    }
    // PLG-BACKLOG: con la fuente central, la copia del repo se fusiona antes (gana el estado más avanzado y no se pierden
    // filas agregadas en el repo); después se escriben las dos. Antes la copia del repo se pisaba entera.
    // La fusión es quirúrgica (sólo agrega filas o sube la celda Estado); la fila de este RQ la escribe la CLI en las dos
    // copias, así que un RQ reabierto queda En curso aunque una copia lo tuviera Hecho.
    // Si una de las dos copias no existe todavía, no hay diferencias que reportar: se crea con las filas de la otra.
    const dif = fs.existsSync(fuente) && fs.existsSync(copia) ? diferenciasBacklog(filasDe(fuente), filasDe(copia)) : [];
    if (fs.existsSync(copia)) fusionarEnArchivo(fuente, filasDe(copia));
    const r = upsertEnArchivo(fuente, codigo, campos);
    fusionarEnArchivo(copia, filasDe(fuente));
    upsertEnArchivo(copia, codigo, campos);
    io.stdout.write(`Backlog: fila ${codigo} ${r} (lineamientos y docs/backlog.md${dif.length ? `; fusioné ${dif.length} fila(s) que diferían: ${dif.join(', ')}` : ''}). Para dejar una sola fuente: $RQ backlog migrar.\n`);
  } catch (e) {
    io.stderr.write(`Aviso: no pude actualizar el backlog (${e.message}).\n`);
  }
}

/** Un repo declarado en varios proyectos frena hasta que el marcador lo desambigüe (aun con --sin-previa). */
function exigirProyectoUnico(repo) {
  if (lista(repo.ambiguos).length > 1) {
    throw new ErrorCli(`El repo ${nombreRepo(repo.raiz)} figura en varios proyectos (${repo.ambiguos.join(', ')}): no sé en cuál vas a trabajar. Confirmalo con el usuario y dejá en la raíz del repo un .bacg-lineamientos con "proyecto: <id>" (sumalo a .git/info/exclude para no commitearlo).`);
  }
}

function previa(repo, env, codigo, nuevo) {
  exigirProyectoUnico(repo);
  return validacionPrevia({ repo, proyecto: proyectoDe(repo, env), codigo, nuevo, env, dirLin: dirLineamientos({ env }) });
}

async function abrir(repo, args, env, io, verificacion) {
  const raiz = repo.raiz;
  const { res, posicionales } = opciones(args, ['tipo', 'clasificacion', 'tarea', 'prioridad', 'impacto', 'frase'], ['sin-alta', 'sin-previa', 'llevar-cambios']);
  if (posicionales.length !== 1 || !res.tipo || !res.clasificacion) throw new ErrorUso();
  exigirProyectoUnico(repo);
  // PLG-CLOUD (hallazgo 15): saltear el alta o la previa lo decide el usuario, con su frase.
  for (const flag of ['sin-alta', 'sin-previa']) {
    const env43 = flag === 'sin-alta' ? env.BACG_DEV_SIN_ALTA : env.BACG_DEV_SIN_PREVIA;
    if (res[flag] !== true || env43 === '1') continue;
    if (typeof res.frase !== 'string' || !res.frase.trim()) {
      throw new ErrorCli(`--${flag} saltea un control y lo decide el usuario: pedíselo y pasá su respuesta literal con --frase "<su frase>".`);
    }
    await verificarFrase(res.frase, verificacion, null);
  }
  // Alta de la PC: sin los pasos obligatorios (tests, lineamientos…) no se abre un RQ. --sin-alta sólo si el usuario
  // lo pide con sus palabras (p. ej. un RQ de sólo documentación).
  if (res['sin-alta'] !== true && env.BACG_DEV_SIN_ALTA !== '1') {
    const falta = bloqueante(pasosAlta({ cwd: raiz, env, sinGh: true }));
    if (falta) throw new ErrorCli(`Antes del primer RQ falta completar el alta de esta PC: "${falta.titulo}". Corré ${'`'}rq.mjs alta${'`'} (o /bacg-alta) y seguí los pasos. ${falta.como ?? ''}`.trim());
  }
  const [codigo] = posicionales;
  if (!RE_CODIGO.test(codigo)) throw new ErrorCli(`Código inválido: "${codigo}" (letras, números, "_" y "-"; empieza con letra o número).`);
  if (!TIPOS.includes(res.tipo)) throw new ErrorCli(`--tipo inválido: "${res.tipo}" (rq | bug).`);
  const clasificacion = clasificacionDe(res.clasificacion);
  if (!clasificacion) {
    throw new ErrorCli(`--clasificacion inválida: "${res.clasificacion}" (exploracion | acotado | arquitectonico).`);
  }
  const dir = path.join(raiz, 'docs', 'rq', codigo);
  let existente = null;
  try {
    existente = cargarEstado(raiz, codigo);
  } catch (e) {
    if (!String(e.message).startsWith('ESTADO_INEXISTENTE')) throw e;
  }
  // Validación previa (PLG-PREVIA): dónde está parado el trabajo antes de empezar. --sin-previa sólo si el usuario
  // lo pide con sus palabras.
  if (res['sin-previa'] !== true && env.BACG_DEV_SIN_PREVIA !== '1') {
    const { lineas, bloqueos } = previa(repo, env, codigo, !existente);
    io.stdout.write(`Validación previa:\n${lineas.join('\n')}\n\n`);
    if (bloqueos.length) throw new ErrorCli(mensajeBloqueo(codigo, bloqueos));
  }
  // M7: en una rama que sólo recibe PR (o de PROD) el RQ trabaja en rq/<código>. Si no se puede, se abre igual.
  let avisoRama = null;
  if (enRamaProtegida(raiz, proyectoDe(repo, env))) {
    // Los cambios sin commitear de otro RQ viajarían con el switch a la rama nueva: primero que vuelvan a su rama.
    const ajenos = res['llevar-cambios'] === true ? [] : cambiosDeOtrosRq(raiz, codigo);
    if (ajenos.length) throw new ErrorCli(msgCambiosAjenos(codigo, ajenos));
    const p = pasarARamaDelRq(raiz, codigo);
    avisoRama = p.error
      ? `No pude pasar a ${ramaDelRq(codigo)}: ${p.error}
Hacelo a mano: git switch ${ramaDelRq(codigo)} (o git switch -c ${ramaDelRq(codigo)} si no existe; los cambios en stage viajan con el switch).`
      : `Rama del RQ: ${p.rama} (desde ${p.desde}).`;
  }
  let vinculo = null;
  if (!existente) {
    const nuevo = {
      codigo,
      tipo: res.tipo,
      clasificacion,
      clasificacion_pendiente: true,
      ...(res.tarea ? { tarea: res.tarea } : {}),
      etapa: 0,
      autonomia: null,
      aprobaciones: [],
      tests: null,
      revision: null,
      circuito: [],
      saltos: [],
      base: commitHead(raiz),
      // Reglas de cumplimiento 4.4 por defecto; un proyecto que todavía no las adopta declara `reglas: 43`.
      ...(Number(proyectoDe(repo, env)?.reglas) === 43 ? {} : { reglas: REGLAS_ACTUALES }),
    };
    // RQ multi-repo: si el mismo código está activo en otro repo del proyecto, hereda lo compartido.
    vinculo = heredar(raiz, repo.proyectoId, proyectoDe(repo, env), nuevo);
    guardarEstado(raiz, nuevo);
  }
  fs.mkdirSync(dir, { recursive: true });
  const otros = rqsActivos(raiz).filter((c) => c !== codigo);
  guardarActivos(raiz, [...otros, codigo]);
  io.stdout.write(existente ? `RQ ${codigo} retomado (etapa ${existente.etapa}).\n` : `RQ ${codigo} abierto.\n`);
  if (avisoRama) io.stdout.write(`${avisoRama}
`);
  if (!existente) imprimirClasificacion(cargarEstado(raiz, codigo), io);
  if (vinculo) io.stdout.write(`RQ multi-repo: vinculado con ${vinculo} (hereda aprobaciones, autonomía, saltos y skills; los cambios nuevos se replican).\n`);
  if (otros.length) io.stdout.write(`Otros RQ activos: ${otros.join(', ')} (usá --rq para elegir).\n`);
  await alAbrirEnSesion(repo, env, codigo, io, verificacion);
  anotarBacklog(repo, env, codigo, {
    Tarea: res.tarea,
    Prioridad: res.prioridad,
    Impacto: res.impacto,
    Estado: 'En curso',
    Link: `docs/rq/${codigo}/`,
  }, io);
}

// ---- Varios RQ en una sesión: autonomía de sesión, aprobación de lote, skills de la sesión y ACTIVO ----

const archivoAutonomia = (home, id) => path.join(dirSesiones(home), `${id}.autonomia.json`);
const aprobado = (s, etapa) => lista(s.aprobaciones).some((a) => a?.etapa === etapa && typeof a?.frase === 'string' && a.frase.trim());

/** Autonomía de la sesión en curso ({ frase, fecha }) o null. No verifica la frase: eso lo hace quien la usa. */
function autonomiaDeSesion({ env, home }) {
  const id = env?.CLAUDE_CODE_SESSION_ID;
  if (typeof id !== 'string' || !RE_SESION.test(id)) return null;
  try {
    const a = JSON.parse(fs.readFileSync(archivoAutonomia(home, id), 'utf8'));
    return typeof a?.frase === 'string' && a.frase.trim() ? a : null;
  } catch {
    return null;
  }
}

/**
 * Qué le falta al diseño escrito para que una autonomía total o un `ok` lo aprueben, o null si está listo:
 * Exploración y Acotado, ## Diseño y ## Tareas; Arquitectónico, ## Diseño y plan.md (y, con reglas 4.4, ### Criterios
 * centrales).
 */
function faltaDisenoEscrito(raiz, s) {
  const dir = path.join('docs', 'rq', s.codigo);
  if (s.clasificacion !== 'arquitectonico') {
    return disenoEscrito(raiz, s.codigo) ? null : `## Diseño y ## Tareas en ${dir}/spec.md`;
  }
  let spec = '';
  try { spec = fs.readFileSync(path.join(raiz, dir, 'spec.md'), 'utf8'); } catch { /* sin spec */ }
  const falta = [];
  if (!/^## Diseño\b/m.test(spec)) falta.push(`## Diseño en ${dir}/spec.md`);
  if (!fs.existsSync(path.join(raiz, dir, 'plan.md'))) falta.push(`${dir}/plan.md`);
  if (reglas44(s) && !/^#{2,3}\s*Criterios centrales\b/im.test(spec)) falta.push(`### Criterios centrales en ${dir}/spec.md`);
  return falta.length ? falta.join(', ') : null;
}

/**
 * Registra en `s` las decisiones pendientes hasta DEV con la frase: autonomía hasta DEV, la clasificación propuesta, el
 * diseño (si `disenoTodas`, también el de un Arquitectónico con su plan) y la ejecución. Nunca PROD ni saltos.
 * Devuelve { hechos, falta }.
 */
function registrarPendientes(raiz, s, { frase, via, grupo, disenoTodas, ejecucion }) {
  const fecha = ahora();
  const marca = { frase, fecha, via, ...(grupo ? { grupo } : {}) };
  const hechos = [];
  if (!(Number.isInteger(s.autonomia?.hasta) && s.autonomia.hasta >= ETAPA.DEV)) {
    s.autonomia = { hasta: ETAPA.DEV, ...marca };
    hechos.push('autonomía hasta DEV');
  }
  if (s.clasificacion_pendiente === true) {
    s.clasificacion_pendiente = false;
    s.clasificacion_confirmada = { ...marca };
    hechos.push(`clasificación ${nombreDe(s.clasificacion)} confirmada`);
  }
  let falta = '';
  if (!aprobado(s, ETAPA.DISENO)) {
    const faltaDiseno = faltaDisenoEscrito(raiz, s);
    if (s.clasificacion === 'arquitectonico' && !disenoTodas) {
      falta = ' El diseño de un Arquitectónico lo aprueba el usuario: $RQ aprobar 1 "<su frase>", $RQ ok "<su frase>" o la autonomía total.';
    } else if (faltaDiseno) {
      falta = ` Falta ${faltaDiseno} para aprobar el diseño: escribilo y corré $RQ autonomia aplicar --rq ${s.codigo} (o pedile el OK al usuario).`;
    } else {
      s.aprobaciones = [...lista(s.aprobaciones), { etapa: ETAPA.DISENO, ...marca }];
      hechos.push(s.clasificacion === 'arquitectonico' ? 'diseño y plan aprobados' : 'diseño y tareas aprobados');
    }
  }
  if (disenoTodas && !s.ejecucion && aprobado(s, ETAPA.DISENO)) {
    s.ejecucion = { modo: ejecucion ?? 'inline', ...marca };
    hechos.push(`ejecución ${s.ejecucion.modo}`);
  }
  return { hechos, falta };
}

/**
 * Aplica la autonomía de sesión al RQ: autonomía hasta DEV, la clasificación propuesta confirmada y el diseño aprobado
 * si está escrito (salvo en Arquitectónico, que con la autonomía total y reglas 4.4 también entra, con su plan y la
 * ejecución). Nunca PROD ni saltos.
 */
function aplicarAutonomia(repo, env, codigo, aut, io) {
  const raiz = repo.raiz;
  const total = aut.nivel === 'total';
  cambiarVinculado(repo, env, codigo, io, (s) => {
    if (Number.isInteger(s.etapa) && s.etapa >= ETAPA.CIERRE) return `${codigo}: cerrado, sin cambios.`;
    // La frase de la sesión no puede ser una que ya se registró en este RQ para otra decisión.
    if (usosDeFrase(s, aut.frase, { sinSesion: true }) > 0) {
      return `${codigo}: la frase de la autonomía de sesión ya está registrada en este RQ para otra decisión; no se aplica. Pedile al usuario su decisión para este RQ.`;
    }
    // La autonomía total sólo aprueba diseño, plan y ejecución de un Arquitectónico en los RQ con reglas 4.4; en los de la
    // 4.3 se aplica como la de sesión de siempre.
    const conTodo = total && reglas44(s);
    const { hechos, falta } = registrarPendientes(raiz, s, {
      frase: aut.frase, via: conTodo ? 'sesion-total' : 'sesion', disenoTodas: conTodo, ejecucion: aut.ejecucion,
    });
    return `Autonomía ${total ? 'total ' : ''}de sesión en ${codigo}: ${hechos.length ? hechos.join(', ') : 'ya estaba aplicada'}.${falta} PROD sigue pidiendo $RQ aprobar 5.`;
  });
}

/** La frase de la autonomía de la sesión nunca es el OK de PROD ni un salto, aunque el RQ no la tenga registrada. */
function noEsLaAutonomia(frase, verificacion, para) {
  const aut = autonomiaDeSesion(verificacion);
  if (aut && mismaFrase(aut.frase, frase)) {
    throw new ErrorCli(`La frase de la autonomía de la sesión no vale para ${para}: pedile al usuario su decisión con otras palabras (una oración distinta de la que dio la autonomía, por ejemplo nombrando el RQ o la acción: "Publicá ${'<código>'} en PROD").`);
  }
}

/** La frase y el --ejecucion opcional de `ok` y `autonomia total`. */
function fraseYEjecucion(args) {
  const { res, posicionales } = opciones(args, ['ejecucion']);
  const frase = textoNoVacio(posicionales[0], 'La frase');
  const ejecucion = res.ejecucion === undefined ? undefined : MODOS_EJECUCION[String(res.ejecucion).trim().toLowerCase()];
  if (res.ejecucion !== undefined && !ejecucion) throw new ErrorCli(`--ejecucion inválida: "${res.ejecucion}" (inline | subagentes).`);
  return { frase, ejecucion };
}

/** `ok "<frase>"`: una respuesta del usuario registra todo lo pendiente del RQ hasta DEV, como un solo uso de la frase. */
async function okDelUsuario(repo, elegido, args, verificacion, env, io) {
  const { frase, ejecucion } = fraseYEjecucion(args);
  const { codigo, estado } = activo(repo.raiz, elegido);
  if (!reglas44(estado)) throw new ErrorCli(`${codigo} sigue las reglas de la 4.3: \`ok\` no aplica. Pasalo a las de la 4.4 con $RQ reglas actualizar, o registrá cada decisión con su comando (clasificacion, aprobar, ejecucion).`);
  // Una sola respuesta cubre todo hasta DEV: el diseño (y el plan) tienen que estar escritos antes de pedirla; si no, la
  // frase se gastaría en la clasificación y habría que pedir otra para el diseño.
  const faltaDiseno = aprobado(estado, ETAPA.DISENO) ? null : faltaDisenoEscrito(repo.raiz, estado);
  if (faltaDiseno) throw new ErrorCli(`Antes de pedirle el OK al usuario falta ${faltaDiseno}: escribilo y preguntale una sola vez, así su respuesta cubre la clasificación, el diseño, la ejecución y la autonomía hasta DEV.`);
  // Sólo acá vale el tramo inicial de una oración ("Sí, dale"): ver ok.mjs.
  await verificarFrase(frase, verificacion, estado, { flexible: true });
  let nada = false;
  cambiarVinculado(repo, env, codigo, io, (s) => {
    const { hechos, falta } = registrarPendientes(repo.raiz, s, { frase, via: 'ok', grupo: `ok-${ahora()}`, disenoTodas: true, ejecucion });
    if (hechos.length === 0) {
      nada = true;
      return `${codigo}: no hay nada pendiente hasta DEV.${falta}`;
    }
    return `OK registrado en ${codigo}: ${hechos.join(', ')}.${falta} PROD sigue pidiendo $RQ aprobar 5.`;
  });
  if (nada) throw new ErrorCli(`${codigo}: no hay nada pendiente hasta DEV para registrar con ese OK.`);
}

async function autonomiaSesion(repo, frase, verificacion, env, io, { nivel = 'sesion', ejecucion } = {}) {
  const id = idDeSesion(verificacion.env, 'registrar una autonomía de sesión');
  await verificarFrase(frase, verificacion, null);
  // Una frase ya usada para una decisión puntual de un RQ abierto no se vuelve aprobación general.
  for (const codigo of rqsActivos(repo.raiz)) {
    let e;
    try { e = cargarEstado(repo.raiz, codigo); } catch { continue; }
    if (usosDeFrase(e, frase, { sinSesion: true }) > 0) {
      throw new ErrorCli(`La frase "${frase}" ya está registrada en ${codigo} para otra decisión: la autonomía de sesión necesita una frase propia del usuario.`);
    }
  }
  const archivo = archivoAutonomia(verificacion.home, id);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const aut = { frase, fecha: ahora(), repo: repo.raiz, ...(nivel === 'total' ? { nivel, ...(ejecucion ? { ejecucion } : {}) } : {}) };
  fs.writeFileSync(archivo, `${JSON.stringify(aut)}\n`);
  io.stdout.write(nivel === 'total'
    ? 'Autonomía total de la sesión registrada: en los RQ que se abran o retomen en esta sesión confirma la clasificación, aprueba diseño y plan escritos (también en Arquitectónico), registra la ejecución y cubre hasta DEV. Nunca PROD ni saltos.\n'
    : 'Autonomía de la sesión registrada: vale para los RQ que se abran o retomen en esta sesión, hasta DEV (nunca PROD).\n');
  for (const codigo of rqsActivos(repo.raiz)) {
    if (!fs.existsSync(path.join(repo.raiz, 'docs', 'rq', codigo, 'estado.yml'))) continue;
    aplicarAutonomia(repo, env, codigo, aut, io);
  }
}

/** La autonomía de sesión registrada, con la frase verificada otra vez contra lo que escribió el usuario. */
async function autonomiaVerificada(verificacion) {
  const aut = autonomiaDeSesion(verificacion);
  if (!aut) return null;
  await verificarFrase(aut.frase, verificacion, null);
  return aut;
}

// "todos", "ambos", "los 3", "estos RQ", "el lote"…: la frase habla del conjunto.
const RE_COLECTIVO = /(?:^|[^\p{L}])(?:todos|todas|ambos|ambas|lote|(?:los|las|estos|estas)\s+(?:\d+|dos|tres|cuatro|cinco|rq|planes|dise[ñn]os|requerimientos))(?![\p{L}])/iu;

/** ¿La frase nombra el RQ? Por su código o por su último tramo distintivo (APP-UI-VENTAS → "ventas"). */
function fraseNombraRq(frase, codigo) {
  if (nombraCodigo(codigo, frase)) return true;
  const cola = codigo.split(/[-_]/).pop();
  if (!cola || cola.length < 4 || /^\d+$/.test(cola)) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${cola.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(frase);
}

/**
 * `lote aprobar "<frase>" <códigos…>`: con una frase del usuario que nombra cada RQ (o dice "todos"), confirma la
 * clasificación propuesta y aprueba el diseño de cada uno que tenga ## Diseño y ## Tareas (y plan.md en
 * Arquitectónico). Los RQ que no están en este checkout (viven en su rama) se aprueban corriendo lo mismo ahí.
 */
async function loteAprobar(repo, args, verificacion, env, io) {
  const raiz = repo.raiz;
  const [accion, frase, ...codigos] = args;
  if (accion !== 'aprobar' || codigos.length === 0) throw new ErrorUso();
  textoNoVacio(frase, 'La frase');
  const unicos = [...new Set(codigos)];
  for (const c of unicos) if (!RE_CODIGO.test(c)) throw new ErrorCli(`Código inválido: "${c}".`);
  const sinNombrar = unicos.filter((c) => !fraseNombraRq(frase, c));
  if (sinNombrar.length && !RE_COLECTIVO.test(frase)) {
    throw new ErrorCli(`La frase no nombra ${sinNombrar.join(', ')} ni habla del conjunto ("todos", "ambos", "los 3"…): para aprobar un lote, el usuario tiene que nombrar los RQ o decir que son todos.`);
  }
  const aca = [];
  const enOtraRama = [];
  for (const c of unicos) {
    let estado;
    try {
      estado = cargarEstado(raiz, c);
    } catch (e) {
      if (String(e.message).startsWith('ESTADO_INEXISTENTE')) { enOtraRama.push(c); continue; }
      throw e;
    }
    if (Number.isInteger(estado.etapa) && estado.etapa >= ETAPA.CIERRE) throw new ErrorCli(`${c} está cerrado: sacalo del lote.`);
    if (!disenoEscrito(raiz, c)) throw new ErrorCli(`${c}: falta ## Diseño y ## Tareas en docs/rq/${c}/spec.md; el lote aprueba diseños ya escritos.`);
    if (estado.clasificacion === 'arquitectonico' && !fs.existsSync(path.join(raiz, 'docs', 'rq', c, 'plan.md'))) {
      throw new ErrorCli(`${c} es Arquitectónico: falta docs/rq/${c}/plan.md.`);
    }
    aca.push({ c, estado });
  }
  if (aca.length === 0) throw new ErrorCli(`Ninguno de ${unicos.join(', ')} está en este checkout: corré el lote desde la rama de cada RQ (rq/<código>).`);
  // Todo o nada en este checkout: primero se verifican todas las frases.
  for (const { estado } of aca) await verificarFrase(frase, verificacion, estado);
  for (const { c } of aca) {
    cambiarVinculado(repo, env, c, io, (s) => {
      const fecha = ahora();
      const hechos = [];
      if (s.clasificacion_pendiente === true) {
        s.clasificacion_pendiente = false;
        s.clasificacion_confirmada = { frase, fecha, via: 'lote' };
        hechos.push(`clasificación ${nombreDe(s.clasificacion)} confirmada`);
      }
      if (!aprobado(s, ETAPA.DISENO)) {
        s.aprobaciones = [...lista(s.aprobaciones), { etapa: ETAPA.DISENO, frase, fecha, via: 'lote' }];
        hechos.push('diseño y plan aprobados');
      }
      return `Lote: ${c} ${hechos.length ? hechos.join(', ') : 'ya estaba aprobado'}.`;
    });
  }
  if (enOtraRama.length) {
    io.stdout.write(`No están en este checkout: ${enOtraRama.join(', ')}. Desde la rama de cada uno, la misma frase: $RQ lote aprobar "<frase>" ${unicos.join(' ')}.\n`);
  }
}

/** `skills importar`: las skills cargadas en esta sesión (según su transcripción) quedan anotadas en el RQ. */
async function importarSkills(repo, elegido, verificacion, env, io, { silencioso = false } = {}) {
  const raiz = repo.raiz;
  const { id, skills, ultimoUso } = await transcriptDeLaSesion(verificacion, 'importar las skills de la sesión');
  const { codigo, estado } = activo(raiz, elegido);
  // Pasadas de revisión corridas otra vez después de la última revisión: se anotan con su hora (como lo hace el hook).
  const desde = estado.revision?.fecha;
  const corta = (x) => String(x).split(':').pop().toLowerCase();
  const repetidas = typeof desde !== 'string' ? [] : PASADAS_REVISION.flatMap((p) => {
    const uso = [...(ultimoUso ?? new Map())].find(([n, t]) => corta(n) === corta(p) && t > desde);
    const anotada = lista(estado.skills).some((x) => corta(nombreSkillDe(x)) === corta(p) && typeof x?.fecha === 'string' && x.fecha > desde);
    return uso && !anotada ? [{ skill: uso[0], fecha: uso[1] }] : [];
  });
  if (repetidas.length) {
    cambiarVinculado(repo, env, codigo, silencioso ? { stdout: { write() {} } } : io, (s) => {
      s.skills = [...lista(s.skills), ...repetidas.map((r) => ({ ...r, etapa: etapaDerivada(s, raiz), sesion: id, via: 'sesion' }))];
      return `${codigo}: pasadas de revisión corridas otra vez, anotadas (${repetidas.map((r) => r.skill).join(', ')}).`;
    });
  }
  const nuevas = [...skills].filter((s) => !tieneSkill(estado, s));
  if (nuevas.length === 0) {
    if (!silencioso && !repetidas.length) io.stdout.write(`${codigo}: no hay skills de esta sesión para sumar.\n`);
    return;
  }
  cambiarVinculado(repo, env, codigo, silencioso ? { stdout: { write() {} } } : io, (s) => {
    const fecha = ahora();
    const etapa = etapaDerivada(s, raiz);
    const faltan = nuevas.filter((x) => !tieneSkill(s, x));
    s.skills = [...lista(s.skills), ...faltan.map((skill) => ({ skill, etapa, sesion: id, fecha, via: 'sesion' }))];
    return `${codigo}: ${faltan.length} skill(s) de esta sesión anotadas (${faltan.join(', ')}).`;
  });
  if (silencioso) io.stdout.write(`Skills de esta sesión anotadas en ${codigo}: ${nuevas.join(', ')}.\n`);
}

/** RQ abiertos (estado.yml legible y etapa < cierre) que hay en el árbol: [{ codigo, actualizado }]. */
function rqsAbiertosEnArbol(raiz) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(path.join(raiz, 'docs', 'rq'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out = [];
  for (const codigo of dirs.filter((d) => RE_CODIGO.test(d))) {
    try {
      const e = cargarEstado(raiz, codigo);
      if (!(Number.isInteger(e.etapa) && e.etapa >= ETAPA.CIERRE)) out.push({ codigo, actualizado: String(e.actualizado ?? '') });
    } catch {
      // sin estado.yml legible: no es un RQ abierto
    }
  }
  return out;
}

/** Texto crudo de docs/rq/ACTIVO ('' si no existe). */
function textoActivo(raiz) {
  try {
    return fs.readFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'utf8');
  } catch {
    return '';
  }
}

/** Avisos sobre ACTIVO: marcas de conflicto, RQ cerrados o que no están en el árbol. */
function avisosActivo(raiz) {
  const texto = textoActivo(raiz);
  if (!texto) return [];
  if (/^(?:<{7}|={7}|>{7})/m.test(texto)) return ['Aviso: docs/rq/ACTIVO tiene marcas de conflicto de un merge: $RQ activo reparar.'];
  const abiertos = new Set(rqsAbiertosEnArbol(raiz).map((x) => x.codigo));
  const sobran = rqsActivos(raiz).filter((c) => !abiertos.has(c));
  return sobran.length ? [`Aviso: docs/rq/ACTIVO lista ${sobran.join(', ')}, que acá están cerrados o no existen: $RQ activo reparar.`] : [];
}

/** `activo reparar`: ACTIVO = los RQ abiertos del árbol (en el orden que tenían; los nuevos, por fecha), y si estaba en conflicto, resuelto. */
function repararActivo(raiz, io) {
  const previos = rqsActivos(raiz);
  const abiertos = rqsAbiertosEnArbol(raiz);
  const set = new Set(abiertos.map((x) => x.codigo));
  const quedan = previos.filter((c) => set.has(c));
  const nuevos = abiertos.filter((x) => !quedan.includes(x.codigo)).sort((a, b) => a.actualizado.localeCompare(b.actualizado)).map((x) => x.codigo);
  const final = [...quedan, ...nuevos];
  const conflicto = /^(?:<{7}|={7}|>{7})/m.test(textoActivo(raiz));
  guardarActivos(raiz, final);
  const l = [`docs/rq/ACTIVO: ${final.length ? final.join(', ') : 'vacío (borrado)'}.`];
  const quitados = previos.filter((c) => !set.has(c));
  if (quitados.length) l.push(`Quitados (cerrados o sin estado.yml acá): ${quitados.join(', ')}.`);
  if (nuevos.length) l.push(`Sumados (abiertos en el árbol): ${nuevos.join(', ')}.`);
  const sinFusionar = spawnSync('git', ['ls-files', '-u', '--', 'docs/rq/ACTIVO'], { cwd: raiz, encoding: 'utf8' });
  if (sinFusionar.status === 0 && sinFusionar.stdout.trim()) {
    const r = final.length
      ? spawnSync('git', ['add', '--', 'docs/rq/ACTIVO'], { cwd: raiz, encoding: 'utf8' })
      : spawnSync('git', ['rm', '-q', '--cached', '--ignore-unmatch', '--', 'docs/rq/ACTIVO'], { cwd: raiz, encoding: 'utf8' });
    l.push(r.status === 0 ? 'Conflicto de docs/rq/ACTIVO resuelto en el índice.' : `No pude marcar el conflicto como resuelto: ${String(r.stderr).trim()}`);
  } else if (conflicto) l.push('Tenía marcas de conflicto: quedó limpio.');
  io.stdout.write(`${l.join('\n')}\n`);
}

/**
 * Al abrir o retomar un RQ dentro de una sesión de Claude Code: las skills ya cargadas en la sesión quedan en el RQ y,
 * si la sesión tiene autonomía registrada, se aplica. Nada de esto frena el abrir: un problema queda como aviso.
 */
async function alAbrirEnSesion(repo, env, codigo, io, verificacion) {
  if (typeof verificacion?.env?.CLAUDE_CODE_SESSION_ID !== 'string') return;
  try {
    await importarSkills(repo, codigo, verificacion, env, io, { silencioso: true });
  } catch (e) {
    io.stderr.write(`Aviso: no pude anotar las skills de la sesión (${e.message}).\n`);
  }
  try {
    const aut = await autonomiaVerificada(verificacion);
    if (aut) aplicarAutonomia(repo, env, codigo, aut, io);
  } catch (e) {
    io.stderr.write(`Aviso: la autonomía de la sesión no se aplicó (${e.message}).\n`);
  }
}

function msgCambiosAjenos(codigo, ajenos) {
  const porRq = new Map();
  for (const a of ajenos) porRq.set(a.codigo, [...(porRq.get(a.codigo) ?? []), a.ruta]);
  const l = [`Hay cambios sin commitear de otro RQ que pasarían a ${ramaDelRq(codigo)} con el cambio de rama:`];
  for (const [c, rutas] of porRq) l.push(`  - ${c}: ${rutas.join(', ')}`);
  l.push('Dejalos en su RQ antes de abrir éste: commitealos en su rama (git switch ' + ramaDelRq([...porRq.keys()][0]) + ' y $RQ commit … --rq <código>) o guardalos aparte:');
  for (const c of porRq.keys()) l.push(`  git stash push -m "${c}" -- "docs/rq/${c}"`);
  l.push('Si el usuario decide que van con este RQ: $RQ abrir … --llevar-cambios.');
  return l.join('\n');
}

/** Clasificación propuesta, lo que implica y cómo confirmarla (M2). */
function imprimirClasificacion(estado, io) {
  const c = estado.clasificacion;
  const pendiente = estado.clasificacion_pendiente === true;
  const l = [];
  // PLG-CLOUD (hallazgo 19): lo que frena a un Arquitectónico, primero y no al final de la salida.
  if (c === 'arquitectonico') {
    l.push(`Arquitectónico: no se edita código hasta que el diseño y el plan estén escritos (spec.md con ## Diseño y ### Criterios centrales, plan.md) y aprobados: ${reglas44(estado) ? '$RQ ok "<frase>" del usuario, $RQ aprobar 1, o la autonomía total de la sesión' : '$RQ aprobar 1 "<frase>"'}. Una autonomía de sesión común no alcanza.`);
  }
  l.push(`Clasificación propuesta: ${nombreDe(c)}${pendiente ? ' (pendiente de confirmar por el usuario)' : ''}.`);
  for (const x of implicancias(c, estado.tipo)) l.push(`  - ${x}`);
  if (pendiente) {
    l.push('Proponésela al usuario con su motivo; hasta que la confirme no se edita código. Con su respuesta: $RQ clasificacion confirmar "<su frase>" o $RQ clasificacion cambiar <exploracion|acotado|arquitectonico> "<su frase>".');
  }
  io.stdout.write(`${l.join('\n')}\n`);
}

function cambiar(raiz, elegido, io, fn) {
  const { estado } = activo(raiz, elegido);
  const msg = fn(estado);
  guardar(raiz, estado);
  io.stdout.write(`${msg}\n`);
  return estado;
}

/** cambiar() y, si el RQ está activo en otros repos del proyecto (RQ multi-repo), el mismo cambio en ellos. */
function cambiarVinculado(repo, env, elegido, io, fn) {
  const estado = cambiar(repo.raiz, elegido, io, fn);
  const tocados = espejar(repo.raiz, repo.proyectoId, proyectoDe(repo, env), estado.codigo, (s) => { fn(s); });
  if (tocados.length) io.stdout.write(`RQ multi-repo: también en ${tocados.join(', ')}.\n`);
}

/** Todo lo que hay en stage (libre o no, con los borrados; una movida cuenta como borrado y alta), relativo a la raíz. */
function todoEnStage(raiz) {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z', '--relative'], {
      cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\0').filter(Boolean);
  } catch {
    return [];
  }
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

/** ¿Hay cambios sin stagear en archivos trackeados? Lo que escribe la propia CLI (estado.yml, ACTIVO, backlog) no cuenta. */
function hayCambiosSinStage(raiz) {
  const r = spawnSync('git', ['diff', '--name-only', '-z'], { cwd: raiz, encoding: 'utf8' });
  if (r.status !== 0) throw new ErrorCli(`git diff falló: ${String(r.stderr || r.error?.message).trim()}`);
  return r.stdout.split('\0').filter(Boolean).some((f) => !esPropioDeLaCli(f));
}

/** Deja en stage lo que escribe la CLI (estado.yml del RQ, ACTIVO y backlog) si existe y cambió. */
function stagearPropiosDeLaCli(raiz, codigo) {
  const rutas = [`docs/rq/${codigo}/estado.yml`, 'docs/rq/ACTIVO', 'docs/backlog.md'].filter((p) => fs.existsSync(path.join(raiz, p)));
  for (const p of rutas) {
    const st = spawnSync('git', ['status', '--porcelain', '--', p], { cwd: raiz, encoding: 'utf8' });
    if (st.status !== 0 || !st.stdout.trim()) continue;
    const add = spawnSync('git', ['add', '--', p], { cwd: raiz, encoding: 'utf8' });
    if (add.status !== 0) throw new ErrorCli(`No pude dejar ${p} en stage (git add): ${String(add.stderr || add.error?.message).trim()}`);
  }
}

/** PLG-DFF (pedido 6): ¿spec.md del RQ ya trae `## Diseño` y `## Tareas`? */
function disenoEscrito(raiz, codigo) {
  try {
    const t = fs.readFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), 'utf8');
    return /^## Diseño\b/m.test(t) && /^## Tareas\b/m.test(t);
  } catch {
    return false;
  }
}

// Exploración y Acotado van en línea salvo que el usuario elija otra cosa (PLG-DFF, pedido 6).
const EN_LINEA_POR_DEFECTO = ['spike', 'bounded'];

const MODOS_EJECUCION = { inline: 'inline', 'executing-plans': 'inline', subagentes: 'subagentes', 'subagent-driven-development': 'subagentes' };

const MSG_EJECUCION = 'Antes del primer commit, preguntale al usuario cómo ejecutar el plan (executing-plans en línea o subagent-driven-development) y registralo: $RQ ejecucion inline|subagentes "<su frase>".';

/** ¿El RQ ya tiene algún commit propio con archivos de producto (no docs ni tests)? */
function hayCommitDeCodigo(raiz, codigo, estado, proyecto) {
  return commitsDelRq(raiz, codigo, estado).some((h) =>
    (salida(raiz, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', h]) ?? '').split('\n').some((r) => r && tipoArchivo(r, proyecto) !== 'libre'));
}

/**
 * Sin brainstorming (y, según el tipo, causa, tareas o plan): no se commitea código. Y antes del primer commit de
 * código (salvo Exploración y Acotado, que van en línea) el usuario eligió cómo se ejecuta el plan.
 */
function exigirDesarrollo(estado, raiz, proyecto) {
  const falta = faltaParaEtapa(estado, ETAPA.DESARROLLO, raiz);
  if (falta.length) throw new ErrorCli(`Antes de commitear código del ${estado.codigo} falta: ${falta.join('; ')}. Si el usuario decide saltearlo: $RQ saltar skills "<frase>" "<motivo>".`);
  if (!EN_LINEA_POR_DEFECTO.includes(estado.clasificacion) && !estado.ejecucion && !hayCommitDeCodigo(raiz, estado.codigo, estado, proyecto)) throw new ErrorCli(MSG_EJECUCION);
}

// PLG-TEST-INFRA: mensajes del rechazo según la clase de la falla (claseFalla) cuando el reintento tampoco pasó.
const MSG_CLASE = {
  infraestructura: 'Falla de infraestructura del runner, no de tests (todos pasaron dos veces y el runner cortó con error). Bajá la carga de la PC (E2E, servidores) o corré sólo los tests relacionados.',
  timeout: 'Tests que superan su tiempo dos veces seguidas: revisá el límite del test (testTimeout) o la carga de la PC.',
};
const pistaRelacionados = (raiz) => {
  const sugerido = comandoRelacionado(raiz);
  return `Pista: con {archivos} en tests.unit el commit corre sólo los tests relacionados con lo que está en stage${sugerido ? ` (${sugerido})` : ' (con la opción de tu runner que corre los tests de esas rutas)'}.`;
};

/**
 * Corre los tests de commit sobre lo que está en stage y los registra en estado.tests. Si todo sale bien imprime una
 * línea; si falla, la cola de la salida. No guarda el estado (lo guarda quien llama). Devuelve el código de salida.
 */
function correrTests(raiz, estado, proyecto, io, { silencioso = false, env = process.env } = {}) {
  const comandos = comandosTests(proyecto);
  if (comandos.length === 0) {
    throw new ErrorCli(`El proyecto no declara comandos de tests en proyecto.yml. ${PISTA_SIN_TESTS}`);
  }
  const arbol = arbolTesteado(raiz);
  const archivos = enStageDeProducto(raiz, proyecto);
  const conocidos = rojosConocidos(proyecto);
  const corridos = [];
  const rojos = [];
  const inestables = [];
  let rechazo = null;
  let codigo = 0;
  for (const base of comandos) {
    const cmd = conArchivos(rutasEn(base, raiz, proyecto), archivos);
    if (cmd === null) continue;
    corridos.push(cmd);
    const correr = () => spawnSync(cmd, { shell: shellDeTests(proyecto), cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    let r = correr();
    if (r.error) io.stderr.write(`No pude ejecutar "${cmd}": ${r.error.message}\n`);
    if (r.status === 0) continue;
    let salidaTest = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    let fallos = fallosDe(salidaTest);
    if (soloRojosConocidos(fallos, conocidos)) {
      rojos.push(...fallos);
      continue;
    }
    // PLG-TEST-INFRA: lo que no es un test rojo (el runner cortó con todo en verde, o sólo hubo timeouts) se
    // reintenta una vez; si pasa, queda anotado como inestable.
    let clase = claseFalla(salidaTest);
    if (clase !== 'rojo' && !r.error && env.BACG_DEV_SIN_REINTENTO !== '1') {
      io.stdout.write(`Falla de ${clase === 'timeout' ? 'tiempo (timeout)' : 'infraestructura del runner'}, no de un test rojo: reintento una vez "${cmd}".\n`);
      const primera = fallos;
      r = correr();
      if (r.error) io.stderr.write(`No pude ejecutar "${cmd}" (reintento): ${r.error.message}\n`);
      const inestable = { fecha: ahora(), clase, comando: cmd, ...(primera.length ? { tests: primera } : {}) };
      if (r.status === 0) {
        inestables.push(inestable);
        continue;
      }
      salidaTest = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
      fallos = fallosDe(salidaTest);
      if (soloRojosConocidos(fallos, conocidos)) {
        inestables.push(inestable);
        rojos.push(...fallos);
        continue;
      }
      clase = claseFalla(salidaTest);
    }
    io.stdout.write(`${resumenFalla(salidaTest, 60, { id: `tests-${estado.codigo}` })}\n`);
    if (MSG_CLASE[clase]) io.stdout.write(`${MSG_CLASE[clase]}${/\{archivos\}/.test(base) ? '' : ` ${pistaRelacionados(raiz)}`}\n`);
    rechazo = clase;
    codigo = r.status ?? 1;
    break;
  }
  const previos = estado.tests ?? {};
  estado.tests = { ok: codigo === 0, arbol, fecha: ahora(), comandos: corridos };
  if (rojos.length) estado.tests.rojos_conocidos = [...new Set(rojos)];
  const todosInestables = [...(previos.inestables ?? []), ...inestables];
  if (todosInestables.length) estado.tests.inestables = todosInestables.slice(-20);
  const rechazos = { ...(previos.rechazos ?? {}) };
  if (rechazo) rechazos[rechazo] = (rechazos[rechazo] ?? 0) + 1;
  if (Object.keys(rechazos).length) estado.tests.rechazos = rechazos;
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
  if (enStageDeProducto(raiz, proyecto).length) exigirDesarrollo(estado, raiz, proyecto);
  const r = correrTests(raiz, estado, proyecto, io, { env });
  guardar(raiz, estado);
  stagearPropiosDeLaCli(raiz, estado.codigo);
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
  if (etapaDerivada(estado, raiz) > ETAPA.DISENO || commitsDelRq(raiz, codigo, estado).length > 0) return;
  const head = commitHead(raiz);
  if (head && head !== estado.base) estado.base = head;
}

/**
 * git add -A de las rutas. Si alguna está en .gitignore, git no agrega nada: se reintenta ruta por ruta y de las
 * ignoradas se toman los cambios de lo ya trackeado (git add -u); una ignorada y sin trackear es un error.
 */
function agregarRutas(raiz, rutas) {
  const add = spawnSync('git', ['add', '-A', '--', ...rutas], { cwd: raiz, encoding: 'utf8' });
  if (add.status === 0) return;
  for (const ruta of rutas) {
    const una = spawnSync('git', ['add', '-A', '--', ruta], { cwd: raiz, encoding: 'utf8' });
    if (una.status === 0) continue;
    const ignorada = spawnSync('git', ['check-ignore', '-q', '--no-index', '--', ruta], { cwd: raiz }).status === 0;
    if (!ignorada) throw new ErrorCli(`git add falló: ${String(una.stderr).trim()}`);
    const trackeada = spawnSync('git', ['ls-files', '--', ruta], { cwd: raiz, encoding: 'utf8' }).stdout.trim() !== '';
    if (!trackeada) throw new ErrorCli(`${ruta} está en .gitignore y no está trackeada: sacala de las rutas o forzala a mano con git add -f.`);
    const u = spawnSync('git', ['add', '-u', '--', ruta], { cwd: raiz, encoding: 'utf8' });
    if (u.status !== 0) throw new ErrorCli(`git add falló: ${String(u.stderr).trim()}`);
  }
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
  agregarRutas(raiz, rutas);
  rebasarSiNoEmpezo(raiz, codigo, estado);
  const producto = enStageDeProducto(raiz, proyecto);
  const protegida = enRamaProtegida(raiz, proyecto);
  if (protegida && producto.length && !saltoValido(estado, 'rama')) {
    throw new ErrorCli(`${protegida} sólo recibe cambios por PR: el código del RQ va en su rama. Pasá a ${ramaDelRq(codigo)} (git switch -c ${ramaDelRq(codigo)}; los cambios en stage viajan con el switch) y volvé a commitear.`);
  }
  let tests = 'sólo docs y tests: sin correr tests';
  if (fueraDeSonda(estado, todoEnStage(raiz))) throw new ErrorCli(MSG_EXPLORACION_FUERA(codigo));
  if (producto.length && saltoValido(estado, 'commit')) tests = 'tests salteados (saltar commit)';
  else if (producto.length) {
    exigirDesarrollo(estado, raiz, proyecto);
    const aparte = hayCambiosSinStage(raiz);
    if (aparte) {
      const st = spawnSync('git', ['stash', 'push', '-q', '--keep-index', '-m', `rq.mjs commit ${codigo}`], { cwd: raiz, encoding: 'utf8' });
      if (st.status !== 0) throw new ErrorCli(`No pude guardar aparte los cambios sin stagear (git stash): ${String(st.stderr).trim()}`);
    }
    let r;
    try {
      r = correrTests(raiz, estado, proyecto, io, { silencioso: true, env });
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
function specsDelRq(raiz, estado, proyecto) {
  const esSpec = (r) => r.startsWith('e2e/') || /\.spec\.[cm]?[jt]sx?$/.test(r);
  const rutas = rutasDelRq(raiz, estado) ?? [];
  // PLG-E2E-ALC: tests.e2e_mapa ({ "<glob de código>": ["<spec>", …] }) suma los specs de la pantalla tocada.
  const mapa = proyecto?.tests?.e2e_mapa && typeof proyecto.tests.e2e_mapa === 'object' ? proyecto.tests.e2e_mapa : {};
  const delMapa = Object.entries(mapa)
    .filter(([glob]) => rutas.some((r) => globARegExp(glob).test(r)))
    .flatMap(([, specs]) => lista(specs).filter((x) => typeof x === 'string'));
  return [...new Set([...rutas.filter(esSpec), ...delMapa])].filter((r) => fs.existsSync(path.join(raiz, r)));
}

/** PLG-E2E-ALC: aviso si la suite E2E completa se corrió más de una vez antes de PROD (null si no corresponde). */
function avisoE2eCompletos(estado) {
  const n = Number(estado?.e2e_completos) || 0;
  return n > 1 && Number(estado?.etapa ?? 0) < ETAPA.PROD
    ? `Corriste la suite E2E completa ${n} veces: va una sola, justo antes de pedir el OK de PROD; mientras tanto, los specs del RQ.`
    : null;
}

/** Duración legible de una corrida: "850 ms", "42s", "3m 12s". */
function duracion(ms) {
  if (ms < 1000) return `${ms} ms`;
  const seg = Math.round(ms / 1000);
  return seg < 60 ? `${seg}s` : `${Math.floor(seg / 60)}m ${seg % 60}s`;
}

/** Verificación local con el rol real (M1): qué se recorrió y capturas que existan bajo docs/rq/<código>/qa/. */
function verificarLocal(repo, elegido, que, capturas, env, io) {
  const raiz = repo.raiz;
  const { codigo } = activo(raiz, elegido);
  textoNoVacio(que, 'Lo que se recorrió');
  if (capturas.length === 0) {
    throw new ErrorCli(`La verificación local necesita al menos una captura, guardada en docs/rq/${codigo}/qa/ ($RQ verificar --local "<qué se recorrió>" docs/rq/${codigo}/qa/<archivo>.png).`);
  }
  const carpeta = path.join(raiz, 'docs', 'rq', codigo, 'qa');
  const rel = [];
  for (const c of capturas) {
    const abs = path.resolve(raiz, c);
    const dentro = path.relative(carpeta, abs);
    if (dentro === '' || dentro.startsWith('..') || path.isAbsolute(dentro)) {
      throw new ErrorCli(`La captura "${c}" no está en docs/rq/${codigo}/qa/: guardala ahí.`);
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new ErrorCli(`La captura "${c}" no existe.`);
    rel.push(path.relative(raiz, abs).split(path.sep).join('/'));
  }
  // 4.4 (cambio 1 y lección 13): con UI, las capturas a 390, 768 y 1280 y, si hay referencia, la de la referencia.
  const estadoRq = activo(raiz, elegido).estado;
  if (reglas44(estadoRq) && tocaUi(estadoRq, raiz, proyectoDe(repo, env), rutasDelRq(raiz, estadoRq))) {
    const faltan = faltasCapturas(rel, refExigida(raiz, codigo));
    if (faltan.length) throw new ErrorCli(`La verificación local de un RQ con UI necesita también: ${faltan.join('; ')}. Guardalas en docs/rq/${codigo}/qa/ y pasalas todas.`);
  }
  cambiarVinculado(repo, env, elegido, io, (s) => {
    s.verificacion_local = { que: que.trim(), capturas: rel, fecha: ahora() };
    return `Verificación local de ${codigo} registrada (${rel.length} captura(s)).`;
  });
  return 0;
}

/**
 * Specs pasados por ruta, como los espera el runner: con barras `/` y, si la ruta es absoluta y está dentro de la
 * carpeta del script de tests.e2e (donde suele estar la config de Playwright), relativa a esa carpeta. Playwright
 * toma cada argumento como filtro y una ruta absoluta de Windows no coincide con nada ("No tests found").
 */
function specsParaElComando(specs, comando) {
  const script = scriptDelComando(comando);
  const dir = script && path.isAbsolute(script) ? path.dirname(script) : null;
  return specs.map((s) => {
    const abs = path.isAbsolute(s) ? path.resolve(s) : null;
    if (abs && dir) {
      const rel = path.relative(dir, abs);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
    }
    return s.replace(/\\/g, '/');
  });
}

/** Archivos con cambios bajo docs/rq/<otro>/qa/ (otro RQ que no es `rq`): Map ruta → 'M' (trackeado) | '?' (nuevo). */
function qaDeOtrosRq(raiz, rq) {
  const out = new Map();
  const r = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all', '--', 'docs/rq'], { cwd: raiz, encoding: 'utf8' });
  if (r.status !== 0) return null;
  for (const linea of r.stdout.split('\0').filter(Boolean)) {
    const ruta = linea.slice(3);
    const m = /^docs\/rq\/([^/]+)\/qa\//.exec(ruta);
    if (!m || m[1] === rq) continue;
    out.set(ruta, linea.startsWith('??') ? '?' : 'M');
  }
  return out;
}

/**
 * Los specs de regresión de otros RQ escriben sus capturas en docs/rq/<otro>/qa/: lo que la corrida cambió ahí (y
 * estaba limpio antes) vuelve a como estaba, y lo nuevo se borra. Devuelve cuántos archivos tocó.
 */
function restaurarQaAjena(raiz, rq, antes) {
  if (!antes) return 0;
  const despues = qaDeOtrosRq(raiz, rq);
  if (!despues) return 0;
  const volver = [];
  let n = 0;
  for (const [ruta, tipo] of despues) {
    if (antes.has(ruta)) continue;
    if (tipo === 'M') volver.push(ruta);
    else {
      try {
        fs.rmSync(path.join(raiz, ruta), { force: true });
        n += 1;
      } catch {
        // queda para descartar a mano
      }
    }
  }
  if (volver.length) {
    const r = spawnSync('git', ['checkout', '--', ...volver], { cwd: raiz, encoding: 'utf8' });
    if (r.status === 0) n += volver.length;
  }
  return n;
}

/**
 * Corre tests.e2e del proyecto y registra el resultado contra HEAD. Si el comando trae {specs}, corre los specs dados
 * o los del RQ; --completo (o ningún spec) corre la suite entera, que es la que exige publicar en PROD.
 */
function verificar(repo, elegido, args, env, io) {
  const raiz = repo.raiz;
  const { res, posicionales } = opciones(args, ['local'], ['completo']);
  const { codigo: rq, estado } = activo(raiz, elegido);
  if (res.local !== undefined) return verificarLocal(repo, elegido, res.local, posicionales, env, io);
  const proyecto = proyectoDe(repo, env);
  const base = comandoE2e(proyecto);
  if (!base) {
    throw new ErrorCli(
      'El proyecto no declara tests.e2e en proyecto.yml. Declaralo (y tests.e2e_url) o, si el cambio no tiene superficie de app, que el usuario lo diga y registrá saltar e2e.',
    );
  }
  const conSpecsEnComando = base.includes('{specs}');
  const specs = res.completo || !conSpecsEnComando ? [] : posicionales.length ? specsParaElComando(posicionales, rutasEn(base, raiz, proyecto)) : specsDelRq(raiz, estado, proyecto);
  // Con {specs}, sin --completo y sin specs deducibles del diff (p. ej. viven fuera del repo): no se corre la suite
  // entera sin que nadie lo pida.
  if (conSpecsEnComando && !res.completo && specs.length === 0) {
    throw new ErrorCli(`tests.e2e corre specs sueltos ({specs}) y no encontré specs E2E del RQ ${rq} en su diff (e2e/** o *.spec.*) ni en tests.e2e_mapa. Pasá el spec de la pantalla que tocaste: $RQ verificar <ruta del spec>… (o declaralo en tests.e2e_mapa: { "<glob del código>": ["<spec>"] }). La suite completa ($RQ verificar --completo) va una sola vez, justo antes de pedir el OK de PROD.`);
  }
  let cmd;
  try {
    cmd = conSpecs(rutasEn(base, raiz, proyecto), specs);
  } catch (e) {
    if (e instanceof ErrorCli) throw e;
    throw new ErrorCli(e.message);
  }
  const completo = specs.length === 0;
  const url = proyecto?.tests?.e2e_url;
  // Una sola corrida E2E a la vez por proyecto en esta PC: comparten app, contenedor y artefactos.
  const lock = lockE2e(repo.proyectoId);
  if (!intentarLock(lock, `verificar ${rq}`, { datos: { rq, firma: firmaE2e(base), comando: cmd } })) {
    throw new ErrorCli(msgE2eEnCurso(lockTomado(lock)));
  }
  let r;
  let tardo = 0;
  const antes = qaDeOtrosRq(raiz, rq);
  try {
    const envE2e = { ...process.env, ...env, BACG_E2E_LOCK: lock, ...(url ? { E2E_URL: String(url), BASE_URL: String(url) } : {}) };
    const t0 = Date.now();
    r = spawnSync(cmd, { shell: shellDeTests(proyecto), cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: envE2e });
    tardo = Date.now() - t0;
  } finally {
    soltarLock(lock);
  }
  const restauradas = restaurarQaAjena(raiz, rq, antes);
  if (restauradas) io.stdout.write(`Capturas de otros RQ que regeneró la corrida, devueltas a como estaban: ${restauradas}.\n`);
  if (r.error) io.stderr.write(`No pude ejecutar "${cmd}": ${r.error.message}\n`);
  // Playwright sin specs que coincidan: no es un E2E fallido del RQ, es una ruta mal pasada. No se registra.
  if (r.status !== 0 && specs.length && /No tests found/i.test(`${r.stdout ?? ''}\n${r.stderr ?? ''}`)) {
    // PLG-CLOUD (hallazgo 13): un spec guardado en docs/rq/<código>/qa/ queda fuera del testDir del runner.
    const enQa = specs.some((s) => /(?:^|[\\/])docs[\\/]rq[\\/][^\\/]+[\\/]qa[\\/]/.test(s));
    throw new ErrorCli(`El runner no encontró tests con ${specs.map((s) => `"${s}"`).join(' ')} (No tests found). No se registró el E2E. Pasá la ruta del spec como la espera el runner de tests.e2e (relativa a su carpeta, p. ej. e2e/<spec>.spec.ts).${enQa ? ' El spec está en docs/rq/<código>/qa/, fuera del testDir de Playwright: el spec vive en la carpeta de E2E del proyecto (ahí corre y queda para regresión); en qa/ van las capturas y, si querés, una copia.' : ''}`);
  }
  const ok = r.status === 0;
  if (!ok) io.stdout.write(`${resumenFalla(`${r.stdout ?? ''}\n${r.stderr ?? ''}`, 80, { id: `e2e-${rq}` })}\n`);
  estado.e2e = { ok, fecha: ahora(), comando: cmd, head: commitHead(raiz), completo };
  // PLG-SP: un rojo del E2E (no una corrida que no pudo arrancar) hace que la revisión pida systematic-debugging.
  if (!ok && !r.error) estado.e2e_rojos = (Number(estado.e2e_rojos) || 0) + 1;
  // PLG-E2E-ALC: las corridas completas pedidas a propósito (con {specs} en el comando) se cuentan: va una antes de PROD.
  if (conSpecsEnComando && res.completo && !r.error) estado.e2e_completos = (Number(estado.e2e_completos) || 0) + 1;
  guardar(raiz, estado);
  const alcance = !conSpecsEnComando
    ? 'suite completa: tests.e2e no usa {specs}, así que cada verificar corre todo'
    : completo ? 'suite completa' : `${specs.length} spec(s) del RQ; antes de PROD: $RQ verificar --completo`;
  io.stdout.write(`E2E de ${rq} ${ok ? 'ok' : 'falló'} en ${duracion(tardo)} (${alcance}${url ? `, app ${url}` : ''}).\n`);
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
// mostraba la etapa de PROD de un RQ que en main ya estaba cerrado). Avisos para estado y entregar.
function avisosDeAtraso(raiz, codigo, estado) {
  const avisos = [];
  const principal = refPrincipal(raiz);
  for (const ref of new Set([salida(raiz, ['rev-parse', '--abbrev-ref', '@{u}']), principal].filter(Boolean))) {
    const n = detrasDe(raiz, ref);
    if (n > 0) avisos.push(`Aviso: la rama está ${n} commit(s) detrás de ${ref} (según el último fetch): actualizala (git merge ${ref}) antes de seguir; lo que se lee acá puede estar viejo.`);
  }
  const remoto = principal ? estadoCommiteado(raiz, codigo, principal) : null;
  if (remoto?.etapa === ETAPA.CIERRE && estado?.etapa !== ETAPA.CIERRE) {
    avisos.push(`Aviso: en ${principal} el RQ ${codigo} figura cerrado (etapa ${ETAPA.CIERRE}). Este docs/rq/ACTIVO es local: actualizá la rama antes de seguir.`);
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
  const protegida = enRamaProtegida(raiz, proyectoDe(repo, env));
  if (protegida) l.push(`Rama equivocada: ${protegida} sólo recibe cambios por PR. Pasá a ${ramaDelRq(codigo)} (git switch -c ${ramaDelRq(codigo)}).`);
  // Parado en la rama de otro RQ (varios activos): el PR que importa es el de la rama de este, no el de HEAD.
  const ramaPropia = ramaDelRq(codigo);
  const otraRamaDeRq = rama.startsWith('rq/') && rama !== ramaPropia;
  if (otraRamaDeRq) l.push(`Aviso: estás en ${rama}, la rama de otro RQ; el PR de abajo es el de ${ramaPropia}.`);
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
  const avisoCompletos = avisoE2eCompletos(estado);
  if (avisoCompletos) l.push(avisoCompletos);
  if (tocaUi(estado, raiz, proyectoDe(repo, env), rutasDelRq(raiz, estado)) && !verificacionLocalOk(estado)) {
    l.push('Verificación local: sin registrar ($RQ verificar --local "<qué se recorrió>" <capturas>).');
  }
  const faltaProd = faltaParaEtapa(estado, ETAPA.PROD, raiz);
  if (faltaProd.length) l.push(`Falta para PROD: ${faltaProd.join('; ')}.`);
  const rv = estado.revision;
  l.push(`Revisión: ${rv ? (rv.ok ? 'ok' : 'bloqueante') : 'sin registrar'}.`);
  // Commits ya integrados en la rama principal (merge hecho, o commiteados directo en main): no hay PR que abrir.
  const principal = refPrincipal(raiz);
  if (principal && gitOk(raiz, ['merge-base', '--is-ancestor', 'HEAD', principal])) {
    l.push(`Rama integrada: HEAD ya está en ${principal} (merge-base --is-ancestor); no hace falta PR.`);
  } else if (env.BACG_DEV_SIN_GH === '1') {
    l.push('PR y CI: no consultados (BACG_DEV_SIN_GH=1).');
  } else {
    // PLG-CLOUD: PR y CI por REST (GraphQL da 403 en la nube).
    const repoGh = remotoGh(raiz);
    const ramaPr = otraRamaDeRq ? ramaPropia : rama;
    const prs = repoGh && ramaPr ? prsDeRama(repoGh, ramaPr, { estado: 'all' }, { env }) : { error: 'no sé el repo o la rama' };
    const proy = proyectoDe(repo, env);
    const orden = ordenDeRamas(proy, lista(proy?.repos).find((x) => String(x?.nombre ?? '').toLowerCase() === nombreRepo(raiz).toLowerCase()));
    const pr = prs.error ? null : prs.datos.find((p) => p.estado === 'open') ?? prs.datos[0];
    if (prs.error) l.push(`PR y CI: no consultados (${prs.error}).`);
    else if (!pr) l.push(`PR: no hay PR de esta rama. Crealo por REST: ${REST.crearPr(repoGh, orden?.dev ?? '<base>', ramaPr)}`);
    else {
      l.push(`PR #${pr.number} (${pr.mergeado ? 'mergeado' : pr.estado}): ${pr.url}`);
      const c = pr.sha ? checksDe(repoGh, pr.sha, { env }) : { error: 'sin commit' };
      if (c.error) l.push(`CI: no consultada (${c.error}).`);
      else {
        const de = (e) => c.datos.filter((x) => x.estado === e).length;
        l.push(c.datos.length === 0
          ? 'CI: sin checks.'
          : `CI: ${de('ok')} ok, ${de('fallo')} fallados, ${de('en-curso')} en curso${de('en-curso') ? ` (seguila en segundo plano: ${REST.checks(repoGh, pr.sha)})` : ''}.`);
      }
    }
    // PLG-CLOUD (hallazgo 18): artefactos compilados que otra rama rq/* también toca.
    for (const aviso of compiladosCompartidos(raiz, estado, proy, ramaPropia)) l.push(aviso);
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
  // PLG-TEST-INFRA (G5): la clase de cada rechazo de tests y lo que pasó sólo al reintentar, para medir sin releer salidas.
  if (estado.tests?.rechazos && Object.keys(estado.tests.rechazos).length) linea.rechazos_tests = estado.tests.rechazos;
  if (estado.tests?.inestables?.length) linea.tests_inestables = estado.tests.inestables;
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

/** AGENTS.md con la sección generada desde .bacg-dev/ (para agentes sin el plugin, como Lovable). */
function agents(repo, env, io) {
  const proyecto = exigirProyecto(repo, env);
  const r = escribirAgents(repo.raiz, seccionAgents(proyecto));
  io.stdout.write(`AGENTS.md: sección de lineamientos-dev-claude-bacg ${r}. Es documentación: se commitea sin RQ.\n`);
}

/** PLG-PRREV: instala el workflow del revisor independiente en este repo, con sus ramas de DEV y PROD. */
function revisorPr(repo, args, env, io) {
  const proyecto = exigirProyecto(repo, env);
  const propio = nombreRepo(repo.raiz).toLowerCase();
  const entradaRepo = lista(proyecto?.repos).find((r) => String(r?.nombre ?? '').toLowerCase() === propio) ?? {};
  const cabeza = salida(repo.raiz, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const ramaDefecto = cabeza ? cabeza.replace(/^origin\//, '') : 'main';
  const r = instalarRevisor({ raiz: repo.raiz, proyecto, entradaRepo, ramaDefecto, forzar: args.includes('--forzar') });
  const rel = RUTA_WORKFLOW.split(path.sep).join('/');
  const l = [r.creado ? `${rel} escrito.` : `${rel}: ${r.motivo}.`];
  for (const a of r.avisos) l.push(`Aviso: ${a}`);
  l.push('Falta, a cargo de un admin del repo u organización: cargar el secret ANTHROPIC_API_KEY en GitHub (Settings → Secrets → Actions; mejor a nivel organización) y, para que un crítico frene el merge, marcar el check "revisar" como requerido en la protección de la rama.');
  if (r.creado) l.push(`Commitealo como parte del RQ: node "<ruta>/rq.mjs" commit "ci: revisor independiente" ${rel}`);
  io.stdout.write(`${l.join('\n')}\n`);
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

function pasoOficial(repo, env, p, estado) {
  const proyecto = proyectoDe(repo, env);
  const vigentes = pasosCircuito(proyecto).map((x) => x.paso);
  const oficial = vigentes.find((x) => normPaso(x) === normPaso(p));
  if (!oficial) {
    // Un pendiente anotado con un circuito anterior (el proyecto renombró o partió el paso): se dice cuáles lo
    // reemplazan en lugar de dejarlo sin salida.
    const viejo = lista(estado?.pendientes).some((x) => normPaso(x) === normPaso(p));
    const lista_ = vigentes.length ? vigentes.join(', ') : 'ninguno';
    throw new ErrorCli(
      viejo
        ? `El paso "${p}" es de un circuito_prod anterior del proyecto ${repo.proyectoId} y ya no existe. Los pasos vigentes son: ${lista_}. Registrá los que correspondan (paso hecho <paso> "<evidencia>"); al registrar uno, los pendientes del RQ se recalculan con el circuito vigente.`
        : `El paso "${p}" no figura en circuito_prod del proyecto ${repo.proyectoId}. Los pasos vigentes son: ${lista_}.`,
    );
  }
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
  const { oficial } = pasoOficial(repo, env, p, estado);
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
  const { oficial } = pasoOficial(repo, env, p, estado);
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
  const { oficial } = pasoOficial(repo, env, p, estado);
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
  // BACG_DEV_SIN_GH=1: no consulta GitHub (tests, o sin red).
  const sedes = env.BACG_DEV_SIN_GH === '1' ? {} : migracionesEnSync(proyecto);
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
    if (/^push:/i.test(p)) {
      // PLG-RAMAS: con ramas de PROD y de DEV, el paso es la promoción DEV → PROD, después de verificar en DEV.
      const nombre = p.slice(5);
      const orden = ordenDeRamas(proyecto, repos.find((x) => String(x?.nombre ?? '').toLowerCase() === nombre.toLowerCase()));
      como = orden
        ? `promoción ${orden.dev} → ${orden.prod[0]} en ${nombre}, con el cambio ya mergeado en ${orden.dev}, desplegado y verificado en DEV (gh pr create --base ${orden.prod[0]} --head ${orden.dev}, o git push origin origin/${orden.dev}:${orden.prod[0]} si es fast-forward)`
        : `git push en ${nombre}`;
    }
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
          : `aplicar las migraciones en ${ref} con el mecanismo del motor de datos${motorDatos(proyecto) ? ` (${motorDatos(proyecto)})` : ''} (declaralo en datos.aplicar de proyecto.yml)`;
    } else if (/^merge-prs-sync:/i.test(p)) {
      const sede = p.slice('merge-prs-sync:'.length);
      como = cuenta
        ? `gh pr list -R ${cuenta}/${sede} --head ${rama}; gh pr merge <n> --merge -R ${cuenta}/${sede} (en la nube, REST: gh api "repos/${cuenta}/${sede}/pulls?state=open&head=${cuenta}:${rama}" y gh api -X PUT repos/${cuenta}/${sede}/pulls/<n>/merge -f merge_method=merge)`
        : `mergear el PR ${rama} de ${sede}`;
    } else if (esManual(p)) como = 'manual: lo hace el usuario; no bloquea el cierre';
    else if (/^dev:/i.test(p)) como = `en DEV, antes de PROD (los que siguen lo esperan): con el cambio desplegado y probado en DEV, $RQ paso hecho ${p} "<qué se probó y dónde>"`;
    l.push(`${n}. [${hecho ? 'x' : ' '}] ${p}: ${como}${falta ? ` (antes: ${falta})` : ''}`);
  }
  if (n === 0) l.push('El circuito no tiene pasos para este RQ.');
  io.stdout.write(`${l.join('\n')}\n`);
}

function imprimirEstado(repo, codigo, estado, io, env = process.env) {
  const l = [];
  l.push(`Código: ${estado.codigo}`);
  l.push(`Tipo: ${estado.tipo}`);
  l.push(`Clasificación: ${nombreDe(estado.clasificacion)}${estado.clasificacion_pendiente === true ? ' (pendiente de confirmar)' : ''}`);
  // Un RQ con el PR ya mergeado no está en curso: lo primero es avanzarlo o cerrarlo (no "Rama equivocada").
  const mergeado = avisoMergeado(repo.raiz, codigo, env);
  if (mergeado) l.push(mergeado);
  const protegida = mergeado ? null : enRamaProtegida(repo.raiz, proyectoDe(repo, env));
  if (protegida) l.push(`Rama equivocada: ${protegida} sólo recibe cambios por PR. Pasá a ${ramaDelRq(codigo)} (git switch -c ${ramaDelRq(codigo)}).`);
  const derivada = etapaDerivada(estado, repo.raiz);
  l.push(`Etapa: ${derivada}${derivada !== estado.etapa ? ` (según la evidencia; registrada: ${estado.etapa})` : ''}`);
  const sk = skillsDe(estado);
  l.push(`Skills del RQ: ${sk.length ? sk.join(', ') : 'ninguna'}`);
  const proxima = [ETAPA.DESARROLLO, ETAPA.VERIFICACION, ETAPA.PROD].find((n) => n > derivada - 1 && faltaParaEtapa(estado, n, repo.raiz).length);
  if (proxima) l.push(`Falta para la etapa ${proxima}: ${faltaParaEtapa(estado, proxima, repo.raiz).join('; ')}`);
  const aps = lista(estado.aprobaciones);
  l.push(aps.length ? 'Aprobaciones:' : 'Aprobaciones: ninguna');
  for (const a of aps) l.push(`  ${a.etapa}: ${a.frase}`);
  const au = estado.autonomia;
  const porDefecto = ['spike', 'bounded'].includes(estado.clasificacion) ? `hasta etapa ${ETAPA.DEV} (por defecto)` : 'ninguna';
  l.push(au ? `Autonomía: hasta etapa ${au.hasta} ("${au.frase}")` : `Autonomía: ${porDefecto}`);
  const t = estado.tests;
  const rojos = lista(t?.rojos_conocidos).length;
  l.push(t ? `Tests: ${t.ok ? 'ok' : 'fallaron'} (${t.fecha})${rojos ? `, con ${rojos} rojos conocidos` : ''}` : 'Tests: sin registrar');
  const e = estado.e2e;
  l.push(e ? `E2E: ${e.ok ? 'ok' : 'falló'} (${e.fecha})` : 'E2E: sin correr');
  const avisoCompletos = avisoE2eCompletos(estado);
  if (avisoCompletos) l.push(avisoCompletos);
  if (tocaUi(estado, repo.raiz, proyectoDe(repo, env), rutasDelRq(repo.raiz, estado))) {
    const v = estado.verificacion_local;
    l.push(verificacionLocalOk(estado) ? `Verificación local: ok${v ? ` (${v.fecha}, ${lista(v.capturas).length} captura(s))` : ' (salteada por el usuario)'}` : 'Verificación local: sin registrar');
  }
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
  const desplego = (Number(estado.etapa) || 0) >= ETAPA.DEV || etapaDerivada(estado, raiz) >= ETAPA.DEV || lista(estado.circuito).length > 0;
  if (!proyecto || !desplego) return [];
  const sedes = env.BACG_DEV_SIN_GH !== '1' ? migracionesEnSync(proyecto) : {};
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
  if (estado.etapa !== ETAPA.CIERRE) return;
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
  // PLG-CANON-CIERRE: un RQ que tocó UI no cierra sin registrar si dejó un lineamiento nuevo para el canon.
  // Falla cerrada: si no se pueden leer las rutas del RQ o el proyecto, se pregunta igual.
  const rutasCierre = rutasDelRq(raiz, estado);
  if (!estado.canon && (rutasCierre === null || !proyecto || tocaUi(estado, raiz, proyecto, rutasCierre))) {
    const ruta = rutaCanon(proyecto);
    throw new ErrorCli(
      `Antes de cerrar, preguntale al usuario: ¿este RQ decidió un lineamiento de UI nuevo que debe ir al canon${ruta ? ` (${ruta})` : ''}? ` +
      `Si dice que sí, escribilo${ruta ? '' : ' (el proyecto no declara ui.canon: creá .bacg-dev/canon-ui.md y declaralo en ui.canon)'}, commitealo y registrá $RQ canon documentado. ` +
      'Si dice que no: $RQ canon no "<frase del usuario>".',
    );
  }
  const pend = pendientesDel(repo, estado, proyecto, env);
  // Un RQ abierto con una versión vieja no tiene estado.tarea: el título sale de la fila del backlog o del spec.
  const previa = filaDelBacklog(repo, env, codigo);
  const spec = datosDelSpec(raiz, codigo);
  if (!estado.tarea && (previa.Tarea || spec.Tarea)) estado.tarea = previa.Tarea || spec.Tarea;
  estado.etapa = ETAPA.CIERRE;
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
    return leerBacklog(dirLineamientos({ env }), repo.proyectoId, repo.raiz, proyectoDe(repo, env)).find((f) => f['Código'] === codigo) ?? {};
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

// home, tty y leerLinea se inyectan sólo desde código (tests); por línea de comandos son los del proceso.
export async function main(
  argvCompleto,
  { cwd = process.cwd(), env = process.env, stdout = process.stdout, stderr = process.stderr, home = homeReal(), tty = process.stdin.isTTY === true, leerLinea = leerLineaDeTerminal } = {},
) {
  const io = { stdout, stderr };
  const verificacion = { env, home, tty, leerLinea, stderr };
  let sub;
  try {
    const { argv, rq: elegido } = sacarRq(argvCompleto);
    let args;
    [sub, ...args] = argv;
    const n = args.length;
    const uso = (ok) => { if (!ok) throw new ErrorUso(); };
    if (sub === 'alta') {
      // Stepper de primer uso: corre en cualquier carpeta, aun sin repo ni lineamientos.
      const pasos = pasosAlta({ cwd, env });
      io.stdout.write(`${formatoAlta(pasos)}\n`);
      return bloqueante(pasos) ? 1 : 0;
    }
    if (sub === 'odoo-skills') {
      // Corre en cualquier carpeta: la rama sale de --rama, del proyecto de cwd (odoo_skills.rama) o 20.0.
      const { res } = opciones(args, ['rama']);
      let rama = res.rama;
      if (!rama) {
        const r = buscarRepo(cwd, { dirLin: dirLineamientos({ env }) });
        rama = ramaSkills(r ? proyectoDe(r, env) : null);
      }
      io.stdout.write(`Bajando skills/ de odoo/odoo (rama ${rama})…\n`);
      const x = instalarSkillsOdoo({ rama });
      io.stdout.write(`Listo: ${SKILLS_ODOO.join(', ')} en ${dirSkills()} (${x.archivos} archivos, commit ${String(x.commit ?? '?').slice(0, 10)}). Reiniciá la sesión de Claude Code para que las tome.\n`);
      return 0;
    }
    const SUBS = ['alta', 'odoo-skills', 'previa', 'abrir', 'clasificacion', 'ejecucion', 'etapa', 'aprobar', 'autonomia', 'lote', 'skills', 'activo', 'saltar', 'commit', 'registrar-tests', 'verificar', 'revision', 'paso', 'desplegar', 'entregar', 'agents', 'auditar', 'estado', 'arranque', 'cerrar', 'ok', 'reglas', 'devolucion', 'trazar', 'backlog', 'revisor-pr', 'canon'];
    if (!SUBS.includes(sub)) sub = null;
    uso(sub !== null);
    const aridad = { etapa: 1, aprobar: 2, autonomia: 2, ejecucion: 2, saltar: 3, revision: 2, paso: 1, 'registrar-tests': 0, entregar: 0, agents: 0, estado: 0, arranque: 0 };
    if (sub === 'paso' && (args[0] === 'no-aplica' || args[0] === 'hecho')) uso(n === 3);
    else if (sub === 'paso' && args[0] === 'reabrir') uso(n === 2);
    else if (sub === 'desplegar' || sub === 'previa') uso(n <= 1);
    else if (sub === 'clasificacion') uso((args[0] === 'confirmar' && n === 2) || (args[0] === 'cambiar' && n === 3));
    else if (sub === 'commit') uso(n >= 2);
    else if (sub === 'auditar') uso(n === 0 || (n === 2 && args[0] === '--cerrar'));
    else if (sub === 'revisor-pr') uso(n === 0 || (n === 1 && args[0] === '--forzar'));
    else if (sub === 'autonomia' && args[0] === 'aplicar') uso(n === 1);
    else if (sub === 'autonomia' && args[0] === 'total') uso(n === 2 || n === 4);
    else if (sub === 'ok') uso(n === 1 || n === 3);
    else if (sub === 'reglas') uso(args[0] === 'actualizar' && n === 1);
    else if (sub === 'devolucion') uso(n === 0 || (args[0] === 'agregar' && (n === 2 || n === 4)) || (args[0] !== 'agregar' && n === 3));
    else if (sub === 'trazar') uso(n === 0);
    else if (sub === 'backlog') uso(args[0] === 'migrar' && n === 1);
    else if (sub === 'lote') uso(args[0] === 'aprobar' && n >= 3);
    else if (sub === 'skills') uso(args[0] === 'importar' && n === 1);
    else if (sub === 'activo') uso(args[0] === 'reparar' && n === 1);
    else if (sub === 'canon') uso((args[0] === 'no' && n === 2) || (args[0] === 'documentado' && n === 1));
    else if (!['abrir', 'cerrar', 'verificar'].includes(sub)) uso(n === aridad[sub]);

    const repo = buscarRepo(cwd, { dirLin: dirLineamientos({ env }) });
    if (!repo) throw new ErrorCli('No es un repo de un proyecto registrado (por su remoto en proyectos/<id>/proyecto.yml, .bacg-lineamientos o .bacg-dev/proyecto.yml). Corré rq.mjs alta para ver qué falta.');
    const raiz = repo.raiz;
    // El RQ elegido con --rq pasa a ser el "en curso" (último de ACTIVO): ahí registra las skills el hook.
    const activos = rqsActivos(raiz);
    if (elegido && activos.includes(elegido) && activos[activos.length - 1] !== elegido) {
      guardarActivos(raiz, [...activos.filter((c) => c !== elegido), elegido]);
    }

    switch (sub) {
      case 'previa': {
        const codigo = args[0] ?? null;
        if (codigo && !RE_CODIGO.test(codigo)) throw new ErrorCli(`Código inválido: "${codigo}".`);
        let nuevo = true;
        if (codigo) {
          try {
            cargarEstado(raiz, codigo);
            nuevo = false;
          } catch {
            // no existe en este repo
          }
        }
        const { lineas, bloqueos } = previa(repo, env, codigo, nuevo);
        io.stdout.write(`Validación previa:\n${lineas.join('\n')}\n`);
        if (bloqueos.length) {
          io.stdout.write(`\n${mensajeBloqueo(codigo, bloqueos)}\n`);
          return 1;
        }
        break;
      }
      case 'abrir':
        await abrir(repo, args, env, io, verificacion);
        break;
      case 'etapa': {
        const pedida = etapaValida(args[0]);
        const { codigo, estado } = activo(raiz, elegido);
        // Como en aprobar: el 6 de un RQ abierto con 3.x era PROD.
        const e = pedida === ETAPA.CIERRE && estado._v3 === true ? ETAPA.PROD : pedida;
        if (e !== pedida) io.stdout.write(`${AVISO_PROD_V3}\n`);
        const falta = faltaParaEtapa(estado, e, raiz);
        // Aviso, no bloqueo: la etapa es opcional; lo exigen revision, el commit de código y la publicación a PROD.
        if (falta.length) io.stderr.write(`Aviso: para la etapa ${e} del ${codigo} falta: ${falta.join('; ')}.\n`);
        if (e >= ETAPA.DISENO) rebasarSiNoEmpezo(raiz, codigo, estado);
        estado.etapa = e;
        guardar(raiz, estado);
        io.stdout.write(`Etapa ${e}.\n`);
        break;
      }
      case 'aprobar': {
        const pedida = etapaValida(args[0]);
        const frase = textoNoVacio(args[1], 'La frase');
        // ETAPA.CIERRE es el 6 de hoy; en un RQ abierto con 3.x, ese número era el OK de PROD.
        const e = pedida === ETAPA.CIERRE && activo(raiz, elegido).estado._v3 === true ? ETAPA.PROD : pedida;
        const aAprobar = activo(raiz, elegido).estado;
        // P-17 (4.4): el diseño de un Arquitectónico declara sus criterios centrales antes de pedir la aprobación.
        if (e === ETAPA.DISENO && aAprobar.clasificacion === 'arquitectonico' && reglas44(aAprobar)) {
          const falta = faltaDisenoEscrito(raiz, aAprobar);
          if (falta && /Criterios centrales/.test(falta)) throw new ErrorCli(`Antes de pedir la aprobación del diseño falta ### Criterios centrales en docs/rq/${aAprobar.codigo}/spec.md (1 a 3 criterios contra los que se revisa toda recomendación estructural).`);
        }
        if (e === ETAPA.PROD) noEsLaAutonomia(frase, verificacion, 'el OK de PROD');
        await verificarFrase(frase, verificacion, aAprobar);
        if (e !== pedida) io.stdout.write(`${AVISO_PROD_V3}\n`);
        cambiarVinculado(repo, env, elegido, io, (s) => {
          s.aprobaciones = [...lista(s.aprobaciones), { etapa: e, frase, fecha: ahora() }];
          return `Aprobación de la etapa ${e} registrada.`;
        });
        break;
      }
      case 'autonomia': {
        if (args[0] === 'sesion') {
          await autonomiaSesion(repo, textoNoVacio(args[1], 'La frase'), verificacion, env, io);
          break;
        }
        if (args[0] === 'total') {
          const { frase, ejecucion } = fraseYEjecucion(args.slice(1));
          await autonomiaSesion(repo, frase, verificacion, env, io, { nivel: 'total', ejecucion });
          break;
        }
        if (args[0] === 'aplicar') {
          const aut = await autonomiaVerificada(verificacion);
          if (!aut) throw new ErrorCli('Esta sesión no tiene autonomía registrada: $RQ autonomia sesion "<frase del usuario>".');
          aplicarAutonomia(repo, env, activo(raiz, elegido).codigo, aut, io);
          break;
        }
        const h = entero(args[0]);
        if (h === null || h < ETAPA.DISENO || h > ETAPA.DEV) throw new ErrorCli(`hasta inválido: "${args[0]}" (tiene que ser un entero de ${ETAPA.DISENO} a ${ETAPA.DEV}).`);
        const frase = textoNoVacio(args[1], 'La frase');
        await verificarFrase(frase, verificacion, activo(raiz, elegido).estado);
        cambiarVinculado(repo, env, elegido, io, (s) => { s.autonomia = { hasta: h, frase, fecha: ahora() }; return `Autonomía hasta la etapa ${h} registrada.`; });
        break;
      }
      case 'lote':
        await loteAprobar(repo, args, verificacion, env, io);
        break;
      case 'ok':
        await okDelUsuario(repo, elegido, args, verificacion, env, io);
        break;
      case 'devolucion': {
        if (args.length === 0) {
          io.stdout.write(`${listadoDevoluciones(activo(raiz, elegido).estado)}\n`);
          break;
        }
        if (args[0] === 'agregar') {
          const { res, posicionales } = opciones(args.slice(1), ['elemento']);
          const texto = textoNoVacio(posicionales[0], 'El punto');
          cambiarVinculado(repo, env, elegido, io, (s) => {
            const { n, corte, vueltas } = agregarDevolucion(s, texto, res.elemento, ahora());
            return `Devolución ${n} anotada (pendiente).${corte ? `\n${PROTOCOLO_CORTE(res.elemento, vueltas)}` : ''}`;
          });
          break;
        }
        const [n, nuevo, evidencia] = args;
        if (entero(n) === null) throw new ErrorUso();
        // Rechazar o consultar un punto del usuario lo decide el usuario: la evidencia es su frase literal.
        if (nuevo === 'rechazado' || nuevo === 'consultado') {
          try {
            noEsLaAutonomia(textoNoVacio(evidencia, 'La evidencia'), verificacion, `un punto ${nuevo}`);
            await verificarFrase(evidencia, verificacion, activo(raiz, elegido).estado);
          } catch (e) {
            throw new ErrorCli(`Un punto ${nuevo} lleva como evidencia la respuesta literal del usuario. ${e.message}`);
          }
        }
        cambiarVinculado(repo, env, elegido, io, (s) => {
          const error = marcarDevolucion(s, entero(n), nuevo, evidencia, ahora());
          if (error) throw new ErrorCli(error);
          return `Devolución ${n}: ${nuevo}.`;
        });
        break;
      }
      case 'backlog': {
        // PLG-BACKLOG: deja docs/backlog.md del repo como la fuente, con todo lo de la copia central fusionado.
        const dirLin = dirLineamientos({ env });
        const central = rutaCentral(dirLin, repo.proyectoId);
        const copia = path.join(raiz, 'docs', 'backlog.md');
        if (!fs.existsSync(central)) {
          io.stdout.write(`No hay backlog central de ${repo.proyectoId} (${central}): la fuente ya es docs/backlog.md del repo.\n`);
          break;
        }
        // Primero se declara la fuente en el proyecto.yml central (así una migración a medias se completa corriéndola
        // de nuevo), después se fusiona y recién al final se marca la central como obsoleta.
        const yml = path.join(dirLin, 'proyectos', repo.proyectoId, 'proyecto.yml');
        let declarado = false;
        if (fs.existsSync(yml)) {
          const y = fs.readFileSync(yml, 'utf8');
          if (!/^backlog:\s*repo\s*$/m.test(y)) {
            fs.writeFileSync(yml, /^backlog:/m.test(y) ? y.replace(/^backlog:.*$/m, 'backlog: repo') : `${y.replace(/\n*$/, '\n')}backlog: repo\n`);
          }
          declarado = true;
        }
        const falta = declarado ? '' : `; no encontré ${yml}: declará \`backlog: repo\` en el proyecto.yml de ${repo.proyectoId}`;
        const t = fs.readFileSync(central, 'utf8');
        if (/^> OBSOLETO/m.test(t)) {
          io.stdout.write(`El backlog de ${repo.proyectoId} ya está migrado: la copia central está marcada como obsoleta y la fuente es docs/backlog.md del repo${falta}.\n`);
          break;
        }
        // Columnas que tiene la central y no la copia del repo: sus valores no pasan; se avisa para no perderlos sin saberlo.
        // Sin copia en el repo, se crea con el encabezado de la central (no se pierde ninguna columna).
        crearConEncabezadoDe(copia, central);
        const sinColumna = columnasDe(central).filter((c) => !columnasDe(copia).includes(c));
        const { agregadas, actualizadas } = fusionarEnArchivo(copia, filasDe(central));
        fs.writeFileSync(central, `> OBSOLETO desde ${hoy()}: la fuente del backlog es docs/backlog.md del repo ${nombreRepo(raiz)}. No lo edites.\n\n${t}`);
        io.stdout.write(`Backlog migrado: ${filasDe(copia).length} fila(s) en docs/backlog.md (${agregadas.length} agregada(s), ${actualizadas.length} con estado actualizado). La copia central quedó marcada como obsoleta${declarado ? ' y proyecto.yml declara `backlog: repo`' : falta}.${sinColumna.length ? ` Ojo: la central tiene columnas que docs/backlog.md no tiene (${sinColumna.join(', ')}); sus valores quedaron sólo en la copia obsoleta: agregalas a mano si las querés.` : ''} Commiteá docs/backlog.md acá y los cambios de proyectos/${repo.proyectoId}/ en lineamientos.\n`);
        break;
      }
      case 'trazar': {
        const { codigo } = activo(raiz, elegido);
        const r = trazarSpec(raiz, codigo);
        io.stdout.write(r.total
          ? `Traza en ${r.ruta}: ${r.total} ítem(s) del criterio de aceptación, ${r.nuevos} nuevo(s). Completá archivos, test y estado (hecho | parcial | fuera) de cada uno.\n`
          : `El spec de ${codigo} no tiene ítems en "## Criterio de aceptación": no hay nada que trazar.\n`);
        break;
      }
      case 'reglas': {
        if (args[0] !== 'actualizar') throw new ErrorUso();
        cambiarVinculado(repo, env, elegido, io, (s) => {
          s.reglas = REGLAS_ACTUALES;
          return `${s.codigo}: reglas de cumplimiento ${REGLAS_ACTUALES / 10} activas.`;
        });
        break;
      }
      case 'skills':
        await importarSkills(repo, elegido, verificacion, env, io);
        break;
      case 'activo':
        repararActivo(raiz, io);
        break;
      case 'clasificacion': {
        const accion = args[0];
        let nueva = null;
        if (accion === 'cambiar') {
          nueva = clasificacionDe(args[1]);
          if (!nueva) throw new ErrorCli(`Clasificación inválida: "${args[1]}" (exploracion | acotado | arquitectonico).`);
        }
        const frase = textoNoVacio(args[accion === 'cambiar' ? 2 : 1], 'La frase');
        await verificarFrase(frase, verificacion, activo(raiz, elegido).estado);
        cambiarVinculado(repo, env, elegido, io, (s) => {
          if (nueva) s.clasificacion = nueva;
          s.clasificacion_pendiente = false;
          s.clasificacion_confirmada = { frase, fecha: ahora() };
          if (s.clasificacion === 'bounded' && !lista(s.aprobaciones).some((a) => a?.etapa === ETAPA.DISENO) && disenoEscrito(raiz, s.codigo)) {
            s.aprobaciones = [...lista(s.aprobaciones), { etapa: ETAPA.DISENO, frase, fecha: ahora(), via: 'clasificacion' }];
            return `Clasificación ${nombreDe(s.clasificacion)} confirmada. Diseño y tareas de spec.md aprobados con la misma frase.`;
          }
          return `Clasificación ${nombreDe(s.clasificacion)} confirmada.`;
        });
        break;
      }
      case 'ejecucion': {
        const modo = MODOS_EJECUCION[String(args[0]).trim().toLowerCase()];
        if (!modo) throw new ErrorCli(`Ejecución inválida: "${args[0]}" (inline | subagentes; también executing-plans o subagent-driven-development).`);
        const frase = textoNoVacio(args[1], 'La frase');
        await verificarFrase(frase, verificacion, activo(raiz, elegido).estado);
        cambiarVinculado(repo, env, elegido, io, (s) => { s.ejecucion = { modo, frase, fecha: ahora() }; return `Ejecución ${modo} registrada.`; });
        break;
      }
      case 'saltar': {
        const [compuerta, frase, motivo] = args;
        if (!COMPUERTAS.includes(compuerta)) throw new ErrorCli(`Compuerta inválida: "${compuerta}" (${COMPUERTAS.join(' | ')}).`);
        textoNoVacio(frase, 'La frase');
        textoNoVacio(motivo, 'El motivo');
        noEsLaAutonomia(frase, verificacion, 'un salto de compuerta');
        await verificarFrase(frase, verificacion, activo(raiz, elegido).estado);
        cambiarVinculado(repo, env, elegido, io, (s) => {
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
          const falta = [...faltaParaEtapa(estado, ETAPA.VERIFICACION, raiz), ...pasadasSinRepetir(estado).map((p) => `${p} otra vez (la revisión anterior es del ${estado.revision.fecha.slice(0, 10)}; corré las pasadas sobre el código nuevo)`)];
          if (falta.length) throw new ErrorCli(`Antes de la revisión del ${codigo} falta: ${falta.join('; ')}. Si el usuario decide saltearlo: $RQ saltar skills "<frase>" "<motivo>".`);
          const sensible = sensibleSinRevisar(estado, rutasDelRq(raiz, estado), proyectoDe(repo, env));
          if (sensible) throw new ErrorCli(`El ${codigo} toca ${sensible} (ruta sensible): falta claude-security (Skill "claude-security:claude-security") o, si el usuario lo decide, $RQ saltar seguridad "<frase>" "<motivo>".`);
        }
        // 4.4: el commit revisado (la revisión vence si después entra código) y las bloqueantes (piden receiving-code-review).
        const head = commitHead(raiz);
        estado.revision = { ok: veredicto === 'ok', fecha: ahora(), nota, ...(reglas44(estado) && head ? { head } : {}) };
        if (veredicto === 'bloqueante' && reglas44(estado)) estado.revisiones_bloqueantes = (Number(estado.revisiones_bloqueantes) || 0) + 1;
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
      case 'revisor-pr':
        revisorPr(repo, args, env, io);
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
      case 'arranque':
        io.stdout.write(`${textoArranque({ raiz, proyecto: proyectoDe(repo, env), dirLin: dirLineamientos({ env }) })}
`);
        break;
      case 'estado': {
        const cerrados = cerradosConPendientes(raiz).filter((c) => c.codigo !== elegido);
        if (!elegido && rqsActivos(raiz).length === 0) io.stdout.write('RQ activo: ninguno.\n');
        else {
          const { codigo, estado } = activo(raiz, elegido);
          imprimirEstado(repo, codigo, estado, io, env);
          for (const a of avisosDeAtraso(raiz, codigo, estado)) io.stdout.write(`${a}\n`);
        }
        for (const a of avisosActivo(raiz)) io.stdout.write(`${a}\n`);
        for (const c of cerrados) io.stdout.write(`Cerrado con pendientes: ${c.codigo} (falta: ${c.pendientes.join(', ')}; al hacerlos, $RQ paso … --rq ${c.codigo}).\n`);
        break;
      }
      case 'canon': {
        // PLG-CANON-CIERRE: la respuesta del usuario a "¿este RQ dejó un lineamiento de UI nuevo para el canon?".
        const [decision, frase] = args;
        const { estado } = activo(raiz, elegido);
        if (decision === 'no') {
          textoNoVacio(frase, 'La frase');
          await verificarFrase(frase, verificacion, estado);
          cambiarVinculado(repo, env, elegido, io, (s) => { s.canon = { decision: 'no', frase, fecha: ahora() }; return 'Canon: sin lineamiento de UI nuevo (registrado).'; });
        } else if (decision === 'documentado') {
          const ruta = rutaCanon(proyectoDe(repo, env));
          if (!ruta) throw new ErrorCli('El proyecto no declara ui.canon: declará ui.canon en .bacg-dev/proyecto.yml (p. ej. canon-ui.md), escribí ahí el lineamiento y commitealo.');
          // Sólo cuenta lo commiteado en la rama del RQ: un cambio sin commitear no queda en el canon de nadie.
          const sinCommit = spawnSync('git', ['status', '--porcelain', '--', ruta], { cwd: raiz, encoding: 'utf8' });
          if (sinCommit.status !== 0 || sinCommit.stdout.trim()) throw new ErrorCli(`${ruta} tiene cambios sin commitear: commitealos antes de registrar el canon.`);
          const base = typeof estado.base === 'string' && estado.base ? estado.base : null;
          const cambio = base ? spawnSync('git', ['diff', '--name-only', `${base}..HEAD`, '--', ruta], { cwd: raiz, encoding: 'utf8' }) : null;
          if (!cambio || cambio.status !== 0 || !cambio.stdout.trim()) throw new ErrorCli(`${ruta} no cambió en este RQ: escribí el lineamiento nuevo y commitealo antes de registrarlo.`);
          cambiarVinculado(repo, env, elegido, io, (s) => { s.canon = { decision: 'documentado', ruta, fecha: ahora() }; return `Canon: lineamiento documentado en ${ruta}.`; });
        } else {
          throw new ErrorCli('Uso: canon no "<frase del usuario>" | canon documentado');
        }
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
