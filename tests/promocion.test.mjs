// PLG-RAMAS: orden de ramas DEV → PROD. Con ramas_prod y una rama de DEV, a PROD sólo llega lo que ya pasó por DEV.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluarBash } from '../plugin/scripts/lib/compuerta-bash.mjs';
import { ordenDeRamas, faltaPasarPorDev, prAProdSinDev } from '../plugin/scripts/lib/promocion.mjs';
import { guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// Remoto con 18.0 (PROD) y 18.0-dev (DEV); el clon queda en rq/R-1 con un commit que DEV no tiene.
function montar() {
  const remoto = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'remoto ')), 'erp-app.git');
  fs.mkdirSync(remoto);
  git(remoto, 'init', '-q', '--bare');
  const raiz = crearRepoTemporal({ proyectoId: 'erp', nombre: 'erp-app' });
  git(raiz, 'remote', 'add', 'origin', remoto);
  git(raiz, 'checkout', '-q', '-b', '18.0');
  git(raiz, 'push', '-q', '-u', 'origin', '18.0');
  git(raiz, 'checkout', '-q', '-b', '18.0-dev');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'en dev');
  git(raiz, 'push', '-q', '-u', 'origin', '18.0-dev');
  git(raiz, 'checkout', '-q', '-b', 'rq/R-1');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'sólo en la rama del RQ');
  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin '));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'erp'), { recursive: true });
  fs.writeFileSync(
    path.join(dirLin, 'proyectos', 'erp', 'proyecto.yml'),
    'id: erp\nramas_prod: ["18.0"]\nramas_solo_pr: ["18.0-dev"]\nrepos:\n  - { nombre: erp-app, rol: padre, push_prod: true }\ncircuito_prod:\n  - { paso: "push:erp-app" }\n',
  );
  // RQ con todo para PROD (verificación y OK de PROD): lo único que puede frenar es el orden de ramas.
  guardarEstado(raiz, {
    codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', etapa: 5, autonomia: null, saltos: [], circuito: [],
    aprobaciones: [{ etapa: 1, frase: 'ok', fecha: '2026-11-10T12:00:00Z' }, { etapa: 5, frase: 'a PROD', fecha: '2026-11-10T12:00:00Z' }],
    tests: { ok: true, arbol: 'x' }, revision: { ok: true }, skills: [],
  });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-1\n');
  const ev = (comando, ctx = {}) => evaluarBash({ comando, cwd: raiz, ctx: { textosUsuario: ['a PROD'], ...ctx }, dirLin });
  return { raiz, dirLin, ev };
}

const ORDEN = { prod: ['18.0'], dev: '18.0-dev' };

test('ordenDeRamas: sólo con ramas_prod y una rama de DEV distinta', () => {
  assert.deepEqual(ordenDeRamas({ ramas_prod: ['18.0'], ramas_solo_pr: ['18.0-dev'] }, { nombre: 'x' }), ORDEN);
  assert.deepEqual(ordenDeRamas({ ramas_prod: ['18.0'], entornos: { dev: { tipo: 'rama', rama: '18.0-dev' } } }, { nombre: 'x' }), ORDEN);
  assert.deepEqual(ordenDeRamas({ ramas_prod: ['main'] }, { nombre: 'x', rama_dev: 'develop' }), { prod: ['main'], dev: 'develop' });
  assert.equal(ordenDeRamas({ ramas_prod: ['main'] }, { nombre: 'x' }), null, 'sin DEV: no aplica');
  assert.equal(ordenDeRamas({ ramas_solo_pr: ['dev'] }, { nombre: 'x' }), null, 'sin ramas_prod: no aplica');
  assert.equal(ordenDeRamas({ ramas_prod: ['main'], ramas_solo_pr: ['main'] }, { nombre: 'x' }), null, 'DEV = PROD: no aplica');
});

test('push a PROD: la rama del RQ directo se niega; la promoción desde origin/18.0-dev pasa', () => {
  const { raiz } = montar();
  const directo = faltaPasarPorDev({ op: 'push', refspecs: ['HEAD:18.0'] }, raiz, 'erp-app', ORDEN, ['18.0']);
  assert.match(directo, /a 18\.0 \(PROD\) sólo llega lo que ya está en origin\/18\.0-dev/);
  assert.match(directo, /gh pr create --base 18\.0-dev/);
  assert.match(directo, /saltar rama/);
  assert.equal(faltaPasarPorDev({ op: 'push', refspecs: ['origin/18.0-dev:18.0'] }, raiz, 'erp-app', ORDEN, ['18.0']), null);
  assert.equal(faltaPasarPorDev({ op: 'push', refspecs: ['18.0-dev:18.0'] }, raiz, 'erp-app', ORDEN, ['18.0']), null, 'la 18.0-dev local, al día con origin');
  assert.equal(faltaPasarPorDev({ op: 'push', refspecs: ['HEAD:rq/R-1'] }, raiz, 'erp-app', ORDEN, ['rq/R-1']), null, 'no va a PROD');
  assert.match(faltaPasarPorDev({ op: 'push', refspecs: [':18.0'] }, raiz, 'erp-app', ORDEN, ['18.0']), /no pasaron por 18\.0-dev/, 'borrar la rama de PROD');
});

