// PLG-DFF2 (P-11, P-14, P-16, P-17): devoluciones como lista cerrada con corte por vueltas, trazabilidad del spec al
// código y a los tests, y criterios centrales en el diseño de un Arquitectónico. Todo con reglas 4.4.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado, guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { faltaParaEtapa, PASADAS_REVISION } from '../plugin/scripts/lib/requisitos.mjs';
import { itemsDelSpec } from '../plugin/scripts/lib/traza.mjs';
import yaml from '../plugin/scripts/vendor/js-yaml.mjs';
import { crearRepoTemporal, sesionDePrueba, lineamientos44 } from './helpers.mjs';

const DIR_LIN = lineamientos44();
const SESION = sesionDePrueba();

async function correr(cwd, args) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    home: SESION.home,
    env: { ...process.env, ...SESION.env, BACG_LINEAMIENTOS_DIR: DIR_LIN, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_PREVIA: '1' },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const SPEC = `# R-1

## Criterio de aceptación → flujo E2E que lo prueba
- S-1: el staff cambia la vigencia → e2e/vigencia.spec.ts
- S-2: la ausencia vive dentro de la vigencia resultante

## Diseño
x

## Tareas
- una
`;

const TODAS = ['superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:test-driven-development', 'superpowers:executing-plans', 'superpowers:requesting-code-review', 'superpowers:verification-before-completion', ...PASADAS_REVISION];

async function rq() {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'docs/rq/R-1/spec.md': SPEC, 'e2e/vigencia.spec.ts': '// e2e\n' } });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  const e = cargarEstado(raiz, 'R-1');
  e.skills = TODAS.map((skill) => ({ skill, etapa: 2 }));
  e.tests = { ok: true };
  guardarEstado(raiz, e);
  return raiz;
}

test('devolucion: puntos numerados; el segundo sobre el mismo elemento corta la iteración', async () => {
  const raiz = await rq();
  const a = await correr(raiz, ['devolucion', 'agregar', 'la tarjeta no queda fija al desplazar', '--elemento', 'grilla']);
  assert.equal(a.code, 0, a.err);
  assert.doesNotMatch(a.out, /Corte por vueltas/);
  const b = await correr(raiz, ['devolucion', 'agregar', 'ninguno representa lo que pedí', '--elemento', 'grilla']);
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /Corte por vueltas/);
  assert.match(b.out, /literal/);
  const d = cargarEstado(raiz, 'R-1').devoluciones;
  assert.deepEqual(d.map((x) => [x.n, x.elemento, x.estado]), [[1, 'grilla', 'pendiente'], [2, 'grilla', 'pendiente']]);
  const lista = await correr(raiz, ['devolucion']);
  assert.match(lista.out, /2 pendiente/);
});

test('devolucion: marcar exige evidencia; con pendientes, la revisión no se da por ok', async () => {
  const raiz = await rq();
  await correr(raiz, ['devolucion', 'agregar', 'el color de reservada', '--elemento', 'grilla']);
  assert.notEqual((await correr(raiz, ['devolucion', '1', 'hecho'])).code, 0);
  assert.ok(faltaParaEtapa(cargarEstado(raiz, 'R-1'), 3, raiz).some((x) => /devoluci/.test(x)));
  assert.equal((await correr(raiz, ['devolucion', '1', 'hecho', 'qa/grilla-1280.png'])).code, 0);
  assert.equal(cargarEstado(raiz, 'R-1').devoluciones[0].evidencia, 'qa/grilla-1280.png');
  assert.ok(!faltaParaEtapa(cargarEstado(raiz, 'R-1'), 3, raiz).some((x) => /devoluci/.test(x)));
});

