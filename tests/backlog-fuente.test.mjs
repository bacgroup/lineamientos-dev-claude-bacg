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

test('después de migrar, abrir escribe sólo docs/backlog.md y no toca la central obsoleta', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  assert.equal((await correr(raiz, lin, ['backlog', 'migrar'])).code, 0);
  const central = path.join(lin, 'proyectos', 'pf', 'backlog.md');
  const antes = fs.readFileSync(central, 'utf8');
  const r = await correr(raiz, lin, ['abrir', 'D-3', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Backlog: fila D-3 agregada \(docs\/backlog\.md\)/);
  assert.equal(fs.readFileSync(central, 'utf8'), antes);
  assert.equal(estados(path.join(raiz, 'docs', 'backlog.md'))['D-3'], 'En curso');
});

test('fuente central sin backlog central todavía: abrir lo arma con las filas del repo', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  fs.rmSync(path.join(lin, 'proyectos', 'pf', 'backlog.md'));
  const r = await correr(raiz, lin, ['abrir', 'D-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /diferían/);
  for (const e of [estados(path.join(raiz, 'docs', 'backlog.md')), estados(path.join(lin, 'proyectos', 'pf', 'backlog.md'))]) {
    assert.equal(e.A, 'Hecho 10/11/2026');
    assert.equal(e.C, 'Pendiente');
    assert.equal(e['D-1'], 'En curso');
  }
  assert.match(fs.readFileSync(path.join(raiz, 'docs', 'backlog.md'), 'utf8'), /Texto del equipo/);
});

test('con backlog: repo la previa no avisa divergencia y el backlog remoto sale del repo', async () => {
  const { validacionPrevia, backlogRemoto } = await import('../plugin/scripts/lib/previa.mjs');
  const { lin, raiz } = proyectoCentral('reglas: 43\nbacklog: repo\n');
  const proyecto = { id: 'pf', backlog: 'repo' };
  const t = validacionPrevia({ repo: { raiz, proyectoId: 'pf' }, proyecto, codigo: 'Z-1', env: { ...process.env, BACG_DEV_SIN_GH: '1' }, dirLin: lin }).lineas.join('\n');
  assert.doesNotMatch(t, /difieren/);
  const b = backlogRemoto({ raiz, proyectoId: 'pf', dirLin: lin, proyecto });
  // El repo temporal no tiene origin: el error nombra el repo, no la copia de lineamientos.
  assert.ok(b.error ? /repo|docs\/backlog\.md/.test(b.error) && !/lineamientos/.test(b.error) : /docs\/backlog\.md/.test(b.fuente), JSON.stringify(b));
});

test('fuente central: cerrar pasa la fila a Hecho en las dos copias sin perder las del repo', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  assert.equal((await correr(raiz, lin, ['abrir', 'D-4', '--tipo', 'rq', '--clasificacion', 'bounded'])).code, 0);
  // Mientras tanto alguien agrega E en el repo.
  fs.appendFileSync(path.join(raiz, 'docs', 'backlog.md'), fila('E', 'Pendiente'));
  await correr(raiz, lin, ['etapa', '5']);
  const r = await correr(raiz, lin, ['cerrar']);
  assert.equal(r.code, 0, r.err);
  for (const e of [estados(path.join(raiz, 'docs', 'backlog.md')), estados(path.join(lin, 'proyectos', 'pf', 'backlog.md'))]) {
    assert.match(e['D-4'], /^Hecho/);
    assert.equal(e.A, 'Hecho 10/11/2026');
    assert.equal(e.C, 'Pendiente');
    assert.equal(e.E, 'Pendiente');
  }
});

test('la previa no avisa divergencia si el repo no tiene copia o si las dos copias son iguales', async () => {
  const { validacionPrevia } = await import('../plugin/scripts/lib/previa.mjs');
  const env = { ...process.env, BACG_DEV_SIN_GH: '1' };
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  const previa = () => validacionPrevia({ repo: { raiz, proyectoId: 'pf' }, proyecto: { id: 'pf' }, codigo: 'Z-1', env, dirLin: lin }).lineas.join('\n');
  fs.copyFileSync(path.join(lin, 'proyectos', 'pf', 'backlog.md'), path.join(raiz, 'docs', 'backlog.md'));
  assert.doesNotMatch(previa(), /difieren/);
  fs.rmSync(path.join(raiz, 'docs', 'backlog.md'));
  assert.doesNotMatch(previa(), /difieren/);
});

