import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirLineamientos, buscarRepo, cargarProyecto, carpetaProyecto } from '../plugin/scripts/lib/config.mjs';
import { rutaBacklog } from '../plugin/scripts/lib/backlog.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lineamientos');

const temporales = [];
after(() => { for (const d of temporales) fs.rmSync(d, { recursive: true, force: true }); });

function homeTemporal(json) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home '));
  temporales.push(home);
  if (json !== undefined) {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'bacg-dev.json'), json);
  }
  return home;
}

test('dirLineamientos respeta BACG_LINEAMIENTOS_DIR', () => {
  const home = homeTemporal(JSON.stringify({ lineamientosDir: '/otro' }));
  assert.equal(dirLineamientos({ env: { BACG_LINEAMIENTOS_DIR: '/desde/env' }, home, platform: 'linux' }), '/desde/env');
});

test('dirLineamientos lee bacg-dev.json', () => {
  const home = homeTemporal(JSON.stringify({ lineamientosDir: '/desde/json' }));
  assert.equal(dirLineamientos({ env: {}, home, platform: 'linux' }), '/desde/json');
});

test('dirLineamientos ignora JSON inválido y cae al default', () => {
  const home = homeTemporal('{no es json');
  assert.equal(dirLineamientos({ env: {}, home, platform: 'linux' }), path.join(home, 'lineamientos-bacg'));
});

test('dirLineamientos default por plataforma', () => {
  const home = homeTemporal();
  assert.equal(dirLineamientos({ env: {}, home, platform: 'win32' }), ['C:', 'MiCarpeta', 'lineamientos-bacg'].join(String.fromCharCode(92)));
  assert.ok(dirLineamientos({ env: {}, home, platform: 'win32' }).includes(String.fromCharCode(92) + 'MiCarpeta' + String.fromCharCode(92)));
  assert.equal(dirLineamientos({ env: {}, home, platform: 'linux' }), path.join(home, 'lineamientos-bacg'));
});

test('buscarRepo sube hasta .bacg-lineamientos', () => {
  const repo = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'src/a/b/x.txt': 'x' } });
  temporales.push(repo);
  const r = buscarRepo(path.join(repo, 'src', 'a', 'b'));
  assert.equal(r.proyectoId, 'demo');
  assert.equal(fs.realpathSync(r.raiz), fs.realpathSync(repo));
  assert.ok(repo.includes(' '));
});

test('buscarRepo devuelve null sin .bacg-lineamientos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sin repo-'));
  temporales.push(dir);
  assert.equal(buscarRepo(dir), null);
});

test('buscarRepo saltea un .bacg-lineamientos sin proyecto y sigue subiendo', () => {
  const repo = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'sub/x.txt': 'x' } });
  temporales.push(repo);
  fs.writeFileSync(path.join(repo, 'sub', '.bacg-lineamientos'), 'otra: cosa');
  const r = buscarRepo(path.join(repo, 'sub'));
  assert.equal(r.proyectoId, 'demo');
  assert.equal(fs.realpathSync(r.raiz), fs.realpathSync(repo));
});

test('cargarProyecto carga el proyecto', () => {
  const p = cargarProyecto('demo', fixtures);
  assert.equal(p.id, 'demo');
  assert.equal(p.repos[0].push_prod, true);
});

test('cargarProyecto lanza si no existe', () => {
  assert.throws(() => cargarProyecto('nope', fixtures), {
    message: `Proyecto nope no registrado en ${fixtures}/proyectos`,
  });
});

// --- configuración en el repo (.bacg-dev/) ---

test('buscarRepo reconoce .bacg-dev/proyecto.yml sin .bacg-lineamientos', () => {
  const repo = crearRepoTemporal({ archivos: { '.bacg-dev/proyecto.yml': 'id: remoto\nrepos: []\n', 'src/x.txt': 'x' } });
  temporales.push(repo);
  const r = buscarRepo(path.join(repo, 'src'));
  assert.equal(r.proyectoId, 'remoto');
  assert.equal(fs.realpathSync(r.raiz), fs.realpathSync(repo));
});

test('cargarProyecto prefiere .bacg-dev/ del repo a lineamientos', () => {
  const repo = crearRepoTemporal({ proyectoId: 'demo', archivos: { '.bacg-dev/proyecto.yml': 'id: demo\nnombre: del repo\n' } });
  temporales.push(repo);
  assert.equal(cargarProyecto('demo', fixtures, repo).nombre, 'del repo');
  assert.equal(carpetaProyecto('demo', fixtures, repo), path.join(repo, '.bacg-dev'));
  assert.equal(carpetaProyecto('demo', fixtures, null), path.join(fixtures, 'proyectos', 'demo'));
});

test('rutaBacklog: con configuración en el repo es docs/backlog.md', () => {
  const repo = crearRepoTemporal({ archivos: { '.bacg-dev/proyecto.yml': 'id: remoto\n' } });
  temporales.push(repo);
  assert.equal(rutaBacklog('/lin', 'remoto', repo), path.join(repo, 'docs', 'backlog.md'));
  assert.equal(rutaBacklog('/lin', 'remoto', null), path.join('/lin', 'proyectos', 'remoto', 'backlog.md'));
});

test('dirLineamientos: lineamientosDir como lista toma la primera copia que existe', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-lista-'));
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-real-'));
  fs.mkdirSync(path.join(real, 'proyectos'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'bacg-dev.json'), JSON.stringify({ lineamientosDir: ['/no/existe', real] }));
  assert.equal(dirLineamientos({ env: {}, home, platform: 'linux' }), real);
  fs.writeFileSync(path.join(home, '.claude', 'bacg-dev.json'), JSON.stringify({ lineamientosDir: ['/no/existe', '/tampoco'] }));
  assert.equal(dirLineamientos({ env: {}, home, platform: 'linux' }), '/no/existe');
});