test('push a PROD sin origin/<DEV> traído: pide git fetch', () => {
  const { raiz } = montar();
  git(raiz, 'update-ref', '-d', 'refs/remotes/origin/18.0-dev');
  assert.match(faltaPasarPorDev({ op: 'push', refspecs: ['HEAD:18.0'] }, raiz, 'erp-app', ORDEN, ['18.0']), /git fetch origin/);
});

test('merge de PR a PROD: sólo el que viene de la rama de DEV; sin poder leerlo, se niega', () => {
  const { raiz } = montar();
  const op = { op: 'merge-pr', pr: '7' };
  assert.equal(faltaPasarPorDev(op, raiz, 'erp-app', ORDEN, ['18.0'], { headPr: () => '18.0-dev' }), null);
  assert.match(faltaPasarPorDev(op, raiz, 'erp-app', ORDEN, ['18.0'], { headPr: () => 'rq/R-1' }), /este PR viene de rq\/R-1/);
  assert.match(faltaPasarPorDev(op, raiz, 'erp-app', ORDEN, ['18.0'], { headPr: () => null }), /no pude leer de qué rama viene/);
  assert.equal(faltaPasarPorDev(op, raiz, 'erp-app', ORDEN, ['18.0-dev'], { headPr: () => 'rq/R-1' }), null, 'PR a DEV');
});

test('gh pr create: a PROD desde la rama del RQ se niega (también sin --base si la rama por defecto es PROD)', () => {
  const { raiz } = montar();
  const defecto = { ramaPorDefecto: () => '18.0' };
  assert.match(prAProdSinDev({ op: 'pr-create', base: '18.0' }, raiz, 'erp-app', ORDEN, defecto), /un PR a 18\.0 \(PROD\) sólo puede venir de 18\.0-dev.*--base 18\.0-dev/);
  assert.match(prAProdSinDev({ op: 'pr-create' }, raiz, 'erp-app', ORDEN, defecto), /sin --base, gh usa la rama por defecto del repo, que es 18\.0/);
  assert.equal(prAProdSinDev({ op: 'pr-create', base: '18.0-dev' }, raiz, 'erp-app', ORDEN, defecto), null);
  assert.equal(prAProdSinDev({ op: 'pr-create', base: '18.0', head: '18.0-dev' }, raiz, 'erp-app', ORDEN, defecto), null, 'la promoción');
  assert.equal(prAProdSinDev({ op: 'pr-create' }, raiz, 'erp-app', ORDEN, { ramaPorDefecto: () => null }), null, 'sin saber la base: no frena');
});

test('compuerta de Bash: frena push y PR a PROD desde la rama del RQ; deja la promoción; saltar rama habilita el hotfix', () => {
  const { raiz, ev } = montar();
  const defecto = { ramaPorDefecto: () => '18.0' };
  const push = ev('git push origin HEAD:18.0');
  assert.equal(push.decision, 'deny');
  assert.match(push.motivo, /sólo llega lo que ya está en origin\/18\.0-dev/);
  const pr = ev('gh pr create --fill', defecto);
  assert.equal(pr.decision, 'deny');
  assert.match(pr.motivo, /gh pr create --base 18\.0-dev/);
  assert.equal(ev('gh pr create --fill --base 18.0-dev', defecto).decision, 'allow');
  assert.equal(ev('gh pr create -B 18.0 -H 18.0-dev --fill', defecto).decision, 'allow', 'PR de promoción');
  assert.equal(ev('gh pr merge 7 --merge', { basePr: () => '18.0', headPr: () => 'rq/R-1' }).decision, 'deny');
  const promo = ev('git push origin origin/18.0-dev:18.0');
  assert.doesNotMatch(promo.motivo ?? '', /origin\/18\.0-dev/, 'la promoción no la frena el orden de ramas');
  // Hotfix: el usuario decide saltear el orden de ramas.
  const e = { codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', etapa: 5, autonomia: null, circuito: [],
    aprobaciones: [{ etapa: 1, frase: 'ok', fecha: '2026-11-10T12:00:00Z' }, { etapa: 5, frase: 'a PROD', fecha: '2026-11-10T12:00:00Z' }],
    saltos: [{ compuerta: 'rama', frase: 'hotfix directo', motivo: 'caída en PROD', fecha: '2026-11-10T12:00:00Z' }],
    tests: { ok: true, arbol: 'x' }, revision: { ok: true }, skills: [] };
  guardarEstado(raiz, e);
  assert.doesNotMatch(ev('git push origin HEAD:18.0', { textosUsuario: ['a PROD', 'hotfix directo'] }).motivo ?? '', /origin\/18\.0-dev/);
  assert.equal(ev('gh pr create --fill', { ...defecto, textosUsuario: ['a PROD', 'hotfix directo'] }).decision, 'allow');
});
