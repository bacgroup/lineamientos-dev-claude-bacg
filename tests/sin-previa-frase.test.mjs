// PLG-CLOUD (hallazgo 15): saltear la validación previa o el alta es una decisión del usuario. `abrir --sin-previa` y
// `--sin-alta` exigen `--frase "<frase>"` verificada contra lo que escribió el usuario, y la compuerta de Bash niega
// fijar BACG_DEV_SIN_PREVIA / SIN_ALTA / SIN_GH en un comando que corre rq.mjs (sería el mismo salto sin frase).
import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../plugin/scripts/rq.mjs';
import { evaluarBash } from '../plugin/scripts/lib/compuerta-bash.mjs';
import { crearRepoTemporal, sesionDePrueba, lineamientos44 } from './helpers.mjs';

const DIR_LIN = lineamientos44();

async function correr(raiz, sesion, args, extra = {}) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd: raiz, home: sesion.home,
    env: { ...process.env, ...sesion.env, BACG_LINEAMIENTOS_DIR: DIR_LIN, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_PREVIA: '', BACG_DEV_SIN_ALTA: '1', ...extra },
    stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

test('abrir --sin-previa sin frase, o con una que el usuario no dijo, no abre', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const sin = await correr(raiz, s, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--sin-previa']);
  assert.notEqual(sin.code, 0);
  assert.match(sin.err, /--sin-previa.*--frase/);
  const inventada = await correr(raiz, s, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--sin-previa', '--frase', 'salteá la previa']);
  assert.notEqual(inventada.code, 0);
  s.dijo('Abrilo sin la validación previa');
  const ok = await correr(raiz, s, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--sin-previa', '--frase', 'Abrilo sin la validación previa']);
  assert.equal(ok.code, 0, ok.err);
  assert.doesNotMatch(ok.out, /Validación previa/);
});

test('abrir --sin-alta también pide la frase del usuario', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const r = await correr(raiz, s, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--sin-alta'], { BACG_DEV_SIN_ALTA: '', BACG_DEV_SIN_PREVIA: '1' });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /--sin-alta.*--frase/);
});

test('la compuerta de Bash niega fijar BACG_DEV_SIN_* al correr rq.mjs', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  for (const c of ['BACG_DEV_SIN_PREVIA=1 node "/x/rq.mjs" abrir R-1 --tipo rq --clasificacion acotado', 'export BACG_DEV_SIN_ALTA=1; node /x/rq.mjs abrir R-1 --tipo rq --clasificacion acotado', 'env BACG_DEV_SIN_GH=1 node /x/rq.mjs entregar']) {
    const r = evaluarBash({ comando: c, cwd: raiz, ctx: { textosUsuario: [] }, dirLin: DIR_LIN });
    assert.equal(r.decision, 'deny', c);
    assert.match(r.motivo, /BACG_DEV_SIN_/);
  }
  assert.equal(evaluarBash({ comando: 'BACG_DEV_SIN_GH=1 npm test', cwd: raiz, ctx: { textosUsuario: [] }, dirLin: DIR_LIN }).decision, 'allow');
});
