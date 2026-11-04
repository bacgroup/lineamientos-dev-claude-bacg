import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dependencias, faltaAntes, pendientes, corresponde, esManual } from '../plugin/scripts/lib/circuito.mjs';
import { leerBacklog, upsertFila } from '../plugin/scripts/lib/backlog.mjs';
import { fallosDe, soloRojosConocidos, conArchivos } from '../plugin/scripts/lib/cli.mjs';
import { nombreRepo } from '../plugin/scripts/lib/config.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const PROY = {
  circuito_prod: [
    { paso: 'push:hq', despues_de: [] },
    { paso: 'sql:refa', despues_de: [] },
    { paso: 'merge-prs-sync:sede-a', despues_de: ['push:hq', 'sql:refa'] },
    { paso: 'sync-lineamientos' },
    { paso: 'manual:publish' },
  ],
};
const nada = () => false;

test('dependencias: despues_de manda; sin despues_de, todos los anteriores; los manuales nunca', () => {
  assert.deepEqual(dependencias(PROY, 'merge-prs-sync:sede-a'), ['push:hq', 'sql:refa']);
  assert.deepEqual(dependencias(PROY, 'sql:refa'), []);
  assert.deepEqual(dependencias(PROY, 'manual:publish'), ['push:hq', 'sql:refa', 'merge-prs-sync:sede-a']);
  assert.deepEqual(dependencias(PROY, 'otro'), []);
});

test('corresponde: sql sólo con migraciones, sync-lineamientos sólo con estándares; sin diff, todo', () => {
  assert.equal(corresponde('sql:refa', ['src/a.ts']), false);
  assert.equal(corresponde('sql:refa', ['supabase/migrations/1.sql']), true);
  assert.equal(corresponde('sync-lineamientos', ['AGENTS.md']), true);
  assert.equal(corresponde('sync-lineamientos', ['src/a.ts']), false);
  assert.equal(corresponde('push:hq', []), true);
  assert.equal(corresponde('sql:refa', null), true);
  // El PR de sync de la sede manda para su SQL: una migración anterior al RQ también cuenta.
  assert.equal(corresponde('sql:refa', ['src/a.ts'], { refa: true }), true);
  assert.equal(corresponde('sql:refa', ['src/a.ts'], { refa: null }), true, 'PR ilegible: falla cerrada');
  assert.equal(corresponde('sql:refa', ['src/a.ts'], { refa: false }), false);
  assert.equal(esManual('manual:x'), true);
  assert.equal(esManual('manual:'), false);
  assert.equal(esManual('Sync-Lineamientos'), true);
});

test('faltaAntes y pendientes: registrado, no aplica o estado real cuentan como hecho', () => {
  const estado = { circuito: [{ paso: 'push:hq' }] };
  assert.equal(faltaAntes({ proyecto: PROY, estado, paso: 'merge-prs-sync:sede-a', rutas: ['supabase/migrations/1.sql'], real: nada }), 'sql:refa');
  assert.equal(faltaAntes({ proyecto: PROY, estado, paso: 'merge-prs-sync:sede-a', rutas: ['src/a.ts'], real: nada }), undefined);
  assert.equal(faltaAntes({ proyecto: PROY, estado: {}, paso: 'merge-prs-sync:sede-a', rutas: ['src/a.ts'], real: (p) => p === 'push:hq' }), undefined);
  assert.deepEqual(
    pendientes({ proyecto: PROY, estado, rutas: ['src/a.ts'], real: nada }),
    ['merge-prs-sync:sede-a', 'manual:publish'],
  );
});

test('backlog: agrega con encabezado, actualiza sin borrar lo que no viene, escapa los |', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  assert.equal(upsertFila(dir, 'p', 'R-1', { Tarea: 'Uno | dos', Estado: 'En curso' }), 'agregada');
  assert.equal(upsertFila(dir, 'p', 'R-2', { Tarea: 'Otro' }), 'agregada');
  assert.equal(upsertFila(dir, 'p', 'R-1', { Estado: 'Hecho 26/10/2026', Tarea: '' }), 'actualizada');
  const filas = leerBacklog(dir, 'p');
  assert.deepEqual(filas.map((f) => [f['Código'], f.Tarea, f.Estado]), [
    ['R-1', 'Uno / dos', 'Hecho 26/10/2026'],
    ['R-2', 'Otro', ''],
  ]);
  const texto = fs.readFileSync(path.join(dir, 'proyectos', 'p', 'backlog.md'), 'utf8');
  assert.match(texto, /^# Backlog\n\n\| Código \| Tarea \| Prioridad \| Estado \| Impacto \| Link \|\n\|---\|/);
});

