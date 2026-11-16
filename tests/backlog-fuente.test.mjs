// PLG-BACKLOG: fuente única del backlog. Con `backlog: repo` (o la configuración en el repo) la fuente es docs/backlog.md
// del repo. Con la fuente central, abrir y cerrar fusionan las dos copias en lugar de pisar la del repo, la previa avisa
// si difieren y `backlog migrar` deja el repo como fuente.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../plugin/scripts/rq.mjs';
import { fusionarFilas, diferencias, parsearBacklog, fuenteBacklog } from '../plugin/scripts/lib/backlog.mjs';
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

test('fusionarFilas: por código gana el estado más avanzado y se conservan las filas de las dos copias', () => {
  const a = parsearBacklog(ENC + fila('A', 'Pendiente') + fila('B', 'En curso'));
  const b = parsearBacklog(ENC + fila('A', 'Hecho 10/11/2026') + fila('C', 'Pendiente'));
  const f = Object.fromEntries(fusionarFilas(a, b).map((x) => [x['Código'], x.Estado]));
  assert.deepEqual(f, { A: 'Hecho 10/11/2026', B: 'En curso', C: 'Pendiente' });
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
