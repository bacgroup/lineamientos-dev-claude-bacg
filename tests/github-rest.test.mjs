// PLG-CLOUD: todo lo que el plugin lee de GitHub va por REST (gh api), porque GraphQL da 403 en la nube. Estos tests
// ponen un `gh` falso primero en el PATH: responde por la ruta de la API y anota las llamadas, así se prueba el
// recorrido completo (args, parseo y mensajes) sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prsAbiertos, prsDeRama, archivosPr, checksDe, cuentaActual, resolverPr, ghJson } from '../plugin/scripts/lib/github.mjs';
import { prMergadoGhSeguro } from './helpers-github.mjs';
import { compiladosCompartidos } from '../plugin/scripts/lib/compilados.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// gh falso: lee respuestas de GH_FALSO_RESPUESTAS (JSON { "<prefijo de ruta>": <respuesta> }) y anota en GH_FALSO_LOG.
function instalarGhFalso(respuestas) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-falso-'));
  const log = path.join(dir, 'llamadas.log');
  const resp = path.join(dir, 'respuestas.json');
  fs.writeFileSync(resp, JSON.stringify(respuestas));
  const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] !== 'api') { process.stderr.write('GraphQL no disponible (403)'); process.exit(1); }
const r = JSON.parse(fs.readFileSync(${JSON.stringify(resp)}, 'utf8'));
const clave = Object.keys(r).sort((a, b) => b.length - a.length).find((k) => args[1].startsWith(k));
if (clave === undefined) { process.stderr.write('HTTP 404'); process.exit(1); }
if (r[clave] && r[clave].__error) { process.stderr.write(r[clave].__error); process.exit(1); }
process.stdout.write(JSON.stringify(r[clave]));
`;
  fs.writeFileSync(path.join(dir, 'gh'), script, { mode: 0o755 });
  const antes = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${antes}`;
  return {
    llamadas: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    restaurar: () => { process.env.PATH = antes; },
  };
}

test('github.mjs: PR abiertos, archivos, checks y cuenta, todo por gh api', () => {
  const gh = instalarGhFalso({
    'repos/o/r/pulls?state=open': [{ number: 3, title: 't', user: { login: 'ana' }, head: { ref: 'rq/X', sha: 'abc' }, base: { ref: 'dev' }, html_url: 'u' }],
    'repos/o/r/pulls/3/files': [{ filename: 'a/b.py' }],
    'repos/o/r/commits/abc/check-runs': { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'e2e', status: 'in_progress' }] },
    'repos/o/r/commits/abc/status': { statuses: [{ context: 'legacy', state: 'failure' }] },
    user: { login: 'cuenta-x' },
  });
  try {
    assert.deepEqual(prsAbiertos('o/r', { base: 'dev' }).datos.map((p) => [p.number, p.autor, p.head, p.base]), [[3, 'ana', 'rq/X', 'dev']]);
    assert.deepEqual(archivosPr('o/r', 3).datos, ['a/b.py']);
    assert.deepEqual(checksDe('o/r', 'abc').datos.map((c) => c.estado), ['ok', 'en-curso', 'fallo']);
    assert.equal(cuentaActual().datos, 'cuenta-x');
    assert.ok(gh.llamadas().every((a) => a[0] === 'api'), 'ninguna llamada fuera de gh api');
  } finally {
    gh.restaurar();
  }
});

test('github.mjs: un error (403, sin gh, JSON roto) vuelve como { error }, nunca como lista vacía', () => {
  const gh = instalarGhFalso({ 'repos/o/r/pulls': { __error: 'HTTP 403: access not enabled for this session' } });
  try {
    const r = prsAbiertos('o/r', { base: 'dev' });
    assert.match(r.error, /403/);
    assert.equal(r.datos, undefined);
  } finally {
    gh.restaurar();
  }
  assert.match(ghJson(['api', 'x'], { env: { ...process.env, PATH: '/no-existe' } }).error, /no está instalado|ENOENT/);
});

test('resolverPr: número directo o el PR abierto de la rama', () => {
  const gh = instalarGhFalso({ 'repos/o/r/pulls?state=open': [{ number: 9, head: { ref: 'rq/A' }, base: { ref: 'dev' } }] });
  try {
    assert.deepEqual(resolverPr({ pr: '#12', repoGh: 'o/r' }).datos, { repo: 'o/r', numero: 12 });
    assert.deepEqual(resolverPr({ repoGh: 'o/r', ramaActual: 'rq/A' }).datos, { repo: 'o/r', numero: 9 });
    assert.match(resolverPr({ repoGh: 'o/r' }).error, /rama/);
  } finally {
    gh.restaurar();
  }
});

