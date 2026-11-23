// PLG-CANON-CIERRE: al cerrar un RQ que tocó UI, se registra si dejó un lineamiento de UI nuevo para el canon.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado } from '../plugin/scripts/lib/estado.mjs';
import { crearRepoTemporal, sesionDePrueba, fraseDe } from './helpers.mjs';

const SESION = sesionDePrueba();
const ENV = { BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' };

async function correr(cwd, args) {
  let out = '';
  let err = '';
  const frase = fraseDe(args);
  if (frase) SESION.dijo(frase);
  const code = await main(args, {
    cwd,
    home: SESION.home,
    env: { ...process.env, ...SESION.env, ...ENV },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

/** Repo con la configuración en .bacg-dev/ y un RQ abierto; `ui` marca el encuadre con Toca: UI [x]. */
async function rqDe({ ui = true, canon = 'canon-ui.md' } = {}) {
  const yml = `id: demo\nnombre: Demo\n${canon ? `ui:\n  canon: ${canon}\n` : ''}`;
  const archivos = { '.bacg-dev/proyecto.yml': yml };
  if (canon) archivos[`.bacg-dev/${canon}`] = '# Canon\n';
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'spec.md'), `# R-1 · Pantalla\n## Toca: UI [${ui ? 'x' : ' '}] · sensible [ ]\n`);
  return raiz;
}

test('canon: cerrar un RQ que tocó UI frena con la pregunta del canon hasta registrar la respuesta', async () => {
  const raiz = await rqDe();
  const r = await correr(raiz, ['cerrar']);
  assert.equal(r.code, 1);
  assert.match(r.err + r.out, /lineamiento de UI nuevo.*canon \(\.bacg-dev\/canon-ui\.md\)/s);
  assert.match(r.err + r.out, /canon no "<frase del usuario>"/);
  assert.notEqual(cargarEstado(raiz, 'R-1').etapa, 6, 'no cerró');
});

test('canon no "<frase>": registra la respuesta del usuario y cerrar sigue', async () => {
  const raiz = await rqDe();
  const frase = 'No, no hay nada nuevo para el canon';
  let r = await correr(raiz, ['canon', 'no', frase]);
  assert.equal(r.code, 1, 'una frase que el usuario no escribió no vale');
  SESION.dijo(frase);
  r = await correr(raiz, ['canon', 'no', frase]);
  assert.equal(r.code, 0, r.err);
  assert.equal(cargarEstado(raiz, 'R-1').canon.decision, 'no');
  r = await correr(raiz, ['cerrar']);
  assert.equal(r.code, 0, r.err);
});

test('canon documentado: exige que el archivo del canon haya cambiado en el RQ', async () => {
  const raiz = await rqDe();
  let r = await correr(raiz, ['canon', 'documentado']);
  assert.equal(r.code, 1);
  assert.match(r.err, /\.bacg-dev\/canon-ui\.md no cambió en este RQ/);
  fs.appendFileSync(path.join(raiz, '.bacg-dev', 'canon-ui.md'), '- Botones de acción destructiva en rojo.\n');
  git(raiz, 'add', '.bacg-dev/canon-ui.md');
  git(raiz, 'commit', '-q', '-m', 'docs(R-1): canon');
  r = await correr(raiz, ['canon', 'documentado']);
  assert.equal(r.code, 0, r.err);
  assert.equal(cargarEstado(raiz, 'R-1').canon.decision, 'documentado');
  r = await correr(raiz, ['cerrar']);
  assert.equal(r.code, 0, r.err);
});

test('canon: sin ui.canon declarado pregunta igual y sugiere crearlo; documentado no aplica', async () => {
  const raiz = await rqDe({ canon: null });
  let r = await correr(raiz, ['cerrar']);
  assert.equal(r.code, 1);
  assert.match(r.err + r.out, /no declara ui\.canon/);
  r = await correr(raiz, ['canon', 'documentado']);
  assert.equal(r.code, 1);
  assert.match(r.err, /declará ui\.canon/);
});

test('canon: un RQ que no tocó UI cierra sin preguntar', async () => {
  const raiz = await rqDe({ ui: false });
  const r = await correr(raiz, ['cerrar']);
  assert.equal(r.code, 0, r.err);
});
