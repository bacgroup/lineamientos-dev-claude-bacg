// Compuerta de Bash: decide si corren `git commit`, `git push` y `gh pr merge`, y bloquea las escrituras
// directas a docs/rq/<código>/estado.yml, docs/rq/ACTIVO y el transcript (~/.claude/projects/*.jsonl) por
// redirección de salida, `sed -i`, `tee`, `cp` o `mv` (best effort: `dd of=`, `install`, intérpretes y
// editores no se ven). Un commit que trae en stage un estado.yml con aprobaciones, autonomía o saltos nuevos
// exige que cada frase esté en un mensaje del usuario de esta sesión.
//
// El parser de shell es aproximado y tiende a fallar cerrado: además del análisis por segmentos, una red de
// seguridad agrega un push o un merge cuando el texto sin comillas del comando los menciona y el parser no
// los detectó (por ejemplo `G=git; $G push`).
//
// Límites conocidos (no se detectan):
// - aliases de git (`git -c alias.p=push p`, `alias.*` en la config del repo o global, aliases de shell);
// - merges por la API de GitHub (`gh api .../pulls/<n>/merge`, curl a la API) y la variable GH_REPO definida
//   fuera del comando;
// - pushes desde scripts o programas (`./deploy.sh`, `npm run publicar`, Makefiles, python/node), `GIT_DIR`
//   exportado antes, y comandos armados con variables que no mencionan literalmente git y push;
// - archivos de script ejecutados por un shell (`sh x.sh`) y comandos armados en tiempo de ejecución
//   (`"$(echo git)" push`).
//
// La red sólo mira los segmentos que el parser no resolvió: `git <subcomando conocido>` y `gh <subcomando
// conocido>` quedan afuera (`git stash push`, `git add src/push.ts`, `gh pr checks 12`), y las ops de la red
// salen con `red: true` para que post-tool no las registre como pasos del circuito.
//
// Falsos positivos conocidos (aceptados: fallan cerrados):
// - un subcomando desconocido de git (alias) o `gh api`/`gh alias`/`gh extension` que mencione push o merge
//   dispara la red;
// - si aparece un shell sin -c (`bash x.sh`), un mensaje de commit entre comillas que diga "git … push"
//   dispara la red del shell sobre el comando crudo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirLineamientos, buscarRepo, cargarProyecto, nombreRepo } from './config.mjs';
import { relativaAlRepo, tipoArchivo } from './rutas.mjs';
import { rqsActivos, cargarEstado, etapaCumplida, saltoValido } from './estado.mjs';
import { cli, comandosTests, comandoE2e, PISTA_SIN_TESTS } from './cli.mjs';
import { norm, proyectosRegistrados } from './contexto.mjs';
import { proyectosLocales } from './proyectos-locales.mjs';
import { rutaQueImpide, rutasDesde } from './no-aplica.mjs';
import { faltaAntes, rutasDelRq, hechoEnRealidad, migracionesEnSync } from './circuito.mjs';
import { faltaParaEtapa, fueraDeSonda, MSG_EXPLORACION_FUERA } from './requisitos.mjs';
import { ETAPA } from './etapas.mjs';
import { ramasProd, ramasSoloPr } from './stack.mjs';
import { testsValenParaStage } from './arbol.mjs';
import { enRamaProtegida, ramaDelRq } from './ramas.mjs';
import { ordenDeRamas, faltaPasarPorDev, prAProdSinDev } from './promocion.mjs';

// Opciones de `git push` que consumen el siguiente argumento.
const CON_VALOR_PUSH = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

/** true si el push publica sólo la rama actual: sin refspecs, o refspecs de HEAD o de la rama actual. */
function pushDeLaRamaActual(op, raiz) {
  if (op.amplio) return false;
  const refspecs = Array.isArray(op.refspecs) ? op.refspecs : [];
  if (refspecs.length === 0) return true;
  let rama = null;
  try {
    rama = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim();
  } catch {
    return false;
  }
  return refspecs.every((r) => {
    const origen = r.replace(/^\+/, '').split(':')[0];
    return origen === 'HEAD' || (rama !== 'HEAD' && origen === rama);
  });
}
import { escrituraProhibida } from './compuerta-edicion.mjs';
import { fraseDelUsuario, vecesQueLoDijo } from './transcript.mjs';
import { choqueE2e, msgE2eEnCurso } from './e2e-lock.mjs';

// Los motivos llevan la ruta resuelta del CLI (se calculan al momento del deny).
const MSG_TODOS = () =>
  `git commit -a no deja verificar los tests: hacé git add explícito y corré ${cli()} registrar-tests`;
const MSG_RUTAS = () =>
  `git commit con rutas o --patch no deja verificar los tests: hacé git add explícito y corré ${cli()} registrar-tests`;
const MSG_PREVIO = (archivo) =>
  `git add && git commit en un comando sólo vale para docs y tests${archivo ? `, y ${archivo} no lo es` : ''}. Con código: ${cli()} commit "<mensaje>" <rutas>.`;
const MSG_FRASE = (sub) =>
  `La frase de rq.mjs ${sub} tiene que ser texto literal del usuario (un "Dale" vale si fue el mensaje entero). Si el usuario no lo dijo, pedíselo.`;
const SUBS_CON_FRASE = new Set(['aprobar', 'autonomia', 'saltar', 'clasificacion', 'ejecucion']);
const MSG_TESTS = () => `Corré los tests sobre lo que está en stage: ${cli()} registrar-tests`;

// ---------------------------------------------------------------------------
// Tokenizador de shell
// ---------------------------------------------------------------------------

const ESCAPES_ANSI = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v' };

// Contenido de $'…' desde i (apunta a la comilla de apertura). Devuelve [valor, índice de la comilla de cierre].
function leerAnsiC(s, i) {
  let j = i + 1;
  let v = '';
  while (j < s.length && s[j] !== "'") {
    if (s[j] === '\\' && j + 1 < s.length) {
      const c = s[j + 1];
      let m;
      if (ESCAPES_ANSI[c] !== undefined) {
        v += ESCAPES_ANSI[c];
        j += 2;
      } else if (c === 'x' && (m = /^[0-9A-Fa-f]{1,2}/.exec(s.slice(j + 2)))) {
        v += String.fromCharCode(parseInt(m[0], 16));
        j += 2 + m[0].length;
      } else if ((c === 'u' || c === 'U') && (m = /^[0-9A-Fa-f]{1,8}/.exec(s.slice(j + 2)))) {
        v += String.fromCodePoint(parseInt(m[0], 16));
        j += 2 + m[0].length;
      } else if ((m = /^[0-7]{1,3}/.exec(s.slice(j + 1)))) {
        v += String.fromCharCode(parseInt(m[0], 8));
        j += 1 + m[0].length;
      } else {
        v += c; // \\ \' \" y cualquier otro
        j += 2;
      }
    } else {
      v += s[j];
      j += 1;
    }
  }
  return [v, j];
}

// Índice del cierre de una sustitución que empieza en i (`$(` o backtick); s.length si no cierra.
function finDeSustitucion(s, i) {
  if (s[i] === '`') {
    const fin = s.indexOf('`', i + 1);
    return fin === -1 ? s.length : fin;
  }
  let prof = 0;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '(') prof++;
    else if (s[j] === ')' && --prof === 0) return j;
  }
  return s.length;
}

const FIN_DE_PALABRA = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '(', ')', '<', '>']);

