// PLG-PRREV: workflow del revisor independiente (claude-code-action) renderizado por repo con sus ramas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from '../plugin/scripts/vendor/js-yaml.mjs';
import { renderRevisor, instalarRevisor, RUTA_WORKFLOW } from '../plugin/scripts/lib/revisor-pr.mjs';

const POWERFY = { ramas_solo_pr: ['18.0-dev'], ramas_prod: ['18.0'], agentes_externos: { autores: ['gpt-engineer-app[bot]'] } };

test('PLG-PRREV: el workflow corre en PR y push a las ramas de DEV y PROD del repo', () => {
  const wf = yaml.load(renderRevisor({ proyecto: POWERFY, entradaRepo: {} }).texto);
  assert.deepEqual(wf.on.pull_request.branches, ['18.0-dev', '18.0']);
  assert.deepEqual(wf.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review']);
  assert.deepEqual(wf.on.push.branches, ['18.0-dev', '18.0']);
  const job = wf.jobs.revisar;
  assert.match(job.if, /pull_request/);
  assert.match(job.if, /gpt-engineer-app\[bot\]/, 'el push sólo se revisa si el autor es un agente externo');
  const accion = job.steps.find((s) => String(s.uses).startsWith('anthropics/claude-code-action@v1'));
  assert.ok(accion, 'usa claude-code-action@v1');
  assert.match(accion.with.prompt, /\/lineamientos-dev-claude-bacg:revision-pr/);
  assert.match(accion.with.plugins, /lineamientos-dev-claude-bacg@lineamientos-dev-claude-bacg/);
  assert.match(accion.with.claude_args, /--max-turns 30/);
  assert.ok(wf.concurrency, 'acota el costo con concurrency');
  assert.deepEqual(wf.permissions, { contents: 'read', 'pull-requests': 'write', issues: 'read', 'id-token': 'write' });
  const final = job.steps.at(-1);
  assert.match(final.run, /jq -e '\.criticos == 0' bacg-revision\.json/);
  assert.match(final.run, /-f bacg-revision\.json/, 'si el archivo falta, el paso final no pone rojo por eso');
});

test('PLG-PRREV: el workflow no lleva ninguna clave, sólo el secret', () => {
  const { texto } = renderRevisor({ proyecto: POWERFY, entradaRepo: {} });
  assert.doesNotMatch(texto, /sk-ant-/);
  assert.match(texto, /\$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.match(texto, /CLAUDE_CODE_OAUTH_TOKEN/, 'la alternativa queda comentada');
});

test('PLG-PRREV: sin agentes externos no hay disparador de push; sin ramas declaradas usa la rama por defecto y lo avisa', () => {
  const r = renderRevisor({ proyecto: { ramas_prod: ['main'] }, entradaRepo: {} });
  assert.equal(yaml.load(r.texto).on.push, undefined);
  const s = renderRevisor({ proyecto: {}, entradaRepo: {}, ramaDefecto: 'master' });
  assert.deepEqual(yaml.load(s.texto).on.pull_request.branches, ['master']);
  assert.match(s.avisos.join(' '), /rama por defecto/);
});

test('PLG-PRREV: instalarRevisor escribe el workflow y no pisa uno modificado a mano sin forzar', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-rev-'));
  const r1 = instalarRevisor({ raiz, proyecto: POWERFY, entradaRepo: {} });
  assert.equal(r1.creado, true);
  const ruta = path.join(raiz, RUTA_WORKFLOW);
  assert.ok(fs.existsSync(ruta));
  assert.equal(instalarRevisor({ raiz, proyecto: POWERFY, entradaRepo: {} }).creado, false, 'igual: no reescribe');
  fs.appendFileSync(ruta, '# cambio a mano\n');
  const r2 = instalarRevisor({ raiz, proyecto: POWERFY, entradaRepo: {} });
  assert.equal(r2.creado, false);
  assert.match(r2.motivo, /--forzar/);
  assert.match(fs.readFileSync(ruta, 'utf8'), /# cambio a mano/);
  assert.equal(instalarRevisor({ raiz, proyecto: POWERFY, entradaRepo: {}, forzar: true }).creado, true);
  assert.doesNotMatch(fs.readFileSync(ruta, 'utf8'), /# cambio a mano/);
});

test('PLG-PRREV: rq.mjs revisor-pr instala el workflow en el repo con las ramas del proyecto', async () => {
  const { main } = await import('../plugin/scripts/rq.mjs');
  const { crearRepoTemporal } = await import('./helpers.mjs');
  const raiz = crearRepoTemporal({
    nombre: 'app-x',
    archivos: { '.bacg-dev/proyecto.yml': 'id: px\nnombre: X\nramas_solo_pr: ["dev"]\nramas_prod: ["main"]\nrepos:\n  - { nombre: app-x }\n' },
  });
  let out = ''; let err = '';
  const io = { cwd: raiz, env: { ...process.env }, stdout: { write: (x) => { out += x; } }, stderr: { write: (x) => { err += x; } } };
  assert.equal(await main(['revisor-pr'], io), 0, err);
  const wf = yaml.load(fs.readFileSync(path.join(raiz, RUTA_WORKFLOW), 'utf8'));
  assert.deepEqual(wf.on.pull_request.branches, ['dev', 'main']);
  assert.match(out, /ANTHROPIC_API_KEY/, 'recuerda cargar el secret');
  assert.match(out, /protecci[oó]n de (la )?rama/i, 'recuerda la protección de rama');
  out = '';
  assert.equal(await main(['revisor-pr'], io), 0, err);
  assert.match(out, /al día/);
});