test('rq-rama: el PR mergeado de rq/<código> sale por REST (state=closed y merged_at)', () => {
  const raiz = crearRepoTemporal({});
  git(raiz, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  const gh = instalarGhFalso({
    'repos/o/r/pulls?state=closed': [{ number: 4, merged_at: '2026-11-16T10:00:00Z', base: { ref: 'dev' }, head: { ref: 'rq/R-1' } }],
  });
  try {
    assert.deepEqual(prMergadoGhSeguro(raiz, 'R-1'), { numero: 4, base: 'dev', fecha: '2026-11-16T10:00:00Z' });
    assert.match(gh.llamadas()[0][1], /head=o%3Arq%2FR-1/);
  } finally {
    gh.restaurar();
  }
});

test('compilados: avisa si otra rama rq/* toca el mismo bundle; no si toca otro archivo', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'compilados-'));
  const origen = path.join(base, 'o.git');
  const raiz = crearRepoTemporal({ archivos: { 'static/reports.bundle.js': 'v0\n', 'src/a.ts': 'a\n' } });
  git(base, 'init', '-q', '--bare', origen);
  git(raiz, 'remote', 'add', 'origin', origen);
  git(raiz, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  const baseSha = git(raiz, 'rev-parse', 'HEAD').trim();
  // Otra rama rq/OTRO que regenera el bundle.
  git(raiz, 'switch', '-q', '-c', 'rq/OTRO');
  fs.writeFileSync(path.join(raiz, 'static', 'reports.bundle.js'), 'otro\n');
  git(raiz, 'commit', '-qam', 'feat(OTRO): bundle');
  git(raiz, 'push', '-q', 'origin', 'rq/OTRO');
  // Este RQ también lo regenera.
  git(raiz, 'switch', '-q', '-c', 'rq/R-1', baseSha);
  fs.writeFileSync(path.join(raiz, 'static', 'reports.bundle.js'), 'mio\n');
  git(raiz, 'commit', '-qam', 'feat(R-1): bundle');
  git(raiz, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*');
  const estado = { codigo: 'R-1', base: baseSha };
  const avisos = compiladosCompartidos(raiz, estado, {}, 'rq/R-1');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /rq\/OTRO también toca static\/reports\.bundle\.js/);
  assert.deepEqual(compiladosCompartidos(raiz, estado, { compilados: ['**/otro/**'] }, 'rq/R-1'), []);
});

test('prsDeRama: incluye estado y mergeado', () => {
  const gh = instalarGhFalso({ 'repos/o/r/pulls?state=all': [{ number: 1, state: 'closed', merged_at: 'x', base: { ref: 'main' }, head: { ref: 'b', sha: 's' } }] });
  try {
    assert.deepEqual(prsDeRama('o/r', 'b').datos.map((p) => [p.number, p.estado, p.mergeado]), [[1, 'closed', true]]);
  } finally {
    gh.restaurar();
  }
});

test('la compuerta reconoce crear y mergear un PR por REST, con base, cabeza, número y repo', async () => {
  const { operacionesGit } = await import('../plugin/scripts/lib/compuerta-bash.mjs');
  const raiz = crearRepoTemporal({});
  const crear = operacionesGit('gh api repos/o/r/pulls -f base=main -f head=rq/X -f title="t" -F body=@b.md', raiz);
  assert.deepEqual(crear.map((o) => [o.op, o.base, o.head, o.repoGh]), [['pr-create', 'main', 'rq/X', 'o/r']]);
  const crearPost = operacionesGit('gh api -X POST repos/o/r/pulls --field base=dev --field head=o:rq/Y', raiz);
  assert.deepEqual(crearPost.map((o) => [o.op, o.base, o.head]), [['pr-create', 'dev', 'rq/Y']]);
  const merge = operacionesGit('gh api -X PUT repos/o/r/pulls/7/merge -f merge_method=squash', raiz);
  assert.deepEqual(merge.map((o) => [o.op, o.pr, o.repoGh, Boolean(o.red)]), [['merge-pr', '7', 'o/r', false]]);
  const conInput = operacionesGit('gh api repos/o/r/pulls --input pr.json', raiz);
  assert.deepEqual(conInput.map((o) => [o.op, o.repoGh]), [['pr-create', 'o/r']]);
  // Leer un PR por la API no es una operación.
  assert.deepEqual(operacionesGit('gh api repos/o/r/pulls/7/files', raiz), []);
});