test('una segunda tabla después del backlog no se toma como filas ni se copia a la otra copia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fus2-'));
  const a = path.join(dir, 'a.md');
  const b = path.join(dir, 'b.md');
  fs.writeFileSync(a, `# Backlog\n\n${ENC}${fila('A', 'Pendiente')}\n## Notas\n\n| Fecha | Nota |\n|---|---|\n| 2026 | algo |\n`);
  fs.writeFileSync(b, `# Backlog\n\n${ENC}${fila('A', 'Pendiente')}`);
  assert.deepEqual(parsearBacklog(fs.readFileSync(a, 'utf8')).map((f) => f['Código']), ['A']);
  const antes = fs.readFileSync(b, 'utf8');
  assert.deepEqual(fusionarEnArchivo(b, parsearBacklog(fs.readFileSync(a, 'utf8'))), { agregadas: [], actualizadas: [] });
  assert.equal(fs.readFileSync(b, 'utf8'), antes);
});

test('migrar a medias (central obsoleta sin backlog: repo) se completa corriéndolo de nuevo', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  const central = path.join(lin, 'proyectos', 'pf', 'backlog.md');
  fs.writeFileSync(central, `> OBSOLETO desde ayer\n\n${fs.readFileSync(central, 'utf8')}`);
  const r = await correr(raiz, lin, ['backlog', 'migrar']);
  assert.match(r.out, /ya está migrado/);
  assert.match(fs.readFileSync(path.join(lin, 'proyectos', 'pf', 'proyecto.yml'), 'utf8'), /^backlog: repo$/m);
});

test('migrar avisa las columnas de la central que el repo no tiene', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  const central = path.join(lin, 'proyectos', 'pf', 'backlog.md');
  fs.writeFileSync(central, '# Backlog\n\n| Código | Tarea | Prioridad | Estado | Impacto | Link | Responsable |\n|---|---|---|---|---|---|---|\n| B | B | Alta | En curso | x | | Ana |\n');
  const r = await correr(raiz, lin, ['backlog', 'migrar']);
  assert.match(r.out, /columnas que docs\/backlog\.md no tiene \(Responsable\)/);
});

test('rango: En revisión o En QA cuentan como en curso', async () => {
  const { rangoEstado } = await import('../plugin/scripts/lib/backlog.mjs');
  assert.equal(rangoEstado('En revisión'), rangoEstado('En curso'));
  assert.equal(rangoEstado('En QA'), rangoEstado('En curso'));
  assert.equal(rangoEstado('Desplegado en DEV'), rangoEstado('En curso'));
});

test('migrar sin docs/backlog.md crea la copia con las columnas de la central', async () => {
  const { lin, raiz } = proyectoCentral('reglas: 43\n');
  fs.rmSync(path.join(raiz, 'docs', 'backlog.md'));
  fs.writeFileSync(path.join(lin, 'proyectos', 'pf', 'backlog.md'), '# Backlog\n\n| Código | Tarea | Prioridad | Estado | Impacto | Link | Responsable |\n|---|---|---|---|---|---|---|\n| B | B | Alta | En curso | x | | Ana |\n');
  const r = await correr(raiz, lin, ['backlog', 'migrar']);
  assert.doesNotMatch(r.out, /Ojo/);
  assert.equal(parsearBacklog(fs.readFileSync(path.join(raiz, 'docs', 'backlog.md'), 'utf8'))[0].Responsable, 'Ana');
});

test('PLG-BKL2: grupos de filas separados por líneas en blanco son un solo backlog (no se duplica la fila)', async () => {
  const { upsertEnArchivo } = await import('../plugin/scripts/lib/backlog.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grupos-'));
  const f = path.join(dir, 'backlog.md');
  const texto = `# Backlog\n\n${ENC}${fila('A', 'Pendiente')}\n${fila('B', 'En curso')}\nNota suelta.\n\n${fila('C', 'Pendiente')}\n## Notas\n\n| Fecha | Nota |\n|---|---|\n| 2026 | algo |\n`;
  fs.writeFileSync(f, texto);
  assert.deepEqual(parsearBacklog(texto).map((x) => x['Código']), ['A', 'B', 'C']);
  assert.equal(upsertEnArchivo(f, 'B', { Estado: 'Hecho 16/11/2026' }), 'actualizada');
  assert.deepEqual(fusionarEnArchivo(f, parsearBacklog(ENC + fila('C', 'Hecho 1/1/2026'))), { agregadas: [], actualizadas: ['C'] });
  const despues = fs.readFileSync(f, 'utf8');
  assert.deepEqual(parsearBacklog(despues).map((x) => [x['Código'], x.Estado]), [['A', 'Pendiente'], ['B', 'Hecho 16/11/2026'], ['C', 'Hecho 1/1/2026']]);
  assert.match(despues, /Nota suelta\.\n\n\| C /);
  assert.match(despues, /\| 2026 \| algo \|\n$/);
});
