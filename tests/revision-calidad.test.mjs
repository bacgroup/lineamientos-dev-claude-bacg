// PLG-DFF2 (premisa 3): revisión de calidad multi-pasada. El hook anota los subagentes de revisión (Agent con
// subagent_type de un plugin) como skills del RQ; con reglas 4.4, `revision ok` exige las pasadas de code-reviewer,
// pr-test-analyzer y revisor-rq. La revisión guarda el commit revisado y deja de valer si después entra código.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../plugin/scripts/rq.mjs';
import { cargarEstado, guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { faltaParaEtapa, PASADAS_REVISION } from '../plugin/scripts/lib/requisitos.mjs';
import { handler as postTool } from '../plugin/scripts/lib/hooks/post-tool.mjs';
import { crearRepoTemporal, sesionDePrueba, lineamientos44 } from './helpers.mjs';

const DIR_LIN = lineamientos44();
const SESION = sesionDePrueba();
const git = (raiz, ...a) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8' });

async function correr(cwd, args) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    home: SESION.home,
    env: { ...process.env, ...SESION.env, BACG_LINEAMIENTOS_DIR: DIR_LIN, BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_PREVIA: '1' },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

const PROCESO = ['superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:test-driven-development', 'superpowers:executing-plans', 'superpowers:requesting-code-review', 'superpowers:verification-before-completion'];

async function rqListoParaRevisar() {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', archivos: { 'docs/rq/R-1/spec.md': '# R-1\n\n## Diseño\nx\n\n## Tareas\n- una\n', 'src/a.ts': 'a\n' } });
  await correr(raiz, ['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  const e = cargarEstado(raiz, 'R-1');
  e.skills = PROCESO.map((skill) => ({ skill, etapa: 2 }));
  e.tests = { ok: true };
  guardarEstado(raiz, e);
  return raiz;
}

test('el hook anota el subagent_type de un plugin como pasada del RQ; un subagente genérico no', async () => {
  const raiz = await rqListoParaRevisar();
  await postTool({ cwd: raiz, session_id: 's', tool_name: 'Agent', tool_input: { subagent_type: 'pr-review-toolkit:code-reviewer', prompt: 'x' }, tool_response: {} }, { dirLin: DIR_LIN });
  await postTool({ cwd: raiz, session_id: 's', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'x' }, tool_response: {} }, { dirLin: DIR_LIN });
  await postTool({ cwd: raiz, session_id: 's', tool_name: 'Task', tool_input: { subagent_type: 'lineamientos-dev-claude-bacg:revisor-rq', prompt: 'x' }, tool_response: {} }, { dirLin: DIR_LIN });
  const nombres = cargarEstado(raiz, 'R-1').skills.map((s) => s.skill);
  assert.ok(nombres.includes('pr-review-toolkit:code-reviewer'));
  assert.ok(nombres.includes('lineamientos-dev-claude-bacg:revisor-rq'));
  assert.ok(!nombres.includes('Explore'));
});

test('la transcripción cuenta los subagentes de un plugin como skills (skills importar los anota aunque el hook no haya corrido)', async () => {
  const { leerTranscript } = await import('../plugin/scripts/lib/transcript.mjs');
  const s = sesionDePrueba();
  s.entrada({ type: 'assistant', message: { content: [
    { type: 'tool_use', name: 'Agent', input: { subagent_type: 'pr-review-toolkit:pr-test-analyzer', prompt: 'x' } },
    { type: 'tool_use', name: 'Agent', input: { subagent_type: 'general-purpose', prompt: 'x' } },
  ] } });
  const t = await leerTranscript(s.ruta);
  assert.ok(t.skills.has('pr-review-toolkit:pr-test-analyzer'));
  assert.ok(!t.skills.has('general-purpose'));
});

test('4.4: revision ok sin las pasadas falla y las nombra; con las pasadas guarda el commit revisado', async () => {
  const raiz = await rqListoParaRevisar();
  const sin = await correr(raiz, ['revision', 'ok', 'sin pasadas']);
  assert.notEqual(sin.code, 0);
  for (const p of PASADAS_REVISION) assert.match(sin.err, new RegExp(p.split(':').pop()));
  const e = cargarEstado(raiz, 'R-1');
  e.skills = [...e.skills, ...PASADAS_REVISION.map((skill) => ({ skill, etapa: 3 }))];
  guardarEstado(raiz, e);
  const con = await correr(raiz, ['revision', 'ok', 'tres pasadas']);
  assert.equal(con.code, 0, con.err);
  assert.equal(cargarEstado(raiz, 'R-1').revision.head, git(raiz, 'rev-parse', 'HEAD').trim());
});

test('4.4: una revisión bloqueante suma receiving-code-review a lo exigido', async () => {
  const raiz = await rqListoParaRevisar();
  assert.equal((await correr(raiz, ['revision', 'bloqueante', 'hallazgo importante'])).code, 0);
  assert.equal(cargarEstado(raiz, 'R-1').revisiones_bloqueantes, 1);
  assert.ok(faltaParaEtapa(cargarEstado(raiz, 'R-1'), 3, raiz).includes('superpowers:receiving-code-review'));
});

test('4.4: la revisión vence con un commit de código posterior; con uno de sólo docs sigue vigente', async () => {
  const raiz = await rqListoParaRevisar();
  const e = cargarEstado(raiz, 'R-1');
  e.skills = [...e.skills, ...PASADAS_REVISION.map((skill) => ({ skill, etapa: 3 }))];
  guardarEstado(raiz, e);
  assert.equal((await correr(raiz, ['revision', 'ok', 'revisado'])).code, 0);
  const revision = /la revisión/;
  assert.ok(!faltaParaEtapa(cargarEstado(raiz, 'R-1'), 5, raiz).some((x) => revision.test(x)));
  fs.writeFileSync(path.join(raiz, 'docs', 'nota.md'), 'x\n');
  git(raiz, 'add', 'docs/nota.md');
  git(raiz, 'commit', '-q', '-m', 'docs');
  assert.ok(!faltaParaEtapa(cargarEstado(raiz, 'R-1'), 5, raiz).some((x) => revision.test(x)));
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'b\n');
  git(raiz, 'add', 'src/a.ts');
  git(raiz, 'commit', '-q', '-m', 'código');
  assert.ok(faltaParaEtapa(cargarEstado(raiz, 'R-1'), 5, raiz).some((x) => /la revisión.*(vencida|commits)/.test(x)));
});
