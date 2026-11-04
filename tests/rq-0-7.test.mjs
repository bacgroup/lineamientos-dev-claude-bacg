// 0.7.0: commit en un paso, skills por etapa, etapa derivada, pendientes después de cerrar y E2E con alcance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado, guardarEstado, etapaDerivada } from '../plugin/scripts/lib/estado.mjs';
import { faltaParaEtapa, sensibleSinRevisar } from '../plugin/scripts/lib/requisitos.mjs';
import { crearRepoTemporal } from './helpers.mjs';

async function correr(cwd, args, env) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    env: { BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', ...env },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

function lin(yml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-'));
  fs.mkdirSync(path.join(dir, 'proyectos', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proyectos', 'demo', 'proyecto.yml'), `id: demo\n${yml}`);
  return { BACG_LINEAMIENTOS_DIR: dir };
}

// Con core.autocrlf el stash pop devuelve CRLF, como cualquier checkout en Windows.
const leerLf = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const git = (raiz, ...a) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8' });
// Pasa si src/a.ts dice "ok": los cambios sin stagear de otros archivos no tienen que influir.
const UNIT = `node -e "process.exit(require('fs').readFileSync('src/a.ts','utf8').trim()==='ok'?0:1)"`;

test('commit: add, tests, registro y commit en un paso; los cambios sin stagear quedan aparte y vuelven', async () => {
  const env = lin(`tests:\n  unit: ${JSON.stringify(UNIT)}\n`);
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'src/a.ts': 'ok\n', 'src/b.ts': 'b\n' } });
  assert.equal((await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded'], env)).code, 0);
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'ok\n// cambio\n');
  fs.writeFileSync(path.join(raiz, 'src', 'b.ts'), 'b sin stagear\n');
  let r = await correr(raiz, ['commit', 'feat: algo', 'src/a.ts'], env);
  assert.equal(r.code, 1, 'a.ts no dice "ok": los tests fallan y no hay commit');
  assert.match(r.out, /Tests fallaron/);
  assert.equal(leerLf(path.join(raiz, 'src', 'b.ts')), 'b sin stagear\n', 'b.ts volvió del stash');
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'ok');
  r = await correr(raiz, ['commit', 'feat: algo', 'src/a.ts'], env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^Commit \w+ feat\(R-1\): algo · tests ok \(1 comando\(s\)\)\.\n$/);
  assert.equal(leerLf(path.join(raiz, 'src', 'b.ts')), 'b sin stagear\n');
  const archivos = git(raiz, 'show', '--name-only', '--format=', 'HEAD');
  assert.match(archivos, /docs\/rq\/R-1\/estado\.yml/);
  assert.match(archivos, /src\/a\.ts/);
  assert.doesNotMatch(archivos, /src\/b\.ts/);
  assert.equal(cargarEstado(raiz, 'R-1').tests.ok, true);
});

test('commit: sólo docs no corre tests; BUG sin systematic-debugging no commitea código', async () => {
  const env = lin(`tests:\n  unit: ${JSON.stringify(UNIT)}\n`);
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'src/a.ts': 'ok' } });
  await correr(raiz, ['abrir', 'B-1', '--tipo', 'bug', '--clasificacion', 'bounded'], env);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'B-1', 'spec.md'), '# B-1 · x\n## Causa\nun off-by-one\n');
  let r = await correr(raiz, ['commit', 'docs(B-1): encuadre', 'docs/rq/B-1'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /sólo docs y tests: sin correr tests/);
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'ok ');
  r = await correr(raiz, ['commit', 'fix: arreglo', 'src/a.ts'], env);
  assert.equal(r.code, 1);
  assert.match(r.err, /falta: superpowers:systematic-debugging/);
  const e = cargarEstado(raiz, 'B-1');
  e.skills = [{ skill: 'superpowers:systematic-debugging', etapa: 1 }];
  guardarEstado(raiz, e);
  r = await correr(raiz, ['commit', 'fix: arreglo', 'src/a.ts'], env);
  assert.equal(r.code, 0, r.out + r.err);
});

test('etapa: la base de un RQ abierto sólo para el backlog pasa a HEAD al empezar el trabajo (E2)', async () => {
  const env = lin('');
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-2', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  const vieja = cargarEstado(raiz, 'R-2').base;
  fs.writeFileSync(path.join(raiz, 'ajeno.md'), 'x');
  git(raiz, 'add', 'ajeno.md');
  git(raiz, 'commit', '-q', '-m', 'otro trabajo');
  const head = git(raiz, 'rev-parse', 'HEAD').trim();
  assert.notEqual(vieja, head);
  await correr(raiz, ['etapa', '1'], env);
  assert.equal(cargarEstado(raiz, 'R-2').base, head);
});

