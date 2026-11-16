// PLG-BACKLOG: fuente única del backlog. Con `backlog: repo` (o la configuración en el repo) la fuente es docs/backlog.md
// del repo. Con la fuente central, abrir y cerrar fusionan las dos copias en lugar de pisar la del repo, la previa avisa
// si difieren y `backlog migrar` deja el repo como fuente.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../plugin/scripts/rq.mjs';
import { fusionarEnArchivo, diferencias, parsearBacklog, fuenteBacklog } from '../plugin/scripts/lib/backlog.mjs';
import { crearRepoTemporal, sesionDePrueba } from './helpers.mjs';

const ENC = '| Código | Tarea | Prioridad | Estado | Impacto | Link |\n|---|---|---|---|---|---|\n';
const fila = (c, estado, tarea = c) => `| ${c} | ${tarea} | Alta | ${estado} | x | |\n`;

function proyectoCentral(extra = '') {
  const lin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-backlog-'));
  fs.mkdirSync(path.join(lin, 'proyectos', 'pf'), { recursive: true });
  fs.writeFileSync(path.join(lin, 'proyectos', 'pf', 'proyecto.yml'), `id: pf\nnombre: PF\n${extra}repos:\n  - { nombre: pf-app, rol: padre, push_prod: true }\n`);
  // La copia central está atrasada: A sigue Pendiente y no tiene C.
  fs.writeFileSync(path.join(lin, 'proyectos', 'pf', 'backlog.md'), `# Backlog\n\n${ENC}${fila('A', 'Pendiente')}${fila('B', 'En curso')}`);
  const raiz = crearRepoTemporal({ proyectoId: 'pf' });
  // El repo tiene A hecho y C agregada por otro.
  fs.mkdirSync(path.join(raiz, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'backlog.md'), `# Backlog\n\nTexto del equipo.\n\n${ENC}${fila('A', 'Hecho 10/11/2026')}${fila('C', 'Pendiente', 'Agregada en el repo')}`);
  return { lin, raiz };
}

async function correr(raiz, lin, args) {
  const s = sesionDePrueba();
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd: raiz, home: s.home,
    env: { ...process.env, ...s.env, BACG_LINEAMIENTOS_DIR: lin, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_PREVIA: '1' },
    stdout: { write: (x) => { out += x; } }, stderr: { write: (x) => { err += x; } },
  });
  return { code, out, err };
}
const estados = (archivo) => Object.fromEntries(parsearBacklog(fs.readFileSync(archivo, 'utf8')).map((f) => [f['Código'], f.Estado]));

test('diferencias: códigos en una sola copia o con distinto estado; ignora filas sin código', () => {
  const a = parsearBacklog(ENC + fila('A', 'Pendiente') + fila('B', 'En curso') + '|  | sin código | | Pendiente | | |\n');
  const b = parsearBacklog(ENC + fila('A', 'Hecho 10/11/2026') + fila('C', 'Pendiente'));
  assert.deepEqual(diferencias(a, b).sort(), ['A', 'B', 'C']);
  assert.deepEqual(diferencias(a, a), []);
});

test('fuente central: abrir fusiona en lugar de pisar el backlog del repo', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  const r = await correr(raiz, lin, ['abrir', 'D-1', '--tipo', 'rq', '--clasificacion', 'bounded', '--tarea', 'nueva']);
  assert.equal(r.code, 0, r.err);
  const enRepo = estados(path.join(raiz, 'docs', 'backlog.md'));
  const central = estados(path.join(lin, 'proyectos', 'pf', 'backlog.md'));
  for (const e of [enRepo, central]) {
    assert.equal(e.A, 'Hecho 10/11/2026');
    assert.equal(e.C, 'Pendiente');
    assert.equal(e['D-1'], 'En curso');
  }
  assert.match(fs.readFileSync(path.join(raiz, 'docs', 'backlog.md'), 'utf8'), /Texto del equipo/);
});

test('backlog: repo deja como fuente sólo docs/backlog.md del repo', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\nbacklog: repo\n');
  const antes = fs.readFileSync(path.join(lin, 'proyectos', 'pf', 'backlog.md'), 'utf8');
  assert.equal(fuenteBacklog(raiz, { backlog: 'repo' }), 'repo');
  assert.equal((await correr(raiz, lin, ['abrir', 'D-2', '--tipo', 'rq', '--clasificacion', 'bounded'])).code, 0);
  assert.equal(fs.readFileSync(path.join(lin, 'proyectos', 'pf', 'backlog.md'), 'utf8'), antes);
  assert.equal(estados(path.join(raiz, 'docs', 'backlog.md'))['D-2'], 'En curso');
});

