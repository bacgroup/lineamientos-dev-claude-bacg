// PLG-DFF2 (premisa 4, cambios 1 y 2, P-4): con reglas 4.4, editar UI exige en ## Diseño el journey, el mockup, las
// referencias leídas y la paridad; las skills de UI valen sólo en el contexto en curso (una compactación las vence); y
// `verificar --local` pide capturas a 390, 768 y 1280 y, si hay referencia, una ref-*.png.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluarEdicion } from '../plugin/scripts/lib/compuerta-edicion.mjs';
import { guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { faltasDisenoUi, refExigida } from '../plugin/scripts/lib/diseno-ui.mjs';
import { leerTranscript } from '../plugin/scripts/lib/transcript.mjs';
import { main } from '../plugin/scripts/rq.mjs';
import { crearRepoTemporal, sesionDePrueba, lineamientos44 } from './helpers.mjs';

const proyecto = { ui: { patrones: ['src/components/**'] } };
const SKILLS_UI = new Set(['lineamientos-dev-claude-bacg:diseno-frontend']);

const DISENO_COMPLETO = `# R-1

## Diseño
### Journey
1. El staff abre la suscripción
2. Elige qué cambiar
3. Confirma y ve el resumen

### Mockups
- docs/rq/R-1/mockups/journey.html

### Referencias leídas
- src/components/Viejo.tsx (entero)

### Paridad
| V1 | nuevo | cómo |
|---|---|---|
| Fecha inicio | Fecha inicio | reusa |
`;

function repo(spec, { mockup = true, reglas = 44 } = {}) {
  const raiz = crearRepoTemporal({});
  guardarEstado(raiz, {
    codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', etapa: 1, reglas,
    aprobaciones: [{ etapa: 1, frase: 'apruebo el diseño', fecha: '2026-11-15T00:00:00Z' }], saltos: [],
  });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'spec.md'), spec);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-1\n');
  if (mockup) {
    fs.mkdirSync(path.join(raiz, 'docs', 'rq', 'R-1', 'mockups'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'mockups', 'journey.html'), '<html></html>');
  }
  return raiz;
}

const editar = (raiz, ctx) => evaluarEdicion({ raiz, proyecto, rutaArchivo: path.join(raiz, 'src', 'components', 'Nuevo.tsx'), ctx });

test('faltasDisenoUi: journey de 3 pasos, mockup (archivo o Figma), referencias y paridad', () => {
  assert.deepEqual(faltasDisenoUi(repo(DISENO_COMPLETO), 'R-1'), []);
  const sinMockup = repo(DISENO_COMPLETO, { mockup: false });
  assert.match(faltasDisenoUi(sinMockup, 'R-1').join(' '), /Mockups/);
  const conFigma = repo(DISENO_COMPLETO.replace('- docs/rq/R-1/mockups/journey.html', '- https://www.figma.com/design/abc/flujo'), { mockup: false });
  assert.deepEqual(faltasDisenoUi(conFigma, 'R-1'), []);
  const corto = repo(DISENO_COMPLETO.replace('3. Confirma y ve el resumen\n', ''));
  assert.match(faltasDisenoUi(corto, 'R-1').join(' '), /Journey/);
  const sinParidad = repo(DISENO_COMPLETO.replace(/### Paridad[\s\S]*$/, ''));
  assert.match(faltasDisenoUi(sinParidad, 'R-1').join(' '), /Paridad/);
});

test('faltasDisenoUi: las subsecciones cuentan sólo dentro de ## Diseño', () => {
  const fuera = `# R-1\n\n## Notas\n${DISENO_COMPLETO.replace('# R-1\n\n## Diseño\n', '')}\n## Diseño\nalgo\n`;
  assert.ok(faltasDisenoUi(repo(fuera), 'R-1').length >= 3);
});

test('4.4: editar UI sin journey o sin mockup se niega con lo que falta; completo, pasa', () => {
  const ctx = { textosUsuario: [], skills: SKILLS_UI, skillsContexto: SKILLS_UI };
  const r = editar(repo('# R-1\n\n## Diseño\nalgo\n', { mockup: false }), ctx);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /Journey/);
  assert.match(r.motivo, /Mockups/);
  assert.equal(editar(repo(DISENO_COMPLETO), ctx).decision, 'allow');
});

test('sin reglas 4.4: alcanza con ## Diseño, como antes', () => {
  const ctx = { textosUsuario: [], skills: SKILLS_UI };
  const r = editar(repo('# R-1\n\n## Diseño\nalgo\n', { mockup: false, reglas: null }), ctx);
  assert.equal(r.decision, 'allow', r.motivo);
});

test('P-4: con reglas 4.4 la skill de UI vale sólo si se cargó después de la última compactación', () => {
  const raiz = repo(DISENO_COMPLETO);
  // Registrada en el RQ y en la sesión, pero no en el contexto en curso: se niega.
  const viejo = editar(raiz, { textosUsuario: [], skills: SKILLS_UI, skillsContexto: new Set() });
  assert.equal(viejo.decision, 'deny');
  assert.match(viejo.motivo, /diseno-frontend/);
  assert.match(viejo.motivo, /compact/i);
  // Primera pasada del hook (sin transcript): se niega para que lea el transcript.
  assert.equal(editar(raiz, { textosUsuario: [], skills: new Set() }).decision, 'deny');
});

test('leerTranscript: skillsContexto se vacía en cada compactación', async () => {
  const s = sesionDePrueba();
  const skill = (n) => s.entrada({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: n } }] } });
  skill('lineamientos-dev-claude-bacg:diseno-frontend');
  s.entrada({ type: 'system', subtype: 'compact_boundary' });
  skill('superpowers:brainstorming');
  const t = await leerTranscript(s.ruta);
  assert.ok(t.skills.has('lineamientos-dev-claude-bacg:diseno-frontend'));
  assert.ok(!t.skillsContexto.has('lineamientos-dev-claude-bacg:diseno-frontend'));
  assert.ok(t.skillsContexto.has('superpowers:brainstorming'));
  s.entrada({ type: 'user', isCompactSummary: true, message: { content: 'resumen' } });
  assert.equal((await leerTranscript(s.ruta)).skillsContexto.size, 0);
});

