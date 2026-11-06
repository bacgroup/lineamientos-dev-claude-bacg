import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluarEdicion } from '../plugin/scripts/lib/compuerta-edicion.mjs';
import { guardarEstado, cargarEstado } from '../plugin/scripts/lib/estado.mjs';
import { cli } from '../plugin/scripts/lib/cli.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const proyecto = { ui: { patrones: ['src/components/**', 'src/pages/**', '**/*.css'] } };
const FRASE = 'Diseño y plan aprobados, dale';
const base = (extra = {}) => ({
  codigo: 'R-T1', tipo: 'rq', clasificacion: 'arquitectonico', etapa: 1,
  autonomia: null, aprobaciones: [], saltos: [], ...extra,
});
const ap = (etapa, frase) => ({ etapa, frase, fecha: '2026-10-23T12:00:00Z' });
const SKILLS = new Set(['design-taste-frontend', 'frontend-design:frontend-design']);

// Con estado, también docs/rq/<código>/spec.md (la etapa 1 lo exige); `spec: false` lo omite.
function repoConRq(estado, { activo = 'R-T1', spec = true } = {}) {
  const raiz = crearRepoTemporal({});
  if (estado) guardarEstado(raiz, estado);
  if (estado && spec) fs.writeFileSync(path.join(raiz, 'docs', 'rq', estado.codigo, 'spec.md'), '# x\n');
  if (activo) {
    fs.mkdirSync(path.join(raiz, 'docs', 'rq'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), `${activo}\n`);
  }
  return raiz;
}

const PROYECTO_UI = {
  ui: {
    patrones: ['src/components/**', 'src/pages/**'],
    skills: ['canon-x'],
    reglas: [{ patrones: ['src/pages/Landing*.tsx'], skills: ['design-taste-frontend', 'frontend-design:frontend-design'] }],
  },
};

const evaluar = (raiz, rel, ctx = {}, p = proyecto) =>
  evaluarEdicion({
    raiz, proyecto: p, rutaArchivo: path.join(raiz, rel),
    ctx: { skills: new Set(), ...ctx },
  });

test('archivo libre (docs) se edita sin RQ', () => {
  const raiz = repoConRq(null, { activo: null });
  assert.deepEqual(evaluar(raiz, 'README.md'), { decision: 'allow' });
});

test('I3b: estado.yml y ACTIVO nunca se editan a mano; relevo.md sí', () => {
  const raiz = repoConRq(base({ aprobaciones: [ap(1, FRASE)] }));
  for (const rel of ['docs/rq/R-T1/estado.yml', 'docs/rq/ACTIVO', 'docs/rq/OTRO/estado.yml']) {
    const r = evaluar(raiz, rel, { textosUsuario: [FRASE] });
    assert.equal(r.decision, 'deny', rel);
    assert.match(r.motivo, /^estado\.yml y ACTIVO sólo se cambian con rq\.mjs/);
  }
  assert.deepEqual(evaluar(raiz, 'docs/rq/R-T1/relevo.md'), { decision: 'allow' });
});

test('un test (src/lib/a.test.ts) se edita sin RQ', () => {
  const raiz = repoConRq(null, { activo: null });
  assert.deepEqual(evaluar(raiz, 'src/lib/a.test.ts'), { decision: 'allow' });
});

test('archivo fuera del repo -> allow', () => {
  const raiz = repoConRq(null, { activo: null });
  const fuera = path.join(path.dirname(raiz), 'otro', 'x.ts');
  const r = evaluarEdicion({ raiz, proyecto, rutaArchivo: fuera, ctx: { textosUsuario: [], skills: new Set() } });
  assert.deepEqual(r, { decision: 'allow' });
});

test('producto sin RQ activo -> deny con el mensaje exacto', () => {
  const raiz = repoConRq(null, { activo: null });
  const r = evaluar(raiz, 'src/lib/a.ts');
  assert.equal(r.decision, 'deny');
  assert.equal(
    r.motivo,
    `No hay RQ activo. Clasificá el pedido y abrilo con: ${cli()} abrir <código> --tipo rq|bug --clasificacion <...>`,
  );
});