// Devuelve tokens { t: 'w', v, q } (palabra; q = tuvo partes entre comillas), { t: 'op', v }
// (&&, ||, |, ;, &, \n, (, )), { t: 'sub', v } (sustitución de comandos, a analizar aparte) e
// { t: 'in', v } (texto que entra por stdin: cuerpo de un heredoc o contenido de un here-string).
// El destino de una redirección de salida (>, >>, 2>, &>) sale como { t: 'redir', v }; el de una de
// entrada se descarta.
function tokenizar(comando) {
  const tokens = [];
  const s = String(comando ?? '');
  let palabra = null;
  let comillas = false;
  let descartar = false; // la próxima palabra es el destino de una redirección ('salida' si escribe)
  let entrada = false; // la próxima palabra es el contenido de un here-string
  const heredocs = [];
  const cerrar = () => {
    if (palabra !== null) {
      if (descartar) {
        if (descartar === 'salida') tokens.push({ t: 'redir', v: palabra });
        descartar = false;
      } else if (entrada) {
        entrada = false;
        tokens.push({ t: 'in', v: palabra });
      } else tokens.push({ t: 'w', v: palabra, q: comillas });
    }
    palabra = null;
    comillas = false;
  };
  const agregar = (txt, q = false) => {
    palabra = (palabra ?? '') + txt;
    if (q) comillas = true;
  };
  const op = (v) => {
    cerrar();
    tokens.push({ t: 'op', v });
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const fin = s.indexOf("'", i + 1);
      const hasta = fin === -1 ? s.length : fin;
      agregar(s.slice(i + 1, hasta), true);
      i = hasta;
    } else if (c === '$' && s[i + 1] === "'") {
      const [v, fin] = leerAnsiC(s, i + 1);
      agregar(v, true);
      i = fin;
    } else if (c === '"' || (c === '$' && s[i + 1] === '"')) {
      let j = c === '"' ? i + 1 : i + 2;
      let buf = '';
      while (j < s.length && s[j] !== '"') {
        if ((s[j] === '$' && s[j + 1] === '(') || s[j] === '`') {
          // Sustitución de comandos dentro de comillas dobles: se ejecuta, así que se analiza aparte.
          const fin = finDeSustitucion(s, j);
          tokens.push({ t: 'sub', v: s.slice(j + (s[j] === '`' ? 1 : 2), fin) });
          j = fin + 1;
          continue;
        }
        if (s[j] === '\\' && j + 1 < s.length && '"\\$`\n'.includes(s[j + 1])) {
          if (s[j + 1] !== '\n') buf += s[j + 1];
          j += 2;
        } else {
          buf += s[j];
          j += 1;
        }
      }
      agregar(buf, true);
      i = j;
    } else if (c === '\\') {
      // Fuera de comillas, bash saca la barra y deja el carácter literal (gi\t -> git).
      if (i + 1 >= s.length) agregar(c);
      else if (s[i + 1] !== '\n') agregar(s[i + 1]);
      i += 1;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      cerrar();
    } else if (c === '#' && palabra === null) {
      while (i + 1 < s.length && s[i + 1] !== '\n') i++;
    } else if (c === '\n') {
      op('\n');
      // Cuerpo de heredocs pendientes: se guarda en su token 'in' hasta la línea delimitadora.
      while (heredocs.length > 0) {
        const { delim, tabs, ref } = heredocs.shift();
        const lineas = [];
        for (;;) {
          const nl = s.indexOf('\n', i + 1);
          const cruda = s.slice(i + 1, nl === -1 ? s.length : nl);
          const linea = (tabs ? cruda.replace(/^\t+/, '') : cruda).replace(/\r$/, '');
          i = nl === -1 ? s.length : nl;
          if (linea === delim) break;
          lineas.push(linea);
          if (nl === -1) break;
        }
        ref.v = lineas.join('\n');
      }
    } else if (c === ';' || c === '(' || c === ')') {
      op(c);
    } else if (c === '<' || c === '>' || (c === '&' && s[i + 1] === '>')) {
      // Redirección: un número pegado adelante es el descriptor (2>), no una palabra.
      if (palabra !== null && !comillas && /^\d+$/.test(palabra)) {
        palabra = null;
      } else {
        cerrar();
      }
      if (c === '&') i += 1; // &>
      if (s[i] === '<' && s[i + 1] === '<' && s[i + 2] === '<') {
        // here-string: la próxima palabra entra por stdin
        i += 2;
        entrada = true;
        continue;
      }
      if (s[i] === '<' && s[i + 1] === '<') {
        // heredoc: <<DELIM o <<-DELIM
        i += 2;
        let tabs = false;
        if (s[i] === '-') {
          tabs = true;
          i += 1;
        }
        while (s[i] === ' ' || s[i] === '\t') i++;
        let delim = '';
        while (i < s.length && !FIN_DE_PALABRA.has(s[i])) {
          if (s[i] !== '"' && s[i] !== "'" && s[i] !== '\\') delim += s[i];
          i++;
        }
        i -= 1;
        if (delim) {
          const ref = { t: 'in', v: '' };
          tokens.push(ref);
          heredocs.push({ delim, tabs, ref });
        }
        continue;
      }
      const escribe = s[i] === '>';
      while ('<>&|'.includes(s[i + 1] ?? 'x') && !(s[i + 1] === '&' && s[i + 2] === '&') && !(s[i + 1] === '|' && s[i + 2] === '|')) i++;
      // `>&2`, `<&0`, `>&-`: el destino viene pegado; si no, es la próxima palabra.
      descartar = escribe ? 'salida' : true;
    } else if (c === '&') {
      if (s[i + 1] === '&') {
        op('&&');
        i += 1;
      } else {
        op('&');
      }
    } else if (c === '|') {
      if (s[i + 1] === '|') {
        op('||');
        i += 1;
      } else {
        op('|');
        if (s[i + 1] === '&') i += 1; // `|&` = `2>&1 |`: sigue siendo un pipe
      }
    } else if (c === '`') {
      const fin = finDeSustitucion(s, i);
      tokens.push({ t: 'sub', v: s.slice(i + 1, fin) });
      i = fin;
    } else if (c === '$' && s[i + 1] === '(') {
      op('(');
      i += 1;
    } else {
      agregar(c);
    }
  }
  cerrar();
  return tokens;
}

function resolverDir(actual, destino) {
  let d = destino;
  if (d === '~' || d.startsWith('~/')) d = path.join(os.homedir(), d.slice(1));
  if (process.platform === 'win32') {
    const m = /^\/([A-Za-z])(\/.*)?$/.exec(d); // /c/MiCarpeta -> C:/MiCarpeta (Git Bash)
    if (m) d = `${m[1].toUpperCase()}:${m[2] ?? '/'}`;
  }
  return path.resolve(actual, d);
}

// ---------------------------------------------------------------------------
// Segmentos
// ---------------------------------------------------------------------------

const nombreCmd = (w) => path.basename(String(w).replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
const esAsignacion = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);

const PALABRAS_CLAVE = new Set(['{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'coproc', 'time']);

// Envoltorios: opciones que consumen el siguiente argumento y cantidad de posicionales antes del comando.
const ENVOLTORIOS = {
  sudo: { conArg: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '-R', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user', '--close-from'], dir: ['-D', '--chdir'] },
  timeout: { conArg: ['-s', '-k', '--signal', '--kill-after'], posicionales: 1 },
  nice: { conArg: ['-n', '--adjustment'] },
  stdbuf: { conArg: ['-i', '-o', '-e', '--input', '--output', '--error'] },
  env: { conArg: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'], dir: ['-C', '--chdir'], split: ['-S', '--split-string'] },
  xargs: { conArg: ['-I', '-n', '-L', '-d', '-E', '-P', '-s', '-a', '--max-args', '--max-lines', '--delimiter', '--eof', '--max-procs', '--max-chars', '--arg-file'] },
  command: { conArg: [] },
  exec: { conArg: ['-a'] },
  nohup: { conArg: [] },
  builtin: { conArg: [] },
  doas: { conArg: ['-u', '-C'] },
};
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

// Subcomandos de git que cambian el índice o HEAD.
const CAMBIAN_INDICE = new Set([
  'add', 'rm', 'mv', 'restore', 'reset', 'stash', 'checkout', 'switch', 'apply', 'am',
  'cherry-pick', 'merge', 'rebase', 'pull', 'commit',
]);

// Subcomandos de git y de gh que el parser resuelve: sus argumentos no cuentan para la red de seguridad
// (`git stash push`, `git add src/push.ts`, `gh pr checks 12`). Quedan afuera, y por lo tanto bajo la red,
// los que ejecutan comandos arbitrarios o definen aliases (submodule, bisect, rebase, config, filter-branch,
// difftool, mergetool; gh api, alias, extension) y cualquier subcomando desconocido (aliases de git).
const SUBCOMANDOS_GIT = new Set([
  'add', 'am', 'annotate', 'apply', 'archive', 'blame', 'branch', 'bundle', 'cat-file', 'check-ignore',
  'checkout', 'cherry', 'cherry-pick', 'clean', 'clone', 'commit', 'count-objects', 'describe', 'diff',
  'diff-files', 'diff-index', 'diff-tree', 'fetch', 'for-each-ref', 'format-patch', 'fsck', 'gc', 'grep',
  'hash-object', 'help', 'init', 'log', 'ls-files', 'ls-remote', 'ls-tree', 'merge', 'merge-base', 'mv',
  'notes', 'pull', 'push', 'range-diff', 'reflog', 'remote', 'repack', 'reset', 'restore', 'rev-list',
  'rev-parse', 'revert', 'rm', 'shortlog', 'show', 'show-ref', 'sparse-checkout', 'stash', 'status',
  'subtree', 'switch', 'symbolic-ref', 'tag', 'update-index', 'version', 'whatchanged', 'worktree',
  'write-tree',
]);
const SUBCOMANDOS_GH = new Set([
  'pr', 'issue', 'repo', 'release', 'run', 'workflow', 'gist', 'auth', 'browse', 'codespace', 'label',
  'search', 'secret', 'variable', 'status', 'cache', 'project', 'ruleset', 'attestation', 'org',
  'completion', 'help', 'ssh-key', 'gpg-key',
]);

// Opciones de `git commit` que consumen el siguiente argumento.
const COMMIT_LARGAS_CON_ARG = new Set([
  '--message', '--file', '--reuse-message', '--reedit-message', '--fixup', '--squash',
  '--author', '--date', '--template', '--cleanup', '--trailer',
]);
const COMMIT_CORTAS_CON_ARG = 'mFCct';

function analizarCommit(args) {
  let todos = false;
  let rutas = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      if (i + 1 < args.length) rutas = true;
      break;
    }
    if (a.startsWith('--')) {
      const nombre = a.split('=')[0];
      if (nombre === '--all') todos = true;
      else if (nombre === '--patch' || nombre === '--interactive' || nombre === '--pathspec-from-file') rutas = true;
      else if (COMMIT_LARGAS_CON_ARG.has(nombre) && !a.includes('=')) i += 1;
    } else if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        const ch = a[k];
        if (ch === 'a') todos = true;
        else if (ch === 'p') rutas = true;
        if (COMMIT_CORTAS_CON_ARG.includes(ch)) {
          if (k === a.length - 1) i += 1; // el argumento es el siguiente token
          break; // el resto del token es el argumento
        }
      }
    } else {
      rutas = true; // pathspec: commitea el árbol de trabajo, no el stage
    }
  }
  return { todos, rutas };
}