test('checksDe: si /status falla, la CI no se da por "sin checks"', () => {
  const gh = instalarGhFalso({
    'repos/o/r/commits/abc/check-runs': { check_runs: [] },
    'repos/o/r/commits/abc/status': { __error: 'HTTP 502' },
  });
  try {
    assert.match(checksDe('o/r', 'abc').error, /502/);
  } finally {
    gh.restaurar();
  }
});

test('merge por REST con gh en 403: la compuerta lo trata como PROD y lo niega sin RQ en etapa 5 (falla cerrada)', async () => {
  const { evaluarBash } = await import('../plugin/scripts/lib/compuerta-bash.mjs');
  const raiz = crearRepoTemporal({ archivos: { '.bacg-dev/proyecto.yml': 'id: demo\nnombre: Demo\ncuenta_github: o\nramas_prod: ["main"]\nrepos:\n  - { nombre: r }\n' } });
  git(raiz, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  const gh = instalarGhFalso({ 'repos/o/r/pulls': { __error: 'HTTP 403' } });
  try {
    const r = evaluarBash({ comando: 'gh api -X PUT repos/o/r/pulls/5/merge -f merge_method=squash', cwd: raiz, ctx: { textosUsuario: [] } });
    assert.equal(r.decision, 'deny');
    // Sin poder leer la base del PR, se trata como PROD (el motivo lo dice), no como un merge cualquiera.
    assert.equal(r.critica, true);
  } finally {
    gh.restaurar();
  }
});

test('crear por REST un PR de una rama de RQ directo a PROD se niega como gh pr create', async () => {
  const { evaluarBash } = await import('../plugin/scripts/lib/compuerta-bash.mjs');
  const raiz = crearRepoTemporal({ nombre: 'r', archivos: { '.bacg-dev/proyecto.yml': 'id: demo\nnombre: Demo\ncuenta_github: o\nramas_prod: ["main"]\nrepos:\n  - { nombre: r, rol: padre, push_prod: true, rama_dev: dev }\n' } });
  git(raiz, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  const viaGh = evaluarBash({ comando: 'gh pr create --base main --head rq/X', cwd: raiz, ctx: { textosUsuario: [], ramaPorDefecto: () => 'main' } });
  const viaRest = evaluarBash({ comando: 'gh api repos/o/r/pulls -f base=main -f head=rq/X -f title=t', cwd: raiz, ctx: { textosUsuario: [], ramaPorDefecto: () => 'main' } });
  assert.equal(viaRest.decision, viaGh.decision);
  assert.equal(viaRest.decision, 'deny');
});

test('la compuerta reconoce las otras formas de gh api: placeholders, flags pegados, URL absoluta, graphql y rutas que publican', async () => {
  const { operacionesGit } = await import('../plugin/scripts/lib/compuerta-bash.mjs');
  const raiz = crearRepoTemporal({});
  const ops = (c) => operacionesGit(c, raiz).map((o) => [o.op, o.repoGh ?? null, o.base ?? null, Boolean(o.red)]);
  assert.deepEqual(ops('gh api repos/{owner}/{repo}/pulls -f base=main -f head=x'), [['pr-create', null, 'main', false]]);
  assert.deepEqual(ops('gh api repos/o/r/pulls -fbase=main -fhead=x'), [['pr-create', 'o/r', 'main', false]]);
  assert.deepEqual(ops('gh api https://api.github.com/repos/o/r/pulls -f base=dev -f head=x'), [['pr-create', 'o/r', 'dev', false]]);
  assert.deepEqual(ops("gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:\"x\"}) { clientMutationId } }'").map((o) => o[0]), ['merge-pr']);
  assert.deepEqual(ops('gh api repos/o/r/merges -f base=main -f head=dev').map((o) => o[0]), ['merge-pr']);
  assert.deepEqual(ops('gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc').map((o) => o[0]), ['merge-pr']);
  assert.deepEqual(ops('gh api -X GET repos/o/r/pulls'), []);
});