test('refExigida: sí con referencias leídas; no con "no aplica"', () => {
  assert.equal(refExigida(repo(DISENO_COMPLETO), 'R-1'), true);
  assert.equal(refExigida(repo(DISENO_COMPLETO.replace('- src/components/Viejo.tsx (entero)', 'No aplica — pantalla nueva')), 'R-1'), false);
});

test('4.4: verificar --local de un RQ con UI pide 390, 768 y 1280 y la captura de referencia', async () => {
  const s = sesionDePrueba();
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  const correr = async (args) => {
    let err = '';
    const code = await main(args, {
      cwd: raiz, home: s.home,
      env: { ...process.env, ...s.env, BACG_LINEAMIENTOS_DIR: lineamientos44(), BACG_DEV_SIN_GH: '1', BACG_DEV_SIN_ALTA: '1', BACG_DEV_SIN_PREVIA: '1' },
      stdout: { write() {} }, stderr: { write: (x) => { err += x; } },
    });
    return { code, err };
  };
  await correr(['abrir', 'R-1', '--tipo', 'rq', '--clasificacion', 'bounded']);
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'spec.md'), `## Toca: UI [x]\n${DISENO_COMPLETO}`);
  const qa = path.join(raiz, 'docs', 'rq', 'R-1', 'qa');
  fs.mkdirSync(qa, { recursive: true });
  for (const f of ['nuevo-390.png', 'nuevo-768.png', 'nuevo-1280.png', 'ref-1280.png']) fs.writeFileSync(path.join(qa, f), 'png');
  const rel = (f) => `docs/rq/R-1/qa/${f}`;
  const una = await correr(['verificar', '--local', 'recorrido con rol staff', rel('nuevo-1280.png')]);
  assert.notEqual(una.code, 0);
  assert.match(una.err, /390/);
  const sinRef = await correr(['verificar', '--local', 'recorrido con rol staff', rel('nuevo-390.png'), rel('nuevo-768.png'), rel('nuevo-1280.png')]);
  assert.notEqual(sinRef.code, 0);
  assert.match(sinRef.err, /ref-/);
  const ok = await correr(['verificar', '--local', 'recorrido con rol staff', rel('nuevo-390.png'), rel('nuevo-768.png'), rel('nuevo-1280.png'), rel('ref-1280.png')]);
  assert.equal(ok.code, 0, ok.err);
});

test('## Diseño: un bloque de código con # adentro no corta la sección; ##Tareas sin espacio sí', () => {
  const conCodigo = DISENO_COMPLETO.replace('### Paridad', '```bash\n# un comentario\n```\n\n### Paridad');
  assert.deepEqual(faltasDisenoUi(repo(conCodigo), 'R-1'), []);
  const sinEspacio = '# R-1\n\n## Diseño\nalgo\n\n##Tareas\n' + DISENO_COMPLETO.replace('# R-1\n\n## Diseño\n', '');
  assert.ok(faltasDisenoUi(repo(sinEspacio), 'R-1').length >= 3);
});