test('RQ activo sin estado.yml o con estado inválido -> deny, sin lanzar', () => {
  const raiz = repoConRq(null, { activo: 'R-T1' });
  let r = evaluar(raiz, 'src/lib/a.ts');
  assert.equal(r.decision, 'deny');
  assert.equal(r.motivo, `ESTADO_INEXISTENTE: R-T1. Revisá docs/rq/ACTIVO o corré ${cli()} abrir.`);
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', 'R-T1'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-T1', 'estado.yml'), '- lista\n- no objeto\n');
  r = evaluar(raiz, 'src/lib/a.ts');
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /^ESTADO_INVALIDO: R-T1: .*Revisá docs\/rq\/ACTIVO/);
});

test('etapa 1 no cumplida -> deny nombrando lo que falta', () => {
  const raiz = repoConRq(base());
  const r = evaluar(raiz, 'src/lib/a.ts');
  assert.equal(r.decision, 'deny');
  assert.equal(
    r.motivo,
    `Falta el diseño aprobado del RQ R-T1: docs/rq/R-T1/spec.md y la aprobación del usuario con ${cli()} aprobar 1 "<su frase>" (etapa 1, en toda clasificación).`,
  );
});

test('diseño aprobado -> allow, en cualquier sesión (la frase se validó al registrarla)', () => {
  const raiz = repoConRq(base({ aprobaciones: [ap(1, FRASE)] }));
  assert.deepEqual(evaluar(raiz, 'src/lib/a.ts'), { decision: 'allow' });
});

test('aprobar 1 sin docs/rq/<código>/spec.md -> deny con el mensaje del diseño', () => {
  for (const clasificacion of ['arquitectonico', 'bounded']) {
    const raiz = repoConRq(base({ clasificacion, aprobaciones: [ap(1, FRASE)] }), { spec: false });
    const r = evaluar(raiz, 'src/lib/a.ts');
    assert.equal(r.decision, 'deny', clasificacion);
    assert.equal(
      r.motivo,
      `Falta el diseño aprobado del RQ R-T1: docs/rq/R-T1/spec.md y la aprobación del usuario con ${cli()} aprobar 1 "<su frase>" (etapa 1, en toda clasificación).`,
    );
  }
});

test('bounded y spike: spec.md y autonomía no alcanzan, hace falta aprobar 1', () => {
  for (const clasificacion of ['bounded', 'spike']) {
    const raiz = repoConRq(base({ clasificacion }));
    fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-T1', 'spec.md'), 'x');
    const r = evaluar(raiz, 'src/lib/a.ts');
    assert.equal(r.decision, 'deny', clasificacion);
    assert.match(r.motivo, /^Falta el diseño aprobado del RQ R-T1/, clasificacion);
    guardarEstado(raiz, base({ clasificacion, aprobaciones: [ap(1, FRASE)] }));
    assert.deepEqual(evaluar(raiz, 'src/lib/a.ts'), { decision: 'allow' }, clasificacion);
  }
});

test('arquitectónico con autonomía registrada hasta la 4 y sin aprobar 1 -> deny', () => {
  const raiz = repoConRq(base({ autonomia: { hasta: 4, frase: 'Seguí solo', fecha: 'f' } }));
  assert.equal(evaluar(raiz, 'src/lib/a.ts').decision, 'deny');
  // Una aprobación de otra etapa tampoco es la del diseño.
  guardarEstado(raiz, base({ aprobaciones: [ap(2, FRASE), ap(4, FRASE)] }));
  assert.equal(evaluar(raiz, 'src/lib/a.ts').decision, 'deny');
});

test('RQ abierto con 3.x: el plan aprobado (aprobar 2) vale como diseño; bounded y spike conservan el diseño por spec.md', () => {
  const v3 = (yml, { spec = true } = {}) => {
    const raiz = repoConRq(null);
    fs.mkdirSync(path.join(raiz, 'docs', 'rq', 'R-T1'), { recursive: true });
    if (spec) fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-T1', 'spec.md'), 'x');
    fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-T1', 'estado.yml'), `codigo: R-T1\ntipo: rq\n${yml}`);
    return raiz;
  };
  const plan = v3('clasificacion: arquitectonico\netapa: 3\naprobaciones:\n  - { etapa: 2, frase: Plan ok, fecha: f }\n');
  assert.deepEqual(evaluar(plan, 'src/lib/a.ts'), { decision: 'allow' });
  assert.equal(evaluar(v3('clasificacion: arquitectonico\netapa: 3\naprobaciones: []\n'), 'src/lib/a.ts').decision, 'deny');
  for (const clasificacion of ['bounded', 'spike']) {
    const yml = `clasificacion: ${clasificacion}\netapa: 3\naprobaciones: []\n`;
    const acotado = v3(yml);
    assert.deepEqual(evaluar(acotado, 'src/lib/a.ts'), { decision: 'allow' }, `${clasificacion} recién convertido`);
    // Guardado y vuelto a leer (ya v4, sin _v3): sigue con su diseño.
    guardarEstado(acotado, cargarEstado(acotado, 'R-T1'));
    assert.equal(cargarEstado(acotado, 'R-T1')._v3, undefined);
    assert.deepEqual(evaluar(acotado, 'src/lib/a.ts'), { decision: 'allow' }, `${clasificacion} tras guardar`);
    assert.equal(evaluar(v3(yml, { spec: false }), 'src/lib/a.ts').decision, 'deny', `${clasificacion} sin spec.md`);
  }
});