function analizarGit(args, dir, compartido, tocar, info) {
  let d = dir;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '-C') {
      if (args[i + 1] !== undefined) d = resolverDir(d, args[i + 1]);
      i += 2;
    } else if (a === '-c' || a === '--namespace' || a === '--super-prefix' || a === '--config-env' || a === '--exec-path') {
      i += 2;
    } else if (a === '--git-dir' || a === '--work-tree') {
      if (args[i + 1] !== undefined) d = resolverDir(d, args[i + 1]);
      i += 2;
    } else if (a.startsWith('--git-dir=') || a.startsWith('--work-tree=')) {
      d = resolverDir(d, a.slice(a.indexOf('=') + 1));
      i += 1;
    } else if (a.startsWith('-')) {
      i += 1; // --no-pager, -P, --bare, etc.
    } else {
      break;
    }
  }
  tocar(d);
  const sub = args[i];
  if (SUBCOMANDOS_GIT.has(sub)) info.resuelto = true;
  const ops = [];
  if (sub === 'commit') {
    const { todos, rutas } = analizarCommit(args.slice(i + 1));
    const op = { op: 'commit', dir: d, todos };
    if (rutas) op.rutas = true;
    if (compartido.indice) op.previo = true;
    else if (compartido.agregados?.length) op.agregados = [...compartido.agregados];
    ops.push(op);
  } else if (sub === 'push' || (sub === 'subtree' && args.slice(i + 1).includes('push'))) {
    const op = { op: 'push', dir: d };
    // --dry-run / -n (también combinado, p. ej. -nv) no publica: lo usa post-tool para no registrar el paso.
    if (args.slice(i + 1).some((a) => a === '--dry-run' || /^-[A-Za-z]*n[A-Za-z]*$/.test(a))) op.dryRun = true;
    // Qué se publica: refspecs después del remoto, y si publica más que una rama (--all, --mirror, subtree).
    // Lo usa el rechequeo de pasos no aplica, que sólo mira la rama actual.
    const resto = args.slice(i + 1);
    const posicionales = [];
    for (let k = 0; k < resto.length; k++) {
      const a = resto[k];
      if (CON_VALOR_PUSH.has(a)) k++;
      else if (!a.startsWith('-')) posicionales.push(a);
    }
    if (sub === 'subtree' || resto.some((a) => a === '--all' || a === '--mirror' || a === '--branches')) op.amplio = true;
    else if (posicionales.length > 1) op.refspecs = posicionales.slice(1);
    ops.push(op);
  }
  // `git add <rutas explícitas>` se recuerda para el commit del mismo comando (vale si todo es libre); un add
  // amplio (-A, -u, ., :/) o cualquier otro cambio de índice obliga a commitear en un comando aparte.
  const agregadas = sub === 'add' ? rutasDeAdd(args.slice(i + 1)) : null;
  if (agregadas) (compartido.agregados ??= []).push(...agregadas.map((r) => ({ dir: d, ruta: r })));
  else if (CAMBIAN_INDICE.has(sub)) compartido.indice = true;
  return ops;
}

// `node <…rq.mjs|$RQ> aprobar|autonomia|saltar|clasificacion|ejecucion …`: la frase que se va a registrar ({ op: 'frase' }), o null.
function fraseDeRq(args, dir) {
  const ws = [];
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '--rq') k++;
    else ws.push(args[k]);
  }
  const [script, sub, accion] = ws;
  if (!SUBS_CON_FRASE.has(sub)) return null;
  // `clasificacion cambiar <c> "<frase>"`: la frase va un lugar más adelante.
  const frase = sub === 'clasificacion' && accion === 'cambiar' ? ws[4] : ws[3];
  const s = String(script ?? '');
  if (!/rq\.mjs$/i.test(s.replace(/\\/g, '/')) && !/\$\{?RQ\b/.test(s)) return null;
  return { op: 'frase', dir, sub, frase: typeof frase === 'string' ? frase : '' };
}

// Rutas explícitas de un `git add`, o null si agrega de forma amplia o con opciones que no se pueden seguir.
function rutasDeAdd(args) {
  const rutas = [];
  let soloRutas = false;
  for (const a of args) {
    if (!soloRutas && a === '--') {
      soloRutas = true;
      continue;
    }
    if (!soloRutas && a.startsWith('-')) {
      if (a === '-v' || a === '--verbose' || a === '-f' || a === '--force') continue;
      return null; // -A, -u, -p, -N, --all, --update, --pathspec-from-file, …
    }
    if (a === '.' || a === './' || a === ':/' || a === '*' || /[*?[]/.test(a)) return null;
    rutas.push(a.replace(/\/+$/, '')); // una carpeta se expande al evaluar (agregadosLibres)
  }
  return rutas.length ? rutas : null;
}

// owner/name de una URL de PR de GitHub, o null.
function repoDeUrl(a) {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/i.exec(a);
  return m ? `${m[1]}/${m[2]}` : null;
}

function analizarGh(args, dir, ghRepoEnv, info) {
  // -R/--repo pueden ir antes o después de `pr merge`; el resto son posicionales (o valores de otras opciones).
  let repoGh;
  let deUrl;
  const posicionales = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--repo' || a === '-R') {
      repoGh = args[i + 1];
      i += 1;
    } else if (a.startsWith('--repo=')) repoGh = a.slice(7);
    else if (a.startsWith('-R') && a.length > 2) repoGh = a.slice(2);
    else if (!a.startsWith('-')) {
      if (posicionales.length >= 2 && repoDeUrl(a)) deUrl = repoDeUrl(a);
      posicionales.push(a);
    }
  }
  if (SUBCOMANDOS_GH.has(posicionales[0])) info.resuelto = true;
  if (posicionales[0] === 'pr' && posicionales[1] === 'create') {
    // PLG-RAMAS: base y cabeza del PR, para no abrir PR de una rama de RQ directo a PROD.
    const op = { op: 'pr-create', dir };
    const valor = (largas, corta) => {
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (largas.includes(a) || a === corta) return args[i + 1];
        const pegada = largas.find((l) => a.startsWith(`${l}=`));
        if (pegada) return a.slice(pegada.length + 1);
        if (a.startsWith(corta) && a.length > 2 && !a.startsWith('--')) return a.slice(2);
      }
      return undefined;
    };
    const base = valor(['--base'], '-B');
    const head = valor(['--head'], '-H');
    if (base) op.base = base;
    if (head) op.head = head.includes(':') ? head.split(':').pop() : head;
    if (repoGh || ghRepoEnv) op.repoGh = repoGh || ghRepoEnv;
    return [op];
  }
  if (posicionales[0] !== 'pr' || posicionales[1] !== 'merge') return [];
  const destino = repoGh || deUrl || ghRepoEnv;
  // El PR (número, URL o rama) sirve para leer su rama base cuando el proyecto declara ramas_prod.
  const op = { op: 'merge-pr', dir };
  if (destino) op.repoGh = destino;
  if (posicionales[2]) op.pr = posicionales[2];
  return [op];
}

