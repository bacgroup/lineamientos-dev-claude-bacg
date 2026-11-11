// PLG-DFF (pedido 6 de dev-fullflow): en un Acotado, la frase con que el usuario confirma la clasificación aprueba también el
// diseño si spec.md ya trae `## Diseño` y `## Tareas`, y la ejecución va en línea por defecto (como en Exploración).
// El OK de PROD sigue siendo una aprobación propia. Arquitectónico no cambia.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado, guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { crearRepoTemporal, sesionDePrueba, fraseDe } from './helpers.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_LIN = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-fixture-'));
fs.cpSync(path.join(AQUI, 'fixtures', 'lineamientos'), DIR_LIN, { recursive: true });
const SESION = sesionDePrueba();

async function correr(cwd, args) {
  let out = '';
  let err = '';
  const frase = fraseDe(args);
  if (frase) SESION.dijo(frase);
  const code = await main(args, {
    cwd,
    home: SESION.home,
    env: { ...process.env, ...SESION.env, BACG_LINEAMIENTOS_DIR: DIR_LIN, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1' },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const spec = (raiz, codigo, texto) => {
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', codigo), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), texto);
};
const CON_DISENO = '# R-1\n\n## Diseño\nun cambio chico\n\n## Tareas\n- [ ] una\n';
const aprobadas = (raiz, codigo) => (cargarEstado(raiz, codigo).aprobaciones ?? []).map((a) => [a.etapa, a.frase]);

test('Acotado: confirmar la clasificación con diseño y tareas escritos aprueba también el diseño', async () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  spec(raiz, 'R-1', CON_DISENO);
  const r = await correr(raiz, ['clasificacion', 'confirmar', 'OK acotado y diseño']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /diseño/i);
  assert.deepEqual(aprobadas(raiz, 'R-1'), [[1, 'OK acotado y diseño']]);
});

test('Acotado: sin ## Diseño o sin ## Tareas en spec.md, confirmar la clasificación no aprueba el diseño', async () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  spec(raiz, 'R-1', '# R-1\n\n## Tareas\n- [ ] una\n');
  assert.equal((await correr(raiz, ['clasificacion', 'confirmar', 'sí, acotado'])).code, 0);
  assert.deepEqual(aprobadas(raiz, 'R-1'), []);
});

test('Arquitectónico: confirmar la clasificación nunca aprueba el diseño', async () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'A-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  spec(raiz, 'A-1', CON_DISENO);
  assert.equal((await correr(raiz, ['clasificacion', 'confirmar', 'arquitectónico confirmado'])).code, 0);
  assert.deepEqual(aprobadas(raiz, 'A-1'), []);
});

test('Acotado: el primer commit de código no pide la elección de ejecución (va en línea)', async () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'src/a.ts': 'x' } });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  spec(raiz, 'R-1', CON_DISENO);
  const e = cargarEstado(raiz, 'R-1');
  e.skills = [{ skill: 'superpowers:brainstorming', etapa: 1 }];
  guardarEstado(raiz, e);
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'y');
  execFileSync('git', ['add', 'src/a.ts'], { cwd: raiz });
  const r = await correr(raiz, ['registrar-tests']);
  assert.doesNotMatch(r.err, /cómo ejecutar el plan/);
  assert.equal(r.code, 0, r.err);
});

test('Arquitectónico: el primer commit de código sigue pidiendo la elección de ejecución', async () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'src/a.ts': 'x' } });
  await correr(raiz, ['abrir', 'A-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  spec(raiz, 'A-1', CON_DISENO);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'A-1', 'plan.md'), '# plan\n');
  const e = cargarEstado(raiz, 'A-1');
  e.skills = [{ skill: 'superpowers:brainstorming', etapa: 1 }, { skill: 'superpowers:writing-plans', etapa: 1 }];
  guardarEstado(raiz, e);
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'y');
  execFileSync('git', ['add', 'src/a.ts'], { cwd: raiz });
  const r = await correr(raiz, ['registrar-tests']);
  assert.equal(r.code, 1);
  assert.match(r.err, /cómo ejecutar el plan/);
});
