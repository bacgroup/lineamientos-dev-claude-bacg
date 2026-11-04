// PLG-CT: un repo del producto sin archivos del plugin se reconoce por su remoto origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buscarRepo, remotoGh } from '../plugin/scripts/lib/config.mjs';
import { reposDebajo } from '../plugin/scripts/lib/hooks/session-start.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function montar() {
  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-remoto-'));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'pf'), { recursive: true });
  fs.writeFileSync(path.join(dirLin, 'proyectos', 'pf', 'proyecto.yml'),
    'id: pf\ncuenta_github: OrgX\nrepos:\n  - { nombre: pf-addons }\n  - { nombre: otro-nombre, github: "terceros/pf-fork" }\n');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-remoto-'));
  const repo = (nombre, url) => {
    const d = path.join(ws, nombre);
    fs.mkdirSync(d);
    git(d, 'init', '-q');
    if (url) git(d, 'remote', 'add', 'origin', url);
    return d;
  };
  return {
    dirLin, ws,
    addons: repo('pf-addons', 'https://github.com/orgx/pf-addons.git'),
    ssh: repo('fork', 'git@github.com:terceros/pf-fork.git'),
    ajeno: repo('ajeno', 'https://github.com/orgx/no-declarado'),
    suelto: repo('suelto', null),
  };
}

test('remotoGh: https, ssh y proxy', () => {
  const { addons, ssh } = montar();
  assert.equal(remotoGh(addons), 'orgx/pf-addons');
  assert.equal(remotoGh(ssh), 'terceros/pf-fork');
});

test('sin marcador: se reconoce por remoto declarado (cuenta_github/nombre o github:), también desde una subcarpeta', () => {
  const { dirLin, addons, ssh } = montar();
  const sub = path.join(addons, 'mod', 'views');
  fs.mkdirSync(sub, { recursive: true });
  assert.deepEqual(buscarRepo(sub, { dirLin }), { raiz: path.resolve(addons), proyectoId: 'pf', porRemoto: true });
  assert.equal(buscarRepo(ssh, { dirLin })?.proyectoId, 'pf');
});

test('remoto no declarado, sin remoto o fuera de git: no es un repo del proyecto', () => {
  const { dirLin, ajeno, suelto } = montar();
  assert.equal(buscarRepo(ajeno, { dirLin }), null);
  assert.equal(buscarRepo(suelto, { dirLin }), null);
  assert.equal(buscarRepo(os.tmpdir(), { dirLin }), null);
});

test('el marcador manda sobre el remoto', () => {
  const { dirLin, addons } = montar();
  fs.writeFileSync(path.join(addons, '.bacg-lineamientos'), 'proyecto: otro\n');
  assert.equal(buscarRepo(addons, { dirLin }).proyectoId, 'otro');
});

test('el arranque lista los repos reconocidos por remoto debajo de la carpeta', () => {
  const { dirLin, ws } = montar();
  assert.deepEqual(reposDebajo(ws, 2, dirLin).map((d) => path.basename(d)).sort(), ['fork', 'pf-addons']);
});