// Consume las opciones de un envoltorio. Devuelve { resto, dir?, split? }.
function saltearEnvoltorio(def, args, dir) {
  let i = 0;
  let d = dir;
  let split;
  while (i < args.length && args[i].startsWith('-') && args[i] !== '-') {
    const a = args[i];
    if (a === '--') {
      i += 1;
      break;
    }
    const [nombre, valorPegado] = a.startsWith('--') ? [a.split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : undefined] : [a.slice(0, 2), a.length > 2 ? a.slice(2) : undefined];
    let valor = valorPegado;
    if (def.conArg.includes(nombre) && valor === undefined) {
      valor = args[i + 1];
      i += 1;
    }
    if (valor !== undefined && def.dir?.includes(nombre)) d = resolverDir(d, valor);
    if (valor !== undefined && def.split?.includes(nombre)) split = valor;
    i += 1;
  }
  for (let k = 0; k < (def.posicionales ?? 0) && i < args.length; k++) i += 1;
  return { resto: args.slice(i), dir: d, split };
}

// ---------------------------------------------------------------------------
// Escrituras a archivos protegidos (estado.yml, ACTIVO, transcript). Best effort: redirecciones de salida y
// `sed -i`, `tee`, `cp`, `mv`. No se ven `dd of=`, `install`, `python -c`, editores, etc.
// ---------------------------------------------------------------------------

const posicionalesDe = (args) => args.filter((a) => a !== '--' && !(a.startsWith('-') && a.length > 1));

// cp/mv: el destino es el último posicional (o -t DIR); si es una carpeta, cada origen cae adentro.
function destinosCopia(args, dir) {
  let t;
  const resto = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-t' || a === '--target-directory') t = args[++i];
    else if (a.startsWith('--target-directory=')) t = a.slice(19);
    else if (a.startsWith('-t') && a.length > 2 && !a.startsWith('--')) t = a.slice(2);
    else resto.push(a);
  }
  const pos = posicionalesDe(resto);
  const destino = t ?? pos.pop();
  if (destino === undefined) return [];
  const origenes = pos;
  let esCarpeta = t !== undefined || /[/\\]$/.test(destino);
  if (!esCarpeta) {
    try {
      esCarpeta = fs.statSync(resolverDir(dir, destino)).isDirectory();
    } catch {
      // no existe: es el archivo destino
    }
  }
  return esCarpeta ? origenes.map((o) => path.join(destino, path.basename(o))) : [destino];
}

const ESCRIBEN = {
  sed: (args) =>
    args.some((a) => a === '--in-place' || a.startsWith('--in-place=') || /^-[A-Za-z]*i/.test(a)) ? posicionalesDe(args) : [],
  tee: (args) => posicionalesDe(args),
  cp: destinosCopia,
  mv: destinosCopia,
};

function escriturasProhibidas(rutas, dir) {
  const ops = [];
  for (const r of rutas) {
    const abs = resolverDir(dir, r);
    const motivo = escrituraProhibida(abs);
    if (motivo) ops.push({ op: 'escritura', dir, ruta: abs, motivo });
  }
  return ops;
}

// `info.resuelto` queda en true si el segmento es `git <subcomando conocido>` o `gh <subcomando conocido>`.
function analizarSegmento(palabras, estado, compartido, entradas = [], info = {}) {
  let ws = palabras;
  let dir = estado.cwd;
  let ghRepoEnv;
  for (;;) {
    if (ws.length === 0) return [];
    if (esAsignacion(ws[0])) {
      const [k, v] = [ws[0].slice(0, ws[0].indexOf('=')), ws[0].slice(ws[0].indexOf('=') + 1)];
      if (k === 'GH_REPO' && v) ghRepoEnv = v;
      // RQ='node …/rq.mjs': después `$RQ aprobar …` se lee como node rq.mjs aprobar ….
      if (/rq\.mjs/i.test(v)) (compartido.varsRq ??= new Set()).add(k);
      ws = ws.slice(1);
      continue;
    }
    if (PALABRAS_CLAVE.has(ws[0])) {
      ws = ws.slice(1);
      continue;
    }
    const def = ENVOLTORIOS[nombreCmd(ws[0])];
    if (def) {
      const r = saltearEnvoltorio(def, ws.slice(1), dir);
      dir = r.dir;
      estado.tocados.add(dir);
      if (r.split !== undefined) {
        return analizar([r.split, ...r.resto.map(citar)].join(' '), dir, compartido);
      }
      ws = r.resto;
      continue;
    }
    break;
  }
  const cmd = nombreCmd(ws[0]);
  const args = ws.slice(1);
  if (cmd === 'cd' || cmd === 'pushd') {
    const destino = args.filter((a) => a !== '--' && !/^-[LPe@]+$/.test(a))[0];
    if (destino !== undefined && destino !== '-') estado.cwd = resolverDir(estado.cwd, destino);
    estado.tocados.add(estado.cwd);
    return [];
  }
  if (cmd === 'eval') return analizar(args.join(' '), dir, compartido);
  if (SHELLS.has(cmd)) {
    const k = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
    if (k !== -1 && args[k + 1] !== undefined) return analizar(args[k + 1], dir, compartido);
    return shellSinC(dir, entradas, compartido);
  }
  if (cmd === 'powershell' || cmd === 'pwsh') {
    const k = args.findIndex((a) => /^-(c|command)$/i.test(a));
    if (k !== -1 && args[k + 1] !== undefined) return analizar(args.slice(k + 1).join(' '), dir, compartido);
    return shellSinC(dir, entradas, compartido);
  }
  if (ESCRIBEN[cmd]) return escriturasProhibidas(ESCRIBEN[cmd](args, dir), dir);
  if (cmd === 'node') {
    const op = fraseDeRq(args, dir);
    if (op) return [op];
  }
  // `$RQ <subcomando>` con la variable armada como 'node <ruta de rq.mjs>' (en este comando o, por nombre, RQ).
  const variable = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(ws[0] ?? '')?.[1];
  if (variable && (variable === 'RQ' || compartido.varsRq?.has(variable))) {
    const op = fraseDeRq(['$RQ', ...args], dir);
    if (op) return [op];
  }
  if (cmd === 'git') return analizarGit(args, dir, compartido, (d) => estado.tocados.add(d), info);
  if (cmd === 'gh') return analizarGh(args, dir, ghRepoEnv, info);
  return [];
}

const citar = (w) => `'${String(w).replace(/'/g, "'\\''")}'`;

// Shell sin -c: ejecuta lo que le entra por stdin (heredoc, here-string o pipe). Se analiza ese texto y se
// registra el shell para la red de seguridad sobre el comando completo.
function shellSinC(dir, entradas, compartido) {
  compartido.shells.push(dir);
  return entradas.flatMap((t) => analizar(t, dir, compartido));
}

// Cantidad de menciones de `palabra` después de `cmd` en la misma línea del texto normalizado.
function menciones(normal, cmd, palabra) {
  const reCmd = new RegExp(`\\b${cmd}\\b`);
  const rePal = new RegExp(`\\b${palabra}\\b`, 'g');
  let n = 0;
  for (const linea of normal.split('\n')) {
    const m = reCmd.exec(linea);
    if (m) n += (linea.slice(m.index + m[0].length).match(rePal) ?? []).length;
  }
  return n;
}

// Análisis que produjo cada op. Las ops de un análisis anidado (stdin de un shell, sustituciones, bash -c,
// eval) no salen del texto sin comillas del nivel actual, así que no cuentan contra sus menciones.
// Las de un segmento `git/gh <subcomando>` resuelto quedan con RESUELTA: su texto no entra a la red.
const ORIGEN = new WeakMap();
const RESUELTA = {};

