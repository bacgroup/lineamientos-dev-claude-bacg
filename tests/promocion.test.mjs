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

// Remoto con main (PROD) y develop (DEV); el clon queda en rq/R-1 con un commit que DEV no tiene.
function montar() {
  const remoto = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'remoto ')), 'erp-app.git');
  fs.mkdirSync(remoto);
  git(remoto, 'init', '-q', '--bare');
  const raiz = crearRepoTemporal({ proyectoId: 'erp', nombre: 'erp-app' });
  git(raiz, 'remote', 'add', 'origin', remoto);
  git(raiz, 'checkout', '-q', '-b', 'main');
  git(raiz, 'push', '-q', '-u', 'origin', 'main');
  git(raiz, 'checkout', '-q', '-b', 'develop');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'en dev');
  git(raiz, 'push', '-q', '-u', 'origin', 'develop');
  git(raiz, 'checkout', '-q', '-b', 'rq/R-1');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'sólo en la rama del RQ');
  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin '));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'erp'), { recursive: true });
  fs.writeFileSync(
    path.join(dirLin, 'proyectos', 'erp', 'proyecto.yml'),
    'id: erp\nramas_prod: ["main"]\nramas_solo_pr: ["develop"]\nrepos:\n  - { nombre: erp-app, rol: padre, push_prod: true }\ncircuito_prod:\n  - { paso: "push:erp-app" }\n',
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

const ORDEN = { prod: ['main'], dev: 'develop' };

test('ordenDeRamas: sólo con ramas_prod y una rama de DEV distinta', () => {
  assert.deepEqual(ordenDeRamas({ ramas_prod: ['main'], ramas_solo_pr: ['develop'] }, { nombre: 'x' }), ORDEN);
  assert.deepEqual(ordenDeRamas({ ramas_prod: ['main'], entornos: { dev: { tipo: 'rama', rama: 'develop' } } }, { nombre: 'x' }), ORDEN);
  assert.deepEqual(ordenDeRamas({ ramas_prod: ['main'] }, { nombre: 'x', rama_dev: 'develop' }), { prod: ['main'], dev: 'develop' });
  assert.equal(ordenDeRamas({ ramas_prod: ['main'] }, { nombre: 'x' }), null, 'sin DEV: no aplica');
  assert.equal(ordenDeRamas({ ramas_solo_pr: ['dev'] }, { nombre: 'x' }), null, 'sin ramas_prod: no aplica');
  assert.equal(ordenDeRamas({ ramas_prod: ['main'], ramas_solo_pr: ['main'] }, { nombre: 'x' }), null, 'DEV = PROD: no aplica');
});

test('push a PROD: la rama del RQ directo se niega; la promoción desde origin/develop pasa', () => {
  const { raiz } = montar();
  const directo = faltaPasarPorDev({ op: 'push', refspecs: ['HEAD:main'] }, raiz, 'erp-app', ORDEN, ['main']);
  assert.match(directo, /a main \(PROD\) sólo llega lo que ya está en origin\/develop/);
  assert.match(directo, /gh pr create --base develop/);
  assert.match(directo, /saltar rama/);
  assert.equal(faltaPasarPorDev({ op: 'push', refspecs: ['origin/develop:main'] }, raiz, 'erp-app', ORDEN, ['main']), null);
  assert.equal(faltaPasarPorDev({ op: 'push', refspecs: ['develop:main'] }, raiz, 'erp-app', ORDEN, ['main']), null, 'la develop local, al día con origin');
  assert.equal(faltaPasarPorDev({ op: 'push', refspecs: ['HEAD:rq/R-1'] }, raiz, 'erp-app', ORDEN, ['rq/R-1']), null, 'no va a PROD');
  assert.match(faltaPasarPorDev({ op: 'push', refspecs: [':main'] }, raiz, 'erp-app', ORDEN, ['main']), /no pasaron por develop/, 'borrar la rama de PROD');
});

test('push a PROD sin origin/<DEV> traído: pide git fetch', () => {
  const { raiz } = montar();
  git(raiz, 'update-ref', '-d', 'refs/remotes/origin/develop');
  assert.match(faltaPasarPorDev({ op: 'push', refspecs: ['HEAD:main'] }, raiz, 'erp-app', ORDEN, ['main']), /git fetch origin/);
});

test('merge de PR a PROD: sólo el que viene de la rama de DEV; sin poder leerlo, se niega', () => {
  const { raiz } = montar();
  const op = { op: 'merge-pr', pr: '7' };
  assert.equal(faltaPasarPorDev(op, raiz, 'erp-app', ORDEN, ['main'], { headPr: () => 'develop' }), null);
  assert.match(faltaPasarPorDev(op, raiz, 'erp-app', ORDEN, ['main'], { headPr: () => 'rq/R-1' }), /este PR viene de rq\/R-1/);
  assert.match(faltaPasarPorDev(op, raiz, 'erp-app', ORDEN, ['main'], { headPr: () => null }), /no pude leer de qué rama viene/);
  assert.equal(faltaPasarPorDev(op, raiz, 'erp-app', ORDEN, ['develop'], { headPr: () => 'rq/R-1' }), null, 'PR a DEV');
});

test('gh pr create: a PROD desde la rama del RQ se niega (también sin --base si la rama por defecto es PROD)', () => {
  const { raiz } = montar();
  const defecto = { ramaPorDefecto: () => 'main' };
  assert.match(prAProdSinDev({ op: 'pr-create', base: 'main' }, raiz, 'erp-app', ORDEN, defecto), /un PR a main \(PROD\) sólo puede venir de develop.*--base develop/);
  assert.match(prAProdSinDev({ op: 'pr-create' }, raiz, 'erp-app', ORDEN, defecto), /sin --base, gh usa la rama por defecto del repo, que es main/);
  assert.equal(prAProdSinDev({ op: 'pr-create', base: 'develop' }, raiz, 'erp-app', ORDEN, defecto), null);
  assert.equal(prAProdSinDev({ op: 'pr-create', base: 'main', head: 'develop' }, raiz, 'erp-app', ORDEN, defecto), null, 'la promoción');
  assert.equal(prAProdSinDev({ op: 'pr-create' }, raiz, 'erp-app', ORDEN, { ramaPorDefecto: () => null }), null, 'sin saber la base: no frena');
});

test('compuerta de Bash: frena push y PR a PROD desde la rama del RQ; deja la promoción; saltar rama habilita el hotfix', () => {
  const { raiz, ev } = montar();
  const defecto = { ramaPorDefecto: () => 'main' };
  const push = ev('git push origin HEAD:main');
  assert.equal(push.decision, 'deny');
  assert.match(push.motivo, /sólo llega lo que ya está en origin\/develop/);
  const pr = ev('gh pr create --fill', defecto);
  assert.equal(pr.decision, 'deny');
  assert.match(pr.motivo, /gh pr create --base develop/);
  assert.equal(ev('gh pr create --fill --base develop', defecto).decision, 'allow');
  assert.equal(ev('gh pr create -B main -H develop --fill', defecto).decision, 'allow', 'PR de promoción');
  assert.equal(ev('gh pr merge 7 --merge', { basePr: () => 'main', headPr: () => 'rq/R-1' }).decision, 'deny');
  const promo = ev('git push origin origin/develop:main');
  assert.doesNotMatch(promo.motivo ?? '', /origin\/develop/, 'la promoción no la frena el orden de ramas');
  // Hotfix: el usuario decide saltear el orden de ramas.
  const e = { codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', etapa: 5, autonomia: null, circuito: [],
    aprobaciones: [{ etapa: 1, frase: 'ok', fecha: '2026-11-10T12:00:00Z' }, { etapa: 5, frase: 'a PROD', fecha: '2026-11-10T12:00:00Z' }],
    saltos: [{ compuerta: 'rama', frase: 'hotfix directo', motivo: 'caída en PROD', fecha: '2026-11-10T12:00:00Z' }],
    tests: { ok: true, arbol: 'x' }, revision: { ok: true }, skills: [] };
  guardarEstado(raiz, e);
  assert.doesNotMatch(ev('git push origin HEAD:main', { textosUsuario: ['a PROD', 'hotfix directo'] }).motivo ?? '', /origin\/develop/);
  assert.equal(ev('gh pr create --fill', { ...defecto, textosUsuario: ['a PROD', 'hotfix directo'] }).decision, 'allow');
});

test('circuito con dev:verificado: la promoción a PROD espera la verificación en DEV (no es manual)', () => {
  const { raiz, dirLin, ev } = montar();
  fs.writeFileSync(
    path.join(dirLin, 'proyectos', 'erp', 'proyecto.yml'),
    'id: erp\nramas_prod: ["main"]\nramas_solo_pr: ["develop"]\nrepos:\n  - { nombre: erp-app, rol: padre, push_prod: true }\ncircuito_prod:\n  - { paso: "dev:verificado" }\n  - { paso: "push:erp-app" }\n',
  );
  const skills = ['superpowers:brainstorming', 'superpowers:test-driven-development', 'superpowers:verification-before-completion'].map((skill) => ({ skill, etapa: 2, fecha: '2026-11-10T12:00:00Z' }));
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'spec.md'), '# R-1\n## Diseño\nx\n## Tareas\n- a\n');
  const base = { codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', etapa: 5, autonomia: null, saltos: [],
    aprobaciones: [{ etapa: 1, frase: 'ok', fecha: '2026-11-10T12:00:00Z' }, { etapa: 5, frase: 'a PROD', fecha: '2026-11-10T12:00:00Z' }],
    tests: { ok: true, arbol: 'x' }, revision: { ok: true }, skills };
  guardarEstado(raiz, { ...base, circuito: [] });
  const sin = ev('git push origin origin/develop:main');
  assert.equal(sin.decision, 'deny');
  assert.match(sin.motivo, /falta el paso dev:verificado antes de push:erp-app/);
  guardarEstado(raiz, { ...base, circuito: [{ paso: 'dev:verificado', fecha: '2026-11-10T13:00:00Z', evidencia: 'probado en dev' }] });
  assert.equal(ev('git push origin origin/develop:main').decision, 'allow');
});