test('backlog migrar: fusiona al repo, marca la central como obsoleta y dice qué declarar', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  const r = await correr(raiz, lin, ['backlog', 'migrar']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /backlog: repo/);
  const e = estados(path.join(raiz, 'docs', 'backlog.md'));
  assert.equal(e.A, 'Hecho 10/11/2026');
  assert.equal(e.B, 'En curso');
  assert.match(fs.readFileSync(path.join(lin, 'proyectos', 'pf', 'backlog.md'), 'utf8'), /OBSOLETO/);
});

test('la previa avisa si el backlog central y el del repo difieren, con los códigos', async () => {
  const { validacionPrevia } = await import('../plugin/scripts/lib/previa.mjs');
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  const t = validacionPrevia({ repo: { raiz, proyectoId: 'pf' }, proyecto: { id: 'pf' }, codigo: 'Z-1', env: { ...process.env, BACG_DEV_SIN_GH: '1' }, dirLin: lin }).lineas.join('\n');
  assert.match(t, /dos copias del backlog difieren: A, B, C/);
  assert.match(t, /backlog migrar/);
});

test('fusionar en un archivo es quirúrgico: conserva columnas extra, texto después de la tabla, filas sin código y pipes escapados', async () => {
  const { fusionarEnArchivo } = await import('../plugin/scripts/lib/backlog.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const f = path.join(dir, 'backlog.md');
  const original = '# B\n\n| Código | Tarea | Prioridad | Estado | Impacto | Link | Owner |\n|---|---|---|---|---|---|---|\n| A | usa x \\| y | Alta | Pendiente | i | l | ana |\n|  | nota sin código | | | | | |\n| B | b | Media | En curso | i | l | juan |\n\n## Notas\nTexto al final.\n';
  fs.writeFileSync(f, original);
  const r = fusionarEnArchivo(f, [{ 'Código': 'A', Estado: 'Hecho 16/11/2026' }, { 'Código': 'B', Estado: 'Pendiente' }, { 'Código': 'C', Tarea: 'nueva', Estado: 'Pendiente' }]);
  const t = fs.readFileSync(f, 'utf8');
  assert.match(t, /\| A \| usa x \\\| y \| Alta \| Hecho 16\/11\/2026 \| i \| l \| ana \|/);
  assert.match(t, /nota sin código/);
  assert.match(t, /\| B \| b \| Media \| En curso \| i \| l \| juan \|/, 'no baja de En curso a Pendiente');
  assert.match(t, /\| C \| nueva \|/);
  assert.match(t, /## Notas\nTexto al final\./);
  assert.deepEqual(r, { agregadas: ['C'], actualizadas: ['A'] });
  // Sin nada que cambiar, el archivo queda byte a byte igual.
  const antes = fs.readFileSync(f, 'utf8');
  fusionarEnArchivo(f, [{ 'Código': 'A', Estado: 'Hecho 16/11/2026' }]);
  assert.equal(fs.readFileSync(f, 'utf8'), antes);
});

test('rango: un "Hecho … Falta" parcial no le gana a En curso; Cerrado cuenta como cerrado', async () => {
  const { rangoEstado } = await import('../plugin/scripts/lib/backlog.mjs');
  assert.ok(rangoEstado('Hecho en el plugin 04/11/2026. Falta: declarar') <= rangoEstado('En curso'));
  assert.ok(rangoEstado('Cerrado') > rangoEstado('En curso'));
  assert.ok(rangoEstado('Descartado 16/11/2026') > rangoEstado('Pendiente'));
});

test('backlog migrar declara backlog: repo en el proyecto.yml central y no vuelve a fusionar una central obsoleta', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  assert.equal((await correr(raiz, lin, ['backlog', 'migrar'])).code, 0);
  assert.match(fs.readFileSync(path.join(lin, 'proyectos', 'pf', 'proyecto.yml'), 'utf8'), /^backlog: repo$/m);
  const otra = await correr(raiz, lin, ['backlog', 'migrar']);
  assert.match(otra.out, /ya está migrado/);
});

test('fuente central: reabrir un código que una copia tenía Hecho lo deja En curso en las dos', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  const r = await correr(raiz, lin, ['abrir', 'A', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.equal(estados(path.join(raiz, 'docs', 'backlog.md')).A, 'En curso');
  assert.equal(estados(path.join(lin, 'proyectos', 'pf', 'backlog.md')).A, 'En curso');
});

test('fusionarEnArchivo crea el archivo con encabezado si no existe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fus-'));
  const f = path.join(dir, 'docs', 'backlog.md');
  assert.deepEqual(fusionarEnArchivo(f, parsearBacklog(ENC + fila('A', 'Pendiente'))), { agregadas: ['A'], actualizadas: [] });
  assert.equal(estados(f).A, 'Pendiente');
});
