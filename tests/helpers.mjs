import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} falló: ${r.stderr}`);
  return r.stdout;
}

// Crea un repo git temporal (con un espacio en la ruta) y devuelve su ruta.
// Con `nombre`, el repo queda en <dir temporal>/<nombre> (para que su basename coincida con proyecto.repos).
export function crearRepoTemporal({ proyectoId, archivos = {}, nombre } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'como trabajo-'));
  const dir = nombre ? path.join(base, nombre) : base;
  if (nombre) fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  if (proyectoId) fs.writeFileSync(path.join(dir, '.bacg-lineamientos'), `proyecto: ${proyectoId}\n`);
  for (const [rel, contenido] of Object.entries(archivos)) {
    const destino = path.join(dir, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'inicial');
  return dir;
}

// Ejecuta plugin/scripts/hooks/<nombre>.mjs con la entrada JSON por stdin.
export function correrHook(nombre, entradaJson, env = {}) {
  const script = path.join(RAIZ, 'plugin', 'scripts', 'hooks', `${nombre}.mjs`);
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(entradaJson),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Sesión de Claude Code de prueba: un home temporal con la transcripción <home>/.claude/projects/<carpeta>/<id>.jsonl,
// que es donde rq.mjs verifica que las frases de aprobar, autonomia, saltar, clasificacion y ejecucion las escribió
// el usuario. `dijo` suma mensajes tipeados por el usuario; `entrada` suma una entrada cruda del transcript
// (subagente, resumen de compactación…). A main() van `home` (opción) y `env`; a un proceso hijo, sólo `env`
// (HOME/USERPROFILE hacen que os.homedir() sea el home temporal).
export function sesionDePrueba(...frases) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home sesion-'));
  const id = crypto.randomUUID();
  const dir = path.join(home, '.claude', 'projects', 'C--repo-de-prueba');
  fs.mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(ruta, '');
  const entrada = (e) => fs.appendFileSync(ruta, `${JSON.stringify(e)}\n`);
  const dijo = (...textos) => {
    for (const t of textos) entrada({ type: 'user', message: { role: 'user', content: t } });
  };
  dijo(...frases);
  return { id, home, ruta, env: { CLAUDE_CODE_SESSION_ID: id, HOME: home, USERPROFILE: home }, dijo, entrada };
}

/** La frase del usuario que registra un comando de rq.mjs (aprobar, autonomia, saltar, clasificacion, ejecucion), o null. */
export function fraseDe(args) {
  const a = args.filter((x, i) => x !== '--rq' && args[i - 1] !== '--rq');
  const i = { aprobar: 2, autonomia: 2, ejecucion: 2, saltar: 2, clasificacion: a[1] === 'cambiar' ? 3 : 2 }[a[0]];
  return i !== undefined && typeof a[i] === 'string' ? a[i] : null;
}