test('salto de la compuerta edicion -> allow', () => {
  const raiz = repoConRq(base({ saltos: [{ compuerta: 'edicion', frase: 'Saltá la compuerta ahora' }] }));
  assert.deepEqual(evaluar(raiz, 'src/lib/a.ts'), { decision: 'allow' });
});

test('varios RQ activos: alcanza con que uno permita la edición', () => {
  const raiz = repoConRq(base(), { activo: null });
  guardarEstado(raiz, base({ codigo: 'R-T2', aprobaciones: [ap(1, FRASE)] }));
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-T2', 'spec.md'), '# x\n');
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-T2\nR-T1\n');
  assert.deepEqual(evaluar(raiz, 'src/lib/a.ts'), { decision: 'allow' });
});

/** Spec del RQ con la sección de diseño que exige el refuerzo de UI. */
const conSpecDiseno = (raiz, codigo = 'R-T1') => {
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', codigo), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', codigo, 'spec.md'), '# x\n## Diseño\nCanon: …\n');
  return raiz;
};
const DISENO = 'lineamientos-dev-claude-bacg:diseno-frontend';
const PISTA_MENOR = ' Si el cambio es menor, preguntale al usuario en el chat (texto, no botones) si omite el refuerzo; con su respuesta: $RQ saltar ui "<su frase>" "<motivo>".';

test('UI: diseno-frontend siempre y, encima, las skills de la regla que cubre el archivo (ui.reglas, si no ui.skills)', () => {
  const raiz = conSpecDiseno(repoConRq(base({ aprobaciones: [ap(1, FRASE)] })));
  let r = evaluar(raiz, 'src/components/Boton.tsx', {}, PROYECTO_UI);
  assert.equal(r.decision, 'deny');
  assert.equal(r.motivo, `Cambio de UI: cargá antes la skill diseno-frontend, canon-x (refuerzo de UI y canon del proyecto).${PISTA_MENOR}`);
  assert.deepEqual(evaluar(raiz, 'src/components/Boton.tsx', { skills: new Set([DISENO, 'plugin:canon-x']) }, PROYECTO_UI), { decision: 'allow' });
  r = evaluar(raiz, 'src/pages/Landing.tsx', { skills: new Set([DISENO, 'canon-x']) }, PROYECTO_UI);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /design-taste-frontend, frontend-design:frontend-design/);
  assert.deepEqual(evaluar(raiz, 'src/pages/Landing.tsx', { skills: new Set([DISENO, ...SKILLS]) }, PROYECTO_UI), { decision: 'allow' });
  // Un proyecto sin skills de UI declaradas pide igual el refuerzo (ui.skills suma, no reemplaza).
  r = evaluar(raiz, 'src/components/Boton.tsx');
  assert.equal(r.motivo, `Cambio de UI: cargá antes la skill diseno-frontend (refuerzo de UI y canon del proyecto).${PISTA_MENOR}`);
  assert.deepEqual(evaluar(raiz, 'src/components/Boton.tsx', { skills: new Set([DISENO]) }), { decision: 'allow' });
});

test('UI: las skills registradas en el RQ (estado.skills) valen para cualquier sesión o subagente', () => {
  const raiz = conSpecDiseno(repoConRq(base({ aprobaciones: [ap(1, FRASE)], skills: ['canon-x', DISENO] })));
  assert.deepEqual(evaluar(raiz, 'src/components/Boton.tsx', {}, PROYECTO_UI), { decision: 'allow' });
});

test('UI con etapa 1 incumplida falla por la etapa, no por las skills', () => {
  const raiz = repoConRq(base());
  const r = evaluar(raiz, 'src/pages/Home.tsx', { skills: SKILLS }, PROYECTO_UI);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /^Falta el diseño/);
});