test('devolucion: rechazar o consultar un punto pide la frase del usuario; el corte no distingue mayúsculas ni espacios', async () => {
  const raiz = await rq();
  await correr(raiz, ['devolucion', 'agregar', 'otro color', '--elemento', 'Grilla']);
  const b = await correr(raiz, ['devolucion', 'agregar', 'más chico', '--elemento', 'grilla ']);
  assert.match(b.out, /Corte por vueltas/);
  const sinFrase = await correr(raiz, ['devolucion', '1', 'rechazado', 'no aplica, lo decidí yo']);
  assert.notEqual(sinFrase.code, 0);
  assert.match(sinFrase.err, /usuario/);
  SESION.dijo('Dejá el color como está');
  assert.equal((await correr(raiz, ['devolucion', '1', 'rechazado', 'Dejá el color como está'])).code, 0);
  assert.notEqual((await correr(raiz, ['devolucion', '9', 'hecho', 'qa/x.png'])).code, 0);
  assert.notEqual((await correr(raiz, ['devolucion', '2', 'listo', 'qa/x.png'])).code, 0);
});

test('4.4 Acotado sin ítems en el criterio de aceptación: la revisión pide escribirlos (no se saltea la traza)', async () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'docs/rq/R-2/spec.md': '# R-2\n\n## Diseño\nx\n\n## Tareas\n- una\n' } });
  await correr(raiz, ['abrir', 'R-2', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.ok(faltaParaEtapa(cargarEstado(raiz, 'R-2'), 3, raiz).some((x) => /Criterio de aceptación/.test(x)));
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-2', 'traza.yml'), 'items: [roto');
  assert.ok(faltaParaEtapa(cargarEstado(raiz, 'R-2'), 3, raiz).some((x) => /Criterio de aceptación/.test(x)));
});

test('traza: un "hecho" cuyo test es una ruta que no existe no alcanza', async () => {
  const raiz = await rq();
  await correr(raiz, ['trazar']);
  const archivo = path.join(raiz, 'docs', 'rq', 'R-1', 'traza.yml');
  const t = yaml.load(fs.readFileSync(archivo, 'utf8'));
  t.items = t.items.map((i) => ({ ...i, estado: 'hecho', test: 'tests/no-existe.test.mjs > algo' }));
  fs.writeFileSync(archivo, yaml.dump(t));
  assert.ok(faltaParaEtapa(cargarEstado(raiz, 'R-1'), 3, raiz).some((x) => /no existe/.test(x)));
});

test('itemsDelSpec: respeta S-n y numera los que no lo traen', () => {
  assert.deepEqual(itemsDelSpec(SPEC).map((i) => i.id), ['S-1', 'S-2']);
  assert.deepEqual(itemsDelSpec('## Criterio de aceptación\n- uno\n- dos\n## Otra\n- no\n').map((i) => [i.id, i.texto]), [['S-1', 'uno'], ['S-2', 'dos']]);
});

test('trazar arma traza.yml y conserva lo completado; la revisión exige estado y test en los hechos', async () => {
  const raiz = await rq();
  assert.ok(faltaParaEtapa(cargarEstado(raiz, 'R-1'), 3, raiz).some((x) => /traza/.test(x)));
  assert.equal((await correr(raiz, ['trazar'])).code, 0);
  const archivo = path.join(raiz, 'docs', 'rq', 'R-1', 'traza.yml');
  const t = yaml.load(fs.readFileSync(archivo, 'utf8'));
  assert.deepEqual(t.items.map((i) => i.id), ['S-1', 'S-2']);
  assert.ok(faltaParaEtapa(cargarEstado(raiz, 'R-1'), 3, raiz).some((x) => /S-1/.test(x)));
  t.items[0] = { ...t.items[0], archivos: ['src/a.ts'], test: 'e2e/vigencia.spec.ts', estado: 'hecho' };
  t.items[1] = { ...t.items[1], estado: 'hecho' };
  fs.writeFileSync(archivo, yaml.dump(t));
  const faltas = faltaParaEtapa(cargarEstado(raiz, 'R-1'), 3, raiz).join(' ');
  assert.match(faltas, /S-2/);
  assert.doesNotMatch(faltas, /S-1/);
  // trazar de nuevo no pisa lo completado.
  await correr(raiz, ['trazar']);
  assert.equal(yaml.load(fs.readFileSync(archivo, 'utf8')).items[0].test, 'e2e/vigencia.spec.ts');
  t.items[1] = { ...t.items[1], estado: 'fuera', motivo: 'lo saca el usuario' };
  fs.writeFileSync(archivo, yaml.dump(t));
  assert.ok(!faltaParaEtapa(cargarEstado(raiz, 'R-1'), 3, raiz).some((x) => /traza|S-\d/.test(x)));
});

test('4.4 Arquitectónico: aprobar 1 sin ### Criterios centrales se niega', async () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'docs/rq/A-1/spec.md': '# A-1\n\n## Diseño\nx\n', 'docs/rq/A-1/plan.md': '# plan\n' } });
  await correr(raiz, ['abrir', 'A-1', '--tipo', 'rq', '--clasificacion', 'arquitectonico']);
  SESION.dijo('Apruebo el diseño de A-1');
  const r = await correr(raiz, ['aprobar', '1', 'Apruebo el diseño de A-1']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /Criterios centrales/);
  fs.appendFileSync(path.join(raiz, 'docs', 'rq', 'A-1', 'spec.md'), '\n### Criterios centrales\n- C-1: una pantalla\n');
  assert.equal((await correr(raiz, ['aprobar', '1', 'Apruebo el diseño de A-1'])).code, 0);
});

