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

// ---------- PLG-MOCK: el mockup se pregunta en cambios técnicos o chicos ----------

function conSalto(raiz, compuerta, frase = 'no hace falta mockup') {
  const p = path.join(raiz, 'docs', 'rq', 'R-1', 'estado.yml');
  const antes = fs.readFileSync(p, 'utf8');
  assert.match(antes, /saltos: \[\]/, 'el estado de prueba tiene que traer saltos: []');
  fs.writeFileSync(p, antes.replace(/saltos: \[\]/, `saltos:\n  - compuerta: ${compuerta}\n    frase: ${frase}\n    motivo: cambio técnico\n    fecha: '2026-11-19T00:00:00Z'`));
  return raiz;
}

test('PLG-MOCK: faltasDisenoUi con sinMockup no pide ### Mockups y sigue pidiendo lo demás', () => {
  const sinNada = repo('# R-1\n\n## Diseño\nalgo\n', { mockup: false });
  const falta = faltasDisenoUi(sinNada, 'R-1', { sinMockup: true }).join(' ');
  assert.doesNotMatch(falta, /Mockups/);
  assert.match(falta, /Journey/);
  assert.match(falta, /Referencias le/);
  assert.match(falta, /Paridad/);
  assert.deepEqual(faltasDisenoUi(repo(DISENO_COMPLETO, { mockup: false }), 'R-1', { sinMockup: true }), []);
});

test('PLG-MOCK: con saltar mockup la compuerta deja editar UI sin mockup; sin journey, sigue negando', () => {
  const ctx = { textosUsuario: [], skills: SKILLS_UI, skillsContexto: SKILLS_UI };
  const sinMockup = conSalto(repo(DISENO_COMPLETO, { mockup: false }), 'mockup');
  assert.equal(editar(sinMockup, ctx).decision, 'allow');
  const sinJourney = conSalto(repo(DISENO_COMPLETO.replace(/### Journey[\s\S]*?### Mockups/, '### Mockups'), { mockup: false }), 'mockup');
  const r = editar(sinJourney, ctx);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /Journey/);
  assert.doesNotMatch(r.motivo, /### Mockups/);
});

test('PLG-MOCK: sin el salto, el aviso por falta de mockup ofrece preguntar si hace falta (saltar mockup)', () => {
  const ctx = { textosUsuario: [], skills: SKILLS_UI, skillsContexto: SKILLS_UI };
  const r = editar(repo(DISENO_COMPLETO, { mockup: false }), ctx);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /\$RQ saltar mockup "<su frase>" "<motivo>"/);
  assert.match(r.motivo, /saltar ui/, 'la pista de cambio menor sigue');
  const conMockupYSinParidad = editar(repo(DISENO_COMPLETO.replace(/### Paridad[\s\S]*$/, '')), ctx);
  assert.doesNotMatch(conMockupYSinParidad.motivo, /saltar mockup/, 'la pista sólo aparece cuando falta el mockup');
});

test('PLG-MOCK: rq.mjs saltar acepta la compuerta mockup sólo con frase del usuario', async () => {
  const raiz = repo(DISENO_COMPLETO, { mockup: false });
  fs.writeFileSync(path.join(raiz, '.bacg-lineamientos'), 'proyecto: erp\n');
  const sesion = sesionDePrueba('no, el mockup no hace falta');
  const correr = async (frase) => {
    let out = ''; let err = '';
    const code = await main(['saltar', 'mockup', frase, 'cambio técnico'], {
      cwd: raiz, env: { ...process.env, ...sesion.env }, home: sesion.home,
      stdout: { write: (x) => { out += x; } }, stderr: { write: (x) => { err += x; } },
    });
    return { code, out, err };
  };
  const mala = await correr('el agente decide que no');
  assert.notEqual(mala.code, 0);
  const buena = await correr('no, el mockup no hace falta');
  assert.equal(buena.code, 0, buena.err);
  assert.match(buena.out, /Salto de la compuerta mockup registrado/);
  const ctx = { textosUsuario: [], skills: SKILLS_UI, skillsContexto: SKILLS_UI };
  assert.equal(editar(raiz, ctx).decision, 'allow', 'lo que guarda la CLI es lo que lee la compuerta');
});

test('PLG-MOCK: el salto mockup no apaga el resto del refuerzo de UI (skill de diseño ni ## Diseño sin reglas 4.4)', () => {
  const sinSkill = conSalto(repo(DISENO_COMPLETO, { mockup: false }), 'mockup');
  const r = editar(sinSkill, { textosUsuario: [], skills: new Set(), skillsContexto: new Set() });
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /diseno-frontend/);
  const viejo = conSalto(repo('# R-1\n\nsin diseño\n', { mockup: false, reglas: null }), 'mockup');
  const r43 = editar(viejo, { textosUsuario: [], skills: SKILLS_UI });
  assert.equal(r43.decision, 'deny');
  assert.match(r43.motivo, /## Diseño/);
});

test('PLG-MOCK: el salto mockup de otro RQ activo no cubre a éste', () => {
  const raiz = repo(DISENO_COMPLETO, { mockup: false });
  guardarEstado(raiz, {
    codigo: 'R-2', tipo: 'rq', clasificacion: 'bounded', etapa: 1, reglas: 44,
    aprobaciones: [{ etapa: 1, frase: 'apruebo el diseño', fecha: '2026-11-15T00:00:00Z' }],
    saltos: [{ compuerta: 'mockup', frase: 'no hace falta mockup', motivo: 'técnico', fecha: '2026-11-19T00:00:00Z' }],
  });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-2', 'spec.md'), '# R-2\n\n## Diseño\nalgo\n');
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-1\nR-2\n');
  // R-2 no cumple (sin journey) y el salto de R-2 no le sirve a R-1, que sigue sin mockup: ninguno deja pasar.
  const r = editar(raiz, { textosUsuario: [], skills: SKILLS_UI, skillsContexto: SKILLS_UI });
  assert.equal(r.decision, 'deny', 'el salto de R-2 no puede habilitar a R-1');
});