test('etapa derivada de la evidencia y skills exigidas por tipo', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'docs/rq/R-3/spec.md': '# R-3' } });
  const e = { codigo: 'R-3', tipo: 'rq', clasificacion: 'bounded', etapa: 0 };
  assert.equal(etapaDerivada(e, raiz), 1);
  assert.equal(etapaDerivada({ ...e, tests: { ok: true }, revision: { ok: true } }, raiz), 4);
  assert.equal(etapaDerivada({ ...e, tests: { ok: true }, revision: { ok: true }, e2e: { ok: true } }, raiz), 5);
  assert.equal(etapaDerivada({ ...e, circuito: [{ paso: 'push:x' }] }, raiz), 6);
  assert.equal(etapaDerivada({ ...e, etapa: 7 }, raiz), 7);
  assert.deepEqual(faltaParaEtapa(e, 3, raiz), []);
  assert.deepEqual(faltaParaEtapa({ ...e, clasificacion: 'arquitectonico' }, 3, raiz), ['superpowers:writing-plans']);
  assert.deepEqual(faltaParaEtapa({ ...e, skills: ['test-driven-development'] }, 6, raiz), [
    'superpowers:verification-before-completion',
    'la revisión ($RQ revision ok)',
  ]);
  const bug = { codigo: 'R-3', tipo: 'bug', skills: ['superpowers:systematic-debugging'] };
  assert.deepEqual(faltaParaEtapa(bug, 3, raiz), ['la causa raíz en docs/rq/R-3/spec.md (## Causa)']);
  const p = { sensible: { rutas: ['src/lib/billing*'] } };
  assert.equal(sensibleSinRevisar({}, ['src/lib/billing.ts'], p), 'src/lib/billing.ts');
  assert.equal(sensibleSinRevisar({ skills: [{ skill: 'claude-security:claude-security' }] }, ['src/lib/billing.ts'], p), null);
  assert.equal(sensibleSinRevisar({ saltos: [{ compuerta: 'seguridad', frase: 'dale' }] }, ['src/lib/billing.ts'], p), null);
});

test('paso después de cerrar recalcula pendientes, backlog y log (E3); estado lista los cerrados con pendientes (E10)', async () => {
  const env = lin('circuito_prod:\n  - { paso: "manual:publicar-en-lovable" }\n');
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-4', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  await correr(raiz, ['etapa', '6'], env);
  let r = await correr(raiz, ['cerrar', '--resumen', 'Algo nuevo.'], env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(cargarEstado(raiz, 'R-4').pendientes, ['manual:publicar-en-lovable']);
  r = await correr(raiz, ['estado'], env);
  assert.match(r.out, /Cerrado con pendientes: R-4 \(falta: manual:publicar-en-lovable/);
  r = await correr(raiz, ['paso', 'manual:publicar-en-lovable', '--rq', 'R-4'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /RQ cerrado: sin pendientes/);
  assert.equal(cargarEstado(raiz, 'R-4').pendientes, undefined);
  const log = fs.readFileSync(path.join(raiz, 'docs', 'log', 'rq.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.at(-1).resueltos, ['manual:publicar-en-lovable']);
  assert.match(fs.readFileSync(path.join(raiz, 'docs', 'backlog.md'), 'utf8'), /\| Hecho \d\d\/\d\d\/\d{4} \|/);
});

test('verificar con {specs}: corre los specs del RQ y registra que no fue completo; --completo corre todo', async () => {
  const e2e = `node -e "require('fs').writeFileSync('e2e-args.txt', process.argv.slice(1).join('|'))" {specs}`;
  const env = lin(`tests:\n  e2e: ${JSON.stringify(e2e)}\n`);
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  await correr(raiz, ['abrir', 'R-5', '--tipo', 'rq', '--clasificacion', 'bounded'], env);
  fs.mkdirSync(path.join(raiz, 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'e2e', 'r5.spec.ts'), 'x');
  git(raiz, 'add', 'e2e');
  git(raiz, 'commit', '-q', '-m', 'test(R-5): e2e');
  let r = await correr(raiz, ['verificar'], env);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(raiz, 'e2e-args.txt'), 'utf8'), 'e2e/r5.spec.ts');
  assert.match(r.out, /E2E de R-5 ok \(1 spec\(s\) del RQ; antes de PROD: \$RQ verificar --completo\)/);
  assert.equal(cargarEstado(raiz, 'R-5').e2e.completo, false);
  r = await correr(raiz, ['verificar', '--completo'], env);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(raiz, 'e2e-args.txt'), 'utf8'), '');
  assert.equal(cargarEstado(raiz, 'R-5').e2e.completo, true);
});

test('subcomando mal invocado: muestra sólo su sintaxis (E6)', async () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const r = await correr(raiz, ['paso', 'hecho', 'push:x'], lin(''));
  assert.equal(r.code, 2);
  assert.ok(r.err.trim().split(/\r?\n/).length <= 6, r.err);
  assert.match(r.err, /paso hecho <paso> "<evidencia>"/);
});