test('backlog: un archivo con texto antes de la tabla conserva el texto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  fs.mkdirSync(path.join(dir, 'proyectos', 'p'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proyectos', 'p', 'backlog.md'), '# Backlog\n\nIntro.\n\n| Código | Tarea | Prioridad | Estado | Impacto | Link |\n|---|---|---|---|---|---|\n');
  upsertFila(dir, 'p', 'R-1', { Tarea: 'x' });
  const texto = fs.readFileSync(path.join(dir, 'proyectos', 'p', 'backlog.md'), 'utf8');
  assert.match(texto, /Intro\.\n\n\| Código[^\n]*\n\|---[^\n]*\n\| R-1 \| x \|/);
});

test('fallosDe y soloRojosConocidos: líneas FAIL de vitest, con color', () => {
  const salida = '\u001b[31m FAIL \u001b[39m src/a.test.ts > caso uno 12ms\n ✓ ok\n FAIL  src/b.test.ts > caso\n';
  assert.deepEqual(fallosDe(salida), ['src/a.test.ts > caso uno', 'src/b.test.ts > caso']);
  assert.equal(soloRojosConocidos(fallosDe(salida), ['src/a.test.ts', 'src/b.test.ts']), true);
  assert.equal(soloRojosConocidos(fallosDe(salida), ['src/a.test.ts']), false);
  assert.equal(soloRojosConocidos([], ['x']), false, 'sin fallos reconocibles no es "sólo conocidos"');
  assert.equal(conArchivos('npx vitest related --run {archivos}', ['a b.ts', 'c.ts']), 'npx vitest related --run "a b.ts" "c.ts"');
  assert.equal(conArchivos('npm test', []), 'npm test');
  assert.equal(conArchivos('x {archivos}', []), null);
  assert.equal(conArchivos('t {archivos}', ['src/página (1).ts']), 't "src/página (1).ts"');
  for (const mala of ['a$(rm -rf x).ts', 'a`id`.ts', 'a".ts', 'a%PATH%.ts', 'a;b.ts', 'a&b.ts', 'a\nb.ts', 'a!b.ts']) {
    assert.throws(() => conArchivos('t {archivos}', [mala]), /no se puede pasar al shell/, mala);
  }
});

test('nombreRepo: el del remoto origin (un worktree con otra carpeta es el mismo repo)', () => {
  const raiz = crearRepoTemporal({ nombre: 'wt-R-1' });
  assert.equal(nombreRepo(raiz), 'wt-R-1');
  spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/dueno/repo-demo.git'], { cwd: raiz });
  assert.equal(nombreRepo(raiz), 'repo-demo');
});

test('fallosDe: las líneas "×" sin archivo no cuentan si una línea FAIL ya nombra ese caso', () => {
  const salida = [
    '     × ancla el horizonte 12ms',
    '     × caso suelto 3ms',
    ' FAIL  src/lib/__tests__/sede-isolation.test.ts > Aislamiento > no hay JWT',
    ' FAIL  src/lib/projection/occupancy-engine.test.ts > projectionHorizonForSlot > ancla el horizonte',
  ].join('\n');
  assert.deepEqual(fallosDe(salida), [
    'src/lib/__tests__/sede-isolation.test.ts > Aislamiento > no hay JWT',
    'src/lib/projection/occupancy-engine.test.ts > projectionHorizonForSlot > ancla el horizonte',
    'caso suelto',
  ]);
  const conocidos = ['src/lib/__tests__/sede-isolation.test.ts', 'src/lib/projection/occupancy-engine.test.ts > projectionHorizonForSlot'];
  assert.equal(soloRojosConocidos(fallosDe(salida.replace('     × caso suelto 3ms\n', '')), conocidos), true);
  assert.equal(soloRojosConocidos(fallosDe(salida), conocidos), false, 'un × que no figura en FAIL sigue contando');
});