function analizar(comando, cwd, compartido) {
  const ops = [];
  const agregar = (nuevas) => {
    for (const o of nuevas) {
      if (!ORIGEN.has(o)) ORIGEN.set(o, estado);
      ops.push(o);
    }
  };
  const inicial = path.resolve(cwd);
  const estado = { cwd: inicial, tocados: new Set([inicial]) };
  const pila = [];
  let palabras = [];
  let citadas = []; // argumentos entre comillas del segmento actual
  let entradas = []; // texto que entra por stdin al segmento actual
  let delPipe = []; // lo que llega por `|`: comillas, stdin y pipe de todas las etapas anteriores
  let normal = ''; // texto sin comillas, para la red de seguridad
  let segmento = ''; // texto sin comillas del segmento actual
  const terminar = (op) => {
    const info = { resuelto: false };
    if (palabras.length > 0) {
      const nuevas = analizarSegmento(palabras, estado, compartido, [...entradas, ...delPipe], info);
      // Sus menciones no entran a `normal`, así que sus ops tampoco cuentan como propias.
      if (info.resuelto) for (const o of nuevas) if (!ORIGEN.has(o)) ORIGEN.set(o, RESUELTA);
      agregar(nuevas);
    }
    // Un segmento que el parser resolvió como git/gh <subcomando> no cuenta para la red: sus ops ya las vio.
    if (!info.resuelto) normal += segmento;
    segmento = '';
    // A un `| shell` le llega lo que imprime el productor: sus argumentos entre comillas, su propio
    // stdin y lo que le llegó por el pipe anterior (acumulado por todas las etapas: `| tee | bash`).
    delPipe = op === '|' ? [...citadas, ...entradas, ...delPipe] : [];
    palabras = [];
    citadas = [];
    entradas = [];
    estado.tocados.add(estado.cwd);
  };
  for (const tk of tokenizar(comando)) {
    if (tk.t === 'sub') {
      agregar(analizar(tk.v, estado.cwd, compartido));
      continue;
    }
    if (tk.t === 'in') {
      entradas.push(tk.v);
      continue;
    }
    if (tk.t === 'redir') {
      agregar(escriturasProhibidas([tk.v], estado.cwd));
      continue;
    }
    if (tk.t === 'w') {
      palabras.push(tk.v);
      if (tk.q && palabras.length > 1) citadas.push(tk.v);
      // Un argumento entre comillas (mensaje de commit, echo "...") no cuenta para la red;
      // la posición de comando sí, aunque tenga comillas.
      segmento += ` ${tk.q && palabras.length > 1 ? '_' : tk.v}`;
      continue;
    }
    terminar(tk.v);
    normal += ` ${tk.v}`;
    if (tk.v === '(') pila.push(estado.cwd);
    else if (tk.v === ')' && pila.length > 0) estado.cwd = pila.pop();
  }
  terminar(null);

  // Red de seguridad (falla cerrada): si el texto menciona más git … push / gh … merge que los que vio el
  // parser en ese mismo texto, se agrega la operación en cada carpeta que tocó el comando y que todavía no
  // la tiene. Las ops de análisis anidados (stdin de un shell, sustituciones, bash -c) no cuentan.
  for (const o of ops) estado.tocados.add(o.dir);
  const red = (tipo, cmd, palabra) => {
    const propias = ops.filter((o) => o.op === tipo && ORIGEN.get(o) === estado).length;
    if (menciones(normal, cmd, palabra) <= propias) return;
    for (const d of estado.tocados) {
      if (!ops.some((o) => o.op === tipo && o.dir === d)) agregar([{ op: tipo, dir: d, red: true }]);
    }
  };
  red('push', 'git', 'push');
  red('merge-pr', 'gh', 'merge');
  return ops;
}

const RED_SHELL_PUSH = /\bgit\b[\s\S]*\bpush\b/;
const RED_SHELL_MERGE = /\bgh\b[\s\S]*\bmerge\b/;

/**
 * Operaciones git relevantes del comando: [{ op: 'commit'|'push'|'merge-pr', dir, todos?, rutas?, previo?, repoGh?, red? }].
 * `red: true` = la agregó la red de seguridad (no la vio el parser): bloquea, pero post-tool no la registra.
 */
