import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from '../plugin/scripts/vendor/js-yaml.mjs';
import { crearRepoTemporal } from './helpers.mjs';
import { modoArranque, estadoRepo, ultimoTrabajado, textoArranque } from '../plugin/scripts/lib/arranque.mjs';
import { limpiarCacheOdoo } from '../plugin/scripts/lib/odoo-skills.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_LIN = path.join(AQUI, 'fixtures', 'lineamientos');
const PROYECTO = { id: 'demo', nombre: 'Demo', repos: [{ nombre: 'demo-app', rol: 'padre' }, { nombre: 'demo-externo', rol: 'addons' }] };

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const repoDemo = (archivos = {}) => crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app', archivos });
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' }).stdout;

function abrirRq(raiz, estado = {}) {
  const codigo = estado.codigo ?? 'R-T1';
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', codigo), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), `${codigo}\n`);
  const completo = { codigo, tipo: 'rq', clasificacion: 'bounded', etapa: 2, autonomia: null, aprobaciones: [], saltos: [], circuito: [], version_ciclo: 4, ...estado };
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', codigo, 'estado.yml'), yaml.dump(completo));
  return codigo;
}

test('modoArranque: sin RQ → inicio; con ACTIVO en etapa 2 → reanudación; cerrado (6) → inicio', () => {
  const raiz = repoDemo();
  assert.deepEqual(modoArranque(raiz), { modo: 'inicio' });
  abrirRq(raiz);
  assert.deepEqual(modoArranque(raiz), { modo: 'reanudacion', codigo: 'R-T1' });
  abrirRq(raiz, { etapa: 6 });
  assert.equal(modoArranque(raiz).modo, 'inicio');
});

test('estadoRepo: rama, cambios sin commitear y repo no clonado', () => {
  const raiz = repoDemo();
  fs.writeFileSync(path.join(raiz, 'nuevo.txt'), 'x');
  const e = estadoRepo(raiz);
  assert.equal(e.nombre, 'demo-app');
  assert.equal(e.clonado, true);
  assert.ok(e.rama);
  assert.equal(e.sinCommitear, 1);
  assert.equal(e.adelante, 0);
  const ausente = estadoRepo(path.join(tmp('vacio como-'), 'no-existe'));
  assert.equal(ausente.clonado, false);
  assert.equal(ausente.nombre, 'no-existe');
});

test('ultimoTrabajado: 5 filas del backlog (las más recientes primero) y 3 entradas del changelog', () => {
  const filas = Array.from({ length: 7 }, (_, i) => `| R-${i + 1} | Tarea ${i + 1} | Alta | ${i < 3 ? 'Hecho' : 'En curso'} | x | |`).join('\n');
  const raiz = repoDemo({
    'docs/backlog.md': `# Backlog\n\n| Código | Tarea | Prioridad | Estado | Impacto | Link |\n|---|---|---|---|---|---|\n${filas}\n`,
    'CHANGELOG.md': '# Changelog\n\n## 1.3.0: uno\n\n- a\n\n## 1.2.0: dos\n\n## 1.1.0: tres\n\n## 1.0.0: cuatro\n',
    '.bacg-dev/proyecto.yml': 'id: demo\nnombre: Demo\n',
  });
  const u = ultimoTrabajado(raiz, { id: 'demo' }, DIR_LIN);
  assert.equal(u.backlog.length, 5);
  assert.deepEqual(u.backlog.map((f) => f.codigo), ['R-7', 'R-6', 'R-5', 'R-4', 'R-3']);
  assert.equal(u.backlog[0].estado, 'En curso');
  assert.deepEqual(u.changelog, ['1.3.0: uno', '1.2.0: dos', '1.1.0: tres']);
});

test('textoArranque: repo sin RQ → inicio con el proyecto, repos y "Lo último"', () => {
  const raiz = repoDemo();
  const t = textoArranque({ raiz, proyecto: PROYECTO, dirLin: DIR_LIN });
  assert.match(t, /Demo/);
  assert.match(t, /Lo último/);
  assert.match(t, /demo-externo/);
  assert.match(t, /no clonado/);
  assert.doesNotMatch(t, /Dónde nos quedamos/);
});

test('textoArranque: con RQ en etapa 2 → reanudación con etapa, lo que falta, rama y commit', () => {
  const raiz = repoDemo();
  abrirRq(raiz);
  fs.writeFileSync(path.join(raiz, 'sucio.txt'), 'x');
  const t = textoArranque({ raiz, proyecto: PROYECTO, dirLin: DIR_LIN });
  assert.match(t, /Dónde nos quedamos/);
  assert.match(t, /R-T1/);
  assert.match(t, /Acotado/);
  assert.match(t, /Desarrollo/);
  assert.match(t, /Falta para la etapa 3 \(Verificación\):/);
  assert.match(t, /inicial/);
  assert.match(t, /sin commitear/);
});

test('textoArranque: carpeta padre con dos repos → una línea por repo, sin excepción', () => {
  const padre = tmp('padre como-');
  for (const n of ['uno', 'dos']) {
    const d = path.join(padre, n);
    fs.mkdirSync(d);
    spawnSync('git', ['init', '-q'], { cwd: d });
    fs.writeFileSync(path.join(d, '.bacg-lineamientos'), 'proyecto: demo\n');
  }
  const t = textoArranque({ raiz: padre, proyecto: null, dirLin: DIR_LIN });
  const lineas = t.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lineas.length, 2);
  assert.match(t, /uno/);
  assert.match(t, /dos/);
});

test('textoArranque: sin Odoo no nombra Odoo; con addons sí', () => {
  limpiarCacheOdoo();
  const sin = repoDemo();
  assert.doesNotMatch(textoArranque({ raiz: sin, proyecto: PROYECTO, dirLin: DIR_LIN }), /Odoo/i);
  const con = repoDemo({ 'mod/__manifest__.py': '{}' });
  assert.match(textoArranque({ raiz: con, proyecto: PROYECTO, dirLin: DIR_LIN }), /Odoo/);
  limpiarCacheOdoo();
});

test('textoArranque no escribe: dos corridas seguidas dejan git status igual', () => {
  const raiz = repoDemo();
  abrirRq(raiz);
  git(raiz, 'add', '-A');
  git(raiz, 'commit', '-qm', 'rq');
  const antes = git(raiz, 'status', '--porcelain');
  textoArranque({ raiz, proyecto: PROYECTO, dirLin: DIR_LIN });
  textoArranque({ raiz, proyecto: PROYECTO, dirLin: DIR_LIN });
  assert.equal(git(raiz, 'status', '--porcelain'), antes);
});