test('traza: "fuera" sin motivo falta; un test que no es una ruta no se marca como inexistente', async () => {
  const raiz = await rq();
  await correr(raiz, ['trazar']);
  const archivo = path.join(raiz, 'docs', 'rq', 'R-1', 'traza.yml');
  const t = yaml.load(fs.readFileSync(archivo, 'utf8'));
  t.items[0] = { ...t.items[0], estado: 'fuera' };
  t.items[1] = { ...t.items[1], estado: 'hecho', test: 'manual: flujo de vigencia recorrido con el rol staff' };
  fs.writeFileSync(archivo, yaml.dump(t));
  const faltas = faltaParaEtapa(cargarEstado(raiz, 'R-1'), 3, raiz).join(' ');
  assert.match(faltas, /S-1 "fuera" sin motivo/);
  assert.doesNotMatch(faltas, /no existe/);
});

test('devolucion: consultar también pide la frase del usuario', async () => {
  const raiz = await rq();
  await correr(raiz, ['devolucion', 'agregar', '¿estilo de toast?', '--elemento', 'agrupador']);
  assert.notEqual((await correr(raiz, ['devolucion', '1', 'consultado', 'lo consulté'])).code, 0);
  SESION.dijo('Usá el toast del canon');
  assert.equal((await correr(raiz, ['devolucion', '1', 'consultado', 'Usá el toast del canon'])).code, 0);
});

test('devolucion: una misma frase del usuario no cierra varios puntos ni sirve la de la autonomía', async () => {
  const raiz = await rq();
  await correr(raiz, ['devolucion', 'agregar', 'uno', '--elemento', 'a']);
  await correr(raiz, ['devolucion', 'agregar', 'dos', '--elemento', 'b']);
  SESION.dijo('Eso no va');
  assert.equal((await correr(raiz, ['devolucion', '1', 'rechazado', 'Eso no va'])).code, 0);
  const segunda = await correr(raiz, ['devolucion', '2', 'rechazado', 'Eso no va']);
  assert.notEqual(segunda.code, 0);
  assert.match(segunda.err, /ya está registrada/);
});

test('itemsDelSpec: las sub-viñetas indentadas de un criterio no son ítems nuevos', () => {
  const t = '## Criterio de aceptación\n- S-1: uno\n- S-2: dos, con detalle:\n  - primero\n  - segundo\n\n  → tests/x.test.mjs\n- S-3: tres\n';
  assert.deepEqual(itemsDelSpec(t).map((i) => i.id), ['S-1', 'S-2', 'S-3']);
});