export function operacionesGit(comando, cwd) {
  const compartido = { indice: false, shells: [] };
  const ops = analizar(comando, cwd, compartido);
  // Un shell sin -c ejecuta texto que no siempre se puede reconstruir: si el comando completo (con comillas)
  // menciona git … push o gh … merge, se agrega la operación en la carpeta de cada shell que no la tenga.
  const texto = String(comando ?? '');
  for (const [tipo, re] of [['push', RED_SHELL_PUSH], ['merge-pr', RED_SHELL_MERGE]]) {
    if (!re.test(texto)) continue;
    for (const d of new Set(compartido.shells)) {
      if (!ops.some((o) => o.op === tipo && o.dir === d)) ops.push({ op: tipo, dir: d, red: true });
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

const git = (dir, args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Hash del árbol que quedaría commiteado con lo que hay en stage. */
export function arbolEnStage(dir) {
  return git(dir, ['write-tree']).trim();
}

/** Archivos en stage, relativos a la raíz del repo git (POSIX). */
export function archivosEnStage(dir) {
  return git(dir, ['diff', '--cached', '--name-only', '-z']).split('\0').filter((p) => p !== '');
}

const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

// Pasa rutas relativas al toplevel de git a rutas relativas a la raíz de .bacg-lineamientos (null = afuera).
function relativasARaiz(dir, raiz, archivos) {
  const top = real(git(dir, ['rev-parse', '--show-toplevel']).trim());
  const r = real(raiz);
  const raizEnTop = relativaAlRepo(top, r);
  if (raizEnTop === '') return archivos;
  if (raizEnTop !== null) {
    const pre = `${raizEnTop}/`;
    return archivos.map((p) => (p.startsWith(pre) ? p.slice(pre.length) : null));
  }
  const topEnRaiz = relativaAlRepo(r, top);
  if (topEnRaiz === null) return archivos.map(() => null);
  return archivos.map((p) => (topEnRaiz === '' ? p : `${topEnRaiz}/${p}`));
}

// ---------------------------------------------------------------------------
// Evaluación
// ---------------------------------------------------------------------------

const deny = (motivo) => ({ decision: 'deny', motivo });

// RQ activos del repo con estado legible: [{ codigo, estado }], del más reciente al más viejo.
// { sinRq } si no hay ninguno; { deny } si hay pero ninguno se puede leer.
function cargarRqs(raiz, accion, ctx) {
  const codigos = rqsActivos(raiz);
  if (codigos.length === 0) {
    return { sinRq: true, deny: deny(`No hay RQ activo en ${raiz}: abrilo con ${cli()} abrir antes de ${accion}.`) };
  }
  const rqs = [];
  let error = null;
  for (const codigo of [...codigos].reverse()) {
    try {
      rqs.push({ codigo, estado: cargarEstado(raiz, codigo) });
    } catch (e) {
      error = error ?? e;
    }
  }
  if (rqs.length === 0) return { deny: deny(`${error.message}. Revisá docs/rq/ACTIVO o corré ${cli()} abrir.`) };
  const textosUsuario = Array.isArray(ctx?.textosUsuario) ? ctx.textosUsuario : [];
  return { rqs, ctxEtapa: { raiz, textosUsuario } };
}

/**
 * ¿Todo lo que agrega el `git add` del mismo comando es libre (docs, tests)? estado.yml y ACTIVO también: sólo
 * los escribe rq.mjs (compuertas de edición y de Bash) y commitearlos no cambia lo que leen las compuertas.
 */
function primerAgregadoNoLibre(op, raiz, proyecto) {
  for (const { dir, ruta } of op.agregados) {
    const abs = path.resolve(dir, ruta);
    const rel = relativaAlRepo(raiz, abs);
    if (rel === null || rel === '') return ruta;
    let esCarpeta = false;
    try {
      esCarpeta = fs.statSync(abs).isDirectory();
    } catch {
      // no existe: un borrado, se clasifica por la ruta
    }
    if (!esCarpeta) {
      if (tipoArchivo(rel, proyecto) !== 'libre') return rel;
      continue;
    }
    // Una carpeta agrega lo modificado, borrado y nuevo que tiene adentro: cada archivo tiene que ser libre.
    let archivos;
    try {
      archivos = git(raiz, ['ls-files', '-m', '-d', '-o', '--exclude-standard', '-z', '--', rel]).split('\0').filter(Boolean);
    } catch {
      return rel;
    }
    const otro = relativasARaiz(raiz, raiz, archivos).find((r) => r === null || tipoArchivo(r, proyecto) !== 'libre');
    if (otro !== undefined) return otro ?? rel;
  }
  return null;
}

// Rutas (relativas a la raíz; null = fuera del repo) que agrega el git add del mismo comando; una carpeta se expande.
function rutasAgregadas(op, raiz) {
  const out = [];
  for (const { dir, ruta } of op.agregados ?? []) {
    const abs = path.resolve(dir, ruta);
    const rel = relativaAlRepo(raiz, abs);
    if (rel === null || rel === '') { out.push(null); continue; }
    let esCarpeta = false;
    try {
      esCarpeta = fs.statSync(abs).isDirectory();
    } catch {
      // no existe: un borrado, se toma la ruta
    }
    if (!esCarpeta) { out.push(rel); continue; }
    try {
      out.push(...relativasARaiz(raiz, raiz, git(raiz, ['ls-files', '-m', '-d', '-o', '--exclude-standard', '-z', '--', rel]).split('\0').filter(Boolean)));
    } catch {
      out.push(null);
    }
  }
  return out;
}

function evaluarCommit(op, ctx, dirLin) {
  const repo = buscarRepo(op.dir);
  if (!repo) return null;
  if (op.todos) return deny(MSG_TODOS());
  if (op.rutas) return deny(MSG_RUTAS());
  if (op.previo) return deny(MSG_PREVIO());

  let proyecto = null;
  try {
    proyecto = cargarProyecto(repo.proyectoId, dirLin, repo.raiz);
  } catch {
    // sin proyecto registrado: se clasifica sólo con las reglas generales
  }
  const enStage = archivosEnStage(op.dir);
  const rels = relativasARaiz(op.dir, repo.raiz, enStage);
  const iNoLibre = rels.findIndex((rel) => rel === null || tipoArchivo(rel, proyecto) !== 'libre');
  const stageLibre = iNoLibre === -1;
  // Exploración: todo lo que va a stage (libre o no) queda en docs/rq/<código>/, salvo lo que escribe la CLI.
  const todas = [...rels, ...(op.agregados ? rutasAgregadas(op, repo.raiz) : [])];
  if (todas.length) {
    for (const codigo of rqsActivos(repo.raiz)) {
      let estado;
      try { estado = cargarEstado(repo.raiz, codigo); } catch { continue; }
      if (fueraDeSonda(estado, todas) !== null) return deny(MSG_EXPLORACION_FUERA(estado.codigo));
    }
  }
  if (op.agregados) {
    const traba = stageLibre ? primerAgregadoNoLibre(op, repo.raiz, proyecto) : `${enStage[iNoLibre]} (ya estaba en stage)`;
    return traba === null ? null : deny(MSG_PREVIO(traba));
  }
  if (stageLibre) return null;

  const r = cargarRqs(repo.raiz, 'commitear código', ctx);
  if (r.deny) return r.deny;
  // M7: código de un RQ directo en una rama que sólo recibe PR (o en una de PROD) no se commitea.
  const protegida = enRamaProtegida(op.dir, proyecto);
  if (protegida && !r.rqs.some(({ estado }) => saltoValido(estado, 'rama'))) {
    const codigo = r.rqs[0]?.codigo ?? '<código>';
    return deny(`${protegida} sólo recibe cambios por PR: el código del RQ va en su rama. Pasá a ${ramaDelRq(codigo)} (git switch -c ${ramaDelRq(codigo)}; los cambios en stage viajan con el switch) y commiteá ahí.`);
  }
  for (const { estado } of r.rqs) {
    if (saltoValido(estado, 'commit')) return null;
    if (testsValenParaStage(estado.tests, op.dir)) return null;
  }
  if (comandosTests(proyecto).length === 0) return deny(`${MSG_TESTS()} ${PISTA_SIN_TESTS}`);
  return deny(MSG_TESTS());
}

const PISTA_PADRE = 'Si el RQ vive en el padre, corré el merge desde el padre con --repo <owner>/<sede>.';

// ¿El repo local (raiz) figura en proyecto.repos con rol padre?
function esPadre(raiz, proyecto) {
  const repos = Array.isArray(proyecto?.repos) ? proyecto.repos : [];
  const nombre = norm(nombreRepo(raiz));
  const local = repos.find((r) => norm(r?.nombre) === nombre);
  return local?.rol === 'padre';
}

function gitTexto(raiz, args) {
  try {
    return execFileSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const sinRefsHeads = (r) => r.replace(/^refs\/heads\//, '');

/**
 * Ramas que actualiza la publicación, o null si no se pueden resolver (entonces es PROD: falla cerrada).
 * - push con refspecs: el destino de cada uno (lo que va después de `:`; sin `:`, el refspec mismo; HEAD = la rama
 *   actual). Sin refspecs: la rama de upstream de la actual (branch.<rama>.merge). --all, --mirror y subtree: null.
 * - merge de un PR: su rama base (gh pr view --json baseRefName; ctx.basePr la inyecta en los tests).
 */
export function ramasDestino(op, raiz, ctx) {
  if (op.op === 'merge-pr') {
    if (typeof ctx?.basePr === 'function') return [ctx.basePr(op)].filter(Boolean);
    try {
      const args = ['pr', 'view', ...(op.pr ? [op.pr] : []), ...(op.repoGh ? ['-R', op.repoGh] : []), '--json', 'baseRefName', '-q', '.baseRefName'];
      const b = execFileSync('gh', args, { cwd: raiz, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return b ? [b] : null;
    } catch {
      return null;
    }
  }
  if (op.amplio) return null;
  const actual = gitTexto(raiz, ['symbolic-ref', '-q', '--short', 'HEAD']);
  const refspecs = Array.isArray(op.refspecs) ? op.refspecs : [];
  if (refspecs.length === 0) {
    const merge = actual ? gitTexto(raiz, ['config', '--get', `branch.${actual}.merge`]) : null;
    return merge ? [sinRefsHeads(merge)] : null;
  }
  const out = [];
  for (const r of refspecs) {
    const [origen, dst] = r.replace(/^\+/, '').split(':');
    let rama = sinRefsHeads(dst === undefined ? origen : dst);
    if (rama === 'HEAD' || rama === '@') rama = actual;
    if (!rama || rama.startsWith('refs/')) return null; // tags u otras refs: no se sabe, PROD
    out.push(rama);
  }
  return out;
}

/**
 * ¿La publicación va a PROD? Un repo con push_prod: false nunca; si el proyecto o el repo declaran ramas_prod, sólo
 * cuando actualiza una de esas ramas (o no se puede resolver cuál); si no, siempre (como antes de ramas_prod).
 */
export function publicaEnProd(op, raiz, proyecto, entrada, ctx) {
  if (entrada && entrada.push_prod === false) return false;
  if (!entrada) return true;
  const ramas = ramasProd(proyecto, entrada);
  if (ramas === null) return true;
  const destinos = ramasDestino(op, raiz, ctx);
  if (destinos === null || destinos.length === 0) return true;
  return destinos.some((d) => ramas.includes(d));
}

/**
 * ¿`owner/repo` (o `repo`, o la URL del PR) es de un proyecto que este plugin reconoce? Mira los proyectos del
 * registro y los que tienen la configuración en su repo debajo de `cwd` o en ~/.claude/bacg-dev.json: el nombre tiene
 * que estar en `repos` y, si el proyecto declara `cuenta_github` y el destino trae dueño, el dueño tiene que coincidir.
 */
function repoGhPropio(repoGh, dirLin, cwd) {
  const partes = String(repoGh)
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\/pull\/.*$/i, '')
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean);
  const nombre = (partes.pop() ?? '').toLowerCase();
  const dueno = (partes.pop() ?? '').toLowerCase();
  if (!nombre) return false;
  return proyectosRegistrados(dirLin, { locales: proyectosLocales({ cwd }) }).some(({ proyecto }) => {
    const cuenta = typeof proyecto?.cuenta_github === 'string' ? proyecto.cuenta_github.trim().toLowerCase() : '';
    if (cuenta && dueno && cuenta !== dueno) return false;
    const repos = Array.isArray(proyecto?.repos) ? proyecto.repos : [];
    return repos.some((r) => typeof r?.nombre === 'string' && r.nombre.toLowerCase() === nombre);
  });
}

// Repo destino de un push/merge: { raiz, proyecto?, error?, fuera?, nombre, prod }, o null si no hay .bacg-lineamientos.
function destino(op, dirLin, ctx) {
  const repo = buscarRepo(op.dir);
  if (!repo) {
    // Merge explícito a otro repo desde un directorio sin .bacg-lineamientos: si el destino es de un proyecto
    // propio, no se puede verificar el RQ y se niega; si tampoco es propio, no es asunto de este plugin
    // (PLG-DFF, pedido 5: otro plugin u organización mergea los PR de sus repos con --repo).
    if (op.op === 'merge-pr' && op.repoGh && repoGhPropio(op.repoGh, dirLin, op.dir)) {
      return { fuera: true, nombre: String(op.repoGh), prod: true };
    }
    return null;
  }
  const nombreGh = op.repoGh ? String(op.repoGh).split('/').pop().replace(/\.git$/i, '') : null;
  const nombre = nombreGh || nombreRepo(repo.raiz);
  let proyecto;
  try {
    proyecto = cargarProyecto(repo.proyectoId, dirLin, repo.raiz);
  } catch (e) {
    return { raiz: repo.raiz, error: e.message, nombre, prod: true };
  }
  const repos = Array.isArray(proyecto?.repos) ? proyecto.repos : [];
  const entrada = repos.find(
    (r) => r && typeof r.nombre === 'string' && r.nombre.toLowerCase() === nombre.toLowerCase(),
  );
  // Falla cerrada: un repo que no figura en proyecto.repos, o sin push_prod explícito en false, es PROD; con
  // ramas_prod, sólo si la rama destino es una de ellas o no se puede resolver.
  // Ramas sólo por PR: un push directo cuya rama destino se resuelve y es una de ellas.
  let soloPr = null;
  const conPr = op.op === 'push' ? ramasSoloPr(proyecto, entrada) : [];
  if (conPr.length) {
    const ds = ramasDestino(op, repo.raiz, ctx) ?? [];
    soloPr = ds.find((d) => conPr.includes(d)) ?? null;
  }
  const prod = publicaEnProd(op, repo.raiz, proyecto, entrada, ctx);
  const nombreFinal = entrada ? entrada.nombre : nombre;
  // PLG-RAMAS: con ramas_prod y una rama de DEV, a PROD sólo llega lo que ya pasó por DEV.
  let sinDev = null;
  if (prod && entrada && entrada.push_prod !== false) {
    const orden = ordenDeRamas(proyecto, entrada);
    if (orden) sinDev = faltaPasarPorDev(op, repo.raiz, nombreFinal, orden, ramasDestino(op, repo.raiz, ctx), ctx);
  }
  return { raiz: repo.raiz, proyecto, nombre: nombreFinal, prod, soloPr, sinDev };
}

/**
 * Push que sólo publica documentación o tests (o nada): commits de la rama actual que el upstream no tiene y
 * que tocan sólo archivos libres. No necesita RQ ni circuito.
 */
function pushSoloLibres(op, dest) {
  if (op.op !== 'push' || !pushDeLaRamaActual(op, dest.raiz)) return false;
  let salida;
  try {
    salida = git(dest.raiz, ['diff', '--name-only', '--no-renames', '-z', '@{u}...HEAD']);
  } catch {
    return false; // sin upstream: no se sabe qué se publica
  }
  const archivos = salida.split('\0').filter(Boolean);
  const rels = relativasARaiz(dest.raiz, dest.raiz, archivos);
  return rels.every((rel) => rel !== null && tipoArchivo(rel, dest.proyecto) === 'libre');
}

/** Evalúa la publicación contra un RQ. Devuelve el deny o null. */
function publicacionDeRq(op, dest, codigo, estado, ctxEtapa, real, ctx) {
  // El salto de push saltea sólo la verificación (etapa 3): nunca el OK de PROD (5) ni el circuito de un destino PROD.
  if (!saltoValido(estado, 'push') && !etapaCumplida(estado, ETAPA.VERIFICACION, ctxEtapa)) {
    return deny(`Falta la etapa ${ETAPA.VERIFICACION} (tests en verde y revisión sin bloqueantes) del RQ ${codigo}.`);
  }
  // E2E obligatorio si el proyecto lo declara: verde registrado con rq.mjs verificar, o salto e2e del usuario.
  if (comandoE2e(dest.proyecto) && estado.e2e?.ok !== true && !saltoValido(estado, 'e2e') && !saltoValido(estado, 'push')) {
    return deny(`Falta el E2E en verde del RQ ${codigo}: corré ${cli()} verificar con la app levantada.`);
  }
  if (!dest.prod) return null;
  if (!etapaCumplida(estado, ETAPA.PROD, ctxEtapa)) {
    return deny(`Publicar ${dest.nombre} es PROD: falta el OK del usuario para PROD (etapa ${ETAPA.PROD}) en el RQ ${codigo}.`);
  }
  // Skills de proceso por etapa (requisitos.mjs) y, si el E2E corrió sólo los specs del RQ, la suite completa.
  // El salto de push (verificación salteada por el usuario) también saltea lo que exige la verificación.
  const faltan = saltoValido(estado, 'push') ? [] : faltaParaEtapa(estado, ETAPA.PROD, dest.raiz);
  if (faltan.length) return deny(`PROD del RQ ${codigo}: falta ${faltan.join('; ')}. Si el usuario decide saltearlo: ${cli()} saltar skills "<frase>" "<motivo>".`);
  if (estado.e2e?.ok === true && estado.e2e.completo === false && !saltoValido(estado, 'e2e') && !saltoValido(estado, 'push')) {
    return deny(`PROD del RQ ${codigo}: el E2E corrió sólo los specs del RQ; corré ${cli()} verificar --completo.`);
  }
  // Pasos y nombres de repo se comparan como en compuerta-mcp: trim + minúsculas.
  const paso = `${op.op === 'push' ? 'push' : 'merge-prs-sync'}:${dest.nombre}`;
  const rutas = rutasDelRq(dest.raiz, estado);
  // Para el merge de una sede también cuenta lo que trae su PR de sync (una migración anterior al RQ).
  const sedes = op.op === 'merge-pr' ? (ctx?.sedes ?? migracionesEnSync(dest.proyecto, dest.nombre)) : {};
  const falta = faltaAntes({ proyecto: dest.proyecto, estado, paso, raiz: dest.raiz, rutas, sedes, real });
  if (falta !== undefined) return deny(`Circuito de PROD: falta el paso ${falta} antes de ${paso}.`);
  // Un paso marcado a mano como no aplica se vuelve a comprobar contra lo que trae el RQ desde su base: pudo
  // entrar una migración o un estándar después de marcarlo.
  const noAplica = (Array.isArray(estado.circuito) ? estado.circuito : []).filter((c) => c?.no_aplica === true);
  if (noAplica.length === 0) return null;
  if (op.op === 'push' && !pushDeLaRamaActual(op, dest.raiz)) {
    return deny(
      'Circuito de PROD: con pasos marcados como no aplica sólo se pushea la rama actual (HEAD), sin refspecs de otras ramas, --all ni --mirror.',
    );
  }
  const base = typeof estado.base === 'string' && estado.base ? estado.base : null;
  if (!base) {
    return deny(
      `Circuito de PROD: el RQ no tiene base (estado.base) para comprobar los pasos marcados como no aplica: corré ${cli()} paso reabrir <paso> y volvé a marcarlo.`,
    );
  }
  const r = rutasDesde(dest.raiz, base, codigo);
  if (r.error) return deny(`Circuito de PROD: ${r.error} para comprobar los pasos marcados como no aplica.`);
  for (const c of noAplica) {
    const ruta = rutaQueImpide(c.paso, r.rutas, dest.proyecto);
    if (ruta) {
      return deny(
        `Circuito de PROD: ${c.paso} figura como no aplica, pero el cambio trae ${ruta}. Si corresponde, corré ${cli()} paso reabrir ${c.paso} y hacé el paso.`,
      );
    }
  }
  return null;
}

function evaluarPublicacion(op, dest, ctx) {
  if (!dest) return null;
  if (dest.fuera) {
    return deny(
      `Merge de ${dest.nombre} fuera de un repo registrado: corré el merge desde el repo del proyecto para que la compuerta pueda verificar el RQ.`,
    );
  }
  if (dest.error) return deny(`${dest.error}: no puedo verificar la publicación de ${dest.nombre}.`);
  if (dest.sinDev && !saltoRamaActivo(dest.raiz, ctx)) return deny(dest.sinDev);
  if (pushSoloLibres(op, dest)) return null;
  const r = cargarRqs(dest.raiz, 'publicar', ctx);
  if (r.sinRq && !esPadre(dest.raiz, dest.proyecto)) return deny(`${r.deny.motivo} ${PISTA_PADRE}`);
  if (r.deny) return r.deny;
  const real = ctx?.real ?? hechoEnRealidad;
  let primero = null;
  for (const { codigo, estado } of r.rqs) {
    const d = publicacionDeRq(op, dest, codigo, estado, r.ctxEtapa, real, ctx);
    if (!d) return null;
    primero = primero ?? d;
  }
  return primero;
}

/** ¿Algún RQ activo del repo tiene el salto de rama del usuario? (hotfix directo a PROD, commit en rama protegida) */
function saltoRamaActivo(raiz, ctx) {
  const r = cargarRqs(raiz, 'publicar', ctx);
  return Array.isArray(r.rqs) && r.rqs.some(({ estado }) => saltoValido(estado, 'rama'));
}

/** PLG-RAMAS: `gh pr create` con base en PROD desde otra rama que la de DEV. */
function evaluarPrCreate(op, dirLin, ctx) {
  const repo = buscarRepo(op.dir);
  if (!repo) return null;
  const nombreGh = op.repoGh ? String(op.repoGh).split('/').pop().replace(/.git$/i, '') : null;
  const nombre = nombreGh || nombreRepo(repo.raiz);
  let proyecto;
  try {
    proyecto = cargarProyecto(repo.proyectoId, dirLin, repo.raiz);
  } catch {
    return null; // proyecto ilegible: abrir un PR no publica; el merge lo frena la compuerta
  }
  const entrada = (Array.isArray(proyecto?.repos) ? proyecto.repos : []).find((r) => typeof r?.nombre === 'string' && r.nombre.toLowerCase() === nombre.toLowerCase());
  if (!entrada) return null;
  const motivo = prAProdSinDev(op, repo.raiz, entrada.nombre, ordenDeRamas(proyecto, entrada), ctx);
  if (!motivo || saltoRamaActivo(repo.raiz, ctx)) return null;
  return deny(motivo);
}

/** La frase de `rq.mjs aprobar|autonomia|saltar` tiene que ser texto literal del usuario en la sesión. */
function evaluarFrase(op, ctx) {
  const textos = Array.isArray(ctx?.textosUsuario) ? ctx.textosUsuario : [];
  if (!buscarRepo(op.dir)) return null;
  // Vale si está en un mensaje (las cortas, sólo como mensaje entero) o si es una oración entera de uno: así cada
  // decisión de un mensaje como "Acotado + Aprobar diseño" se registra con su tramo.
  if (typeof op.frase === 'string' && op.frase.trim() !== '' && (fraseDelUsuario(op.frase, textos) || vecesQueLoDijo(op.frase, textos) > 0)) return null;
  return deny(MSG_FRASE(op.sub));
}

const resumirError = (e) => String(e?.message ?? e).replace(/\s+/g, ' ').trim().slice(0, 300);

// Red de seguridad para las frases (falla cerrada). Se miran las menciones del CLI del RQ (rq.mjs, $RQ o ${RQ})
// y toda variable ($X, ${X}), con o sin comillas, y el subcomando que les sigue (salteando --rq <X>):
// - subcomando con frase (aprobar, autonomia, saltar, clasificacion, ejecucion) detrás de una mención o de una
//   variable: tiene que haberlo leído el parser (op frase); si hay más que las leídas, se niega.
// - mención con un subcomando literal sin frase (abrir, commit, estado…): no cuenta, así que ni
//   `--clasificacion acotado` ni un mensaje de commit la disparan.
// - mención con cualquier otra cosa (una variable, una opción, el código de node -e o de un import) o sin
//   subcomando (una asignación `X=/ruta/rq.mjs`, un grep): ilegible. Si el texto nombra alguna de esas palabras
//   fuera de una posición de subcomando ya contada, se niega.
const RE_INVOCACION = /(rq\.mjs|\$\{?RQ\b\}?)['"]?|\$\{?[A-Za-z_]\w*\}?['"]?/gi;
const RE_SUB_FRASE = /\b(?:aprobar|autonomia|saltar|clasificacion|ejecucion)\b/gi;

function mencionesDeRq(texto) {
  let frases = 0;
  let ilegibles = 0;
  for (const m of texto.matchAll(RE_INVOCACION)) {
    const deRq = m[1] !== undefined;
    const resto = texto.slice(m.index + m[0].length).replace(/^\s+--rq(?:=|\s+)\S+/, '');
    const sub = /^\s+(['"]?)([A-Za-z][\w-]*)\1(?=$|[\s;&|])/.exec(resto)?.[2];
    if (sub && SUBS_CON_FRASE.has(sub.toLowerCase())) frases++;
    else if (deRq && !sub) ilegibles++;
  }
  return { frases, ilegibles };
}

function redDeFrases(texto, ops) {
  // Las frases que el parser leyó se validan aparte: sus palabras ("Aprobar diseño") no son subcomandos.
  for (const o of ops) {
    if (o.op === 'frase' && typeof o.frase === 'string' && o.frase.trim() !== '') texto = texto.replace(o.frase, ' ');
  }
  const { frases, ilegibles } = mencionesDeRq(texto);
  const leidas = ops.filter((o) => o.op === 'frase').length;
  if (frases > leidas) return true;
  // Con una mención ilegible, cada palabra tiene que ser un subcomando ya contado (y leído por el parser).
  const palabras = (texto.match(RE_SUB_FRASE) ?? []).length;
  return ilegibles > 0 && palabras > frases;
}

/**
 * Decide si un comando Bash (o PowerShell) puede correr.
 * ctx = { textosUsuario, real?, sedes? } (real y sedes, inyectables en los tests). Devuelve { decision, motivo?, critica }.
 */
export function evaluarBash({ comando, cwd, ctx, dirLin = dirLineamientos() }) {
  const ops = operacionesGit(comando, cwd);
  const texto = String(comando ?? '');
  // Mientras rq.mjs verificar corre el E2E, el mismo script no se lanza a mano (en cualquier carpeta).
  const choque = choqueE2e(texto);
  if (choque) return { ...deny(msgE2eEnCurso(choque)), critica: false };
  if (redDeFrases(texto, ops) && buscarRepo(cwd)) {
    return { ...deny(`El comando nombra rq.mjs con aprobar, autonomia, saltar, clasificacion o ejecucion en una forma que la compuerta no puede leer. Corrélo con la ruta literal, node "<ruta>/rq.mjs" <subcomando> "<frase>" (la de la línea CLI del RQ del arranque), o como ${cli()} <subcomando> "<frase>" con RQ asignado en el mismo comando (RQ="node <ruta>/rq.mjs"; ${cli()} …); sin node -e, eval ni otra variable en el medio.`), critica: false };
  }
  // `critica` se calcula para todas las operaciones antes de evaluar ninguna.
  const destinos = ops.map((op) => {
    if (op.op !== 'push' && op.op !== 'merge-pr') return undefined;
    try {
      return destino(op, dirLin, ctx);
    } catch (e) {
      return { inesperado: e, prod: true };
    }
  });
  const critica = destinos.some((d) => d?.prod === true);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    let r;
    try {
      if (destinos[i]?.inesperado) throw destinos[i].inesperado;
      if (op.op === 'escritura') r = deny(op.motivo);
      else if (op.op === 'frase') r = evaluarFrase(op, ctx);
      else if (op.op === 'push' && destinos[i]?.soloPr) {
        r = deny(`${destinos[i].nombre}: ${destinos[i].soloPr} sólo recibe cambios por PR. Pusheá tu rama (git push -u origin <rama>) y abrí un PR a ${destinos[i].soloPr} (gh pr create --base ${destinos[i].soloPr}).`);
      } else if (op.op === 'pr-create') r = evaluarPrCreate(op, dirLin, ctx);
      else r = op.op === 'commit' ? evaluarCommit(op, ctx, dirLin) : evaluarPublicacion(op, destinos[i], ctx);
    } catch (e) {
      r = deny(`No se pudo evaluar ${op.op} (${resumirError(e)})`);
    }
    if (r) return { ...r, critica };
  }
  return { decision: 'allow', critica };
}
