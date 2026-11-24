// PLG-CI-MIN: los commits de sólo docs del ciclo no corren el CI y el arranque señala los workflows que corren por docs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../plugin/scripts/rq.mjs';
import { saltarCi, soloDocs, conSkipCi, avisosCi } from '../plugin/scripts/lib/ci.mjs';
import { crearRepoTemporal, sesionDePrueba } from './helpers.mjs';

const SESION = sesionDePrueba();

async function correr(cwd, args) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    home: SESION.home,
    env: { ...process.env, ...SESION.env, BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_GH: '1' },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const asunto = (raiz) => git(raiz, 'log', '-1', '--format=%s');

function repo({ ci = '', archivos = {} } = {}) {
  const yml = `id: demo\nnombre: Demo\ntests:\n  unit: "node -e 0"\n${ci}`;
  return crearRepoTemporal({ proyectoId: 'demo', archivos: { '.bacg-dev/proyecto.yml': yml, ...archivos } });
}
const abrir = (raiz) => correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);

test('ci: saltarCi por defecto y apagado con ci.skip_docs: false', () => {
  assert.equal(saltarCi({}), true);
  assert.equal(saltarCi(null), true);
  assert.equal(saltarCi({ ci: { skip_docs: false } }), false);
});

test('ci: soloDocs distingue docs de tests y código', () => {
  assert.equal(soloDocs(['docs/rq/R-1/estado.yml', 'README.md', 'docs/backlog.md']), true);
  assert.equal(soloDocs(['docs/a.md', 'src/a.test.ts']), false);
  assert.equal(soloDocs(['docs/a.md', 'src/a.ts']), false);
  assert.equal(soloDocs(['.bacg-dev/proyecto.yml']), false, 'la config del proyecto la lee el CI');
  assert.equal(soloDocs([]), false);
});

test('ci: conSkipCi agrega la marca a la primera línea una sola vez', () => {
  assert.equal(conSkipCi('docs(R-1): cierre'), 'docs(R-1): cierre [skip ci]');
  assert.equal(conSkipCi('docs(R-1): cierre [skip ci]'), 'docs(R-1): cierre [skip ci]');
  assert.equal(conSkipCi('docs: algo\n\ncuerpo'), 'docs: algo [skip ci]\n\ncuerpo');
});

test('cerrar: el commit de cierre lleva [skip ci]; con ci.skip_docs: false, no', async () => {
  let raiz = repo();
  await abrir(raiz);
  let r = await correr(raiz, ['cerrar', '--resumen', 'Listo.']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(asunto(raiz), 'docs(R-1): cierre [skip ci]');
  raiz = repo({ ci: 'ci:\n  skip_docs: false\n' });
  await abrir(raiz);
  r = await correr(raiz, ['cerrar', '--resumen', 'Listo.']);
  assert.equal(asunto(raiz), 'docs(R-1): cierre');
});

test('commit de la CLI: sólo docs lleva [skip ci]; con tests, no', async () => {
  const raiz = repo();
  await abrir(raiz);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'nota.md'), 'x');
  let r = await correr(raiz, ['commit', 'docs: nota', 'docs/rq/R-1/nota.md']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(asunto(raiz), /\[skip ci\]$/);
  fs.mkdirSync(path.join(raiz, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'tests', 'a.test.mjs'), 'x');
  r = await correr(raiz, ['commit', 'test: a', 'tests/a.test.mjs']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.doesNotMatch(asunto(raiz), /skip ci/);
});

const WF = (on) => `name: CI\non:\n${on}\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`;

test('avisosCi: un workflow on: push sin filtro de docs se avisa; con paths-ignore de docs, no', () => {
  let raiz = repo({ archivos: { '.github/workflows/ci.yml': WF('  push:\n    branches: [main]') } });
  assert.match(avisosCi(raiz).join('\n'), /cada commit de docs del ciclo corre el workflow CI \(\.github\/workflows\/ci\.yml\)/);
  raiz = repo({ archivos: { '.github/workflows/ci.yml': WF("  push:\n    paths-ignore: ['docs/**', '**/*.md']") } });
  assert.deepEqual(avisosCi(raiz), []);
  raiz = repo({ archivos: { '.github/workflows/ci.yml': WF("  push:\n    paths: ['**', '!docs/**', '!**/*.md']") } });
  assert.deepEqual(avisosCi(raiz), []);
});

test('avisosCi: excluir .bacg-dev/ y tests que leen docs excluidos se avisan', () => {
  const raiz = repo({
    archivos: {
      '.github/workflows/ci.yml': WF("  push:\n    paths-ignore: ['docs/**', '.bacg-dev/**']"),
      'src/seg.test.ts': "import fs from 'node:fs';\nconst sql = fs.readFileSync('docs/rq/BUG-1/migracion.sql', 'utf8');\n",
    },
  });
  const a = avisosCi(raiz).join('\n');
  assert.match(a, /deja afuera \.bacg-dev\//);
  assert.match(a, /src\/seg\.test\.ts lee docs\//);
});

test('avisosCi: sin .github/workflows no dice nada; un workflow sólo manual tampoco', () => {
  assert.deepEqual(avisosCi(repo()), []);
  assert.deepEqual(avisosCi(repo({ archivos: { '.github/workflows/m.yml': WF('  workflow_dispatch: {}') } })), []);
});
