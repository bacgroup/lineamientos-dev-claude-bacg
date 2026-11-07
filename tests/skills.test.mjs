import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from '../plugin/scripts/vendor/js-yaml.mjs';
import { NOMBRE_ETAPA } from '../plugin/scripts/lib/etapas.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirSkills = join(raiz, 'plugin', 'skills');
const dirComandos = join(raiz, 'plugin', 'commands');
const leer = (ruta) => readFileSync(ruta, 'utf8');

function frontmatter(texto) {
  const m = texto.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(m, 'falta el frontmatter entre ---');
  return { datos: yaml.load(m[1]), cuerpo: m[2] };
}

// Subcomandos reales de rq.mjs: la lista SUBS del dispatcher y las líneas del texto de uso.
function subcomandosRq() {
  const fuente = leer(join(raiz, 'plugin', 'scripts', 'rq.mjs'));
  const m = fuente.match(/const SUBS = \[([^\]]*)\]/);
  assert.ok(m, 'no encontré la lista SUBS en rq.mjs');
  const subs = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  const uso = fuente.match(/const USO = `([\s\S]*?)`;/);
  assert.ok(uso, 'no encontré el texto USO en rq.mjs');
  const conUso = new Set();
  for (const linea of uso[1].split('\n').slice(1)) {
    const sub = linea.trim().split(/\s+/)[0];
    if (sub) assert.ok(subs.has(sub), `el uso nombra "${sub}" pero no está en SUBS`);
    if (sub) conUso.add(sub);
  }
  for (const s of subs) assert.ok(conUso.has(s), `"${s}" está en SUBS pero el uso no lo explica`);
  return subs;
}

// Invocaciones de la CLI: "rq.mjs <sub>" o el atajo "$RQ <sub>" que define ciclo-rq.
const usados = (texto) =>
  new Set([...texto.matchAll(/(?:rq\.mjs"?|\$RQ)[ \t]+([a-z][a-z-]*)/g)].map((x) => x[1]));

const skills = () => readdirSync(dirSkills, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

test('existen las skills propias del plugin', () => {
  const s = skills();
  for (const n of ['ciclo-rq', 'decision-arq', 'diseno-frontend']) assert.ok(s.includes(n), `falta la skill ${n}`);
});

test('cada SKILL.md tiene frontmatter con name (igual a su carpeta) y description', () => {
  for (const n of skills()) {
    const { datos } = frontmatter(leer(join(dirSkills, n, 'SKILL.md')));
    assert.equal(datos?.name, n, `name de ${n}`);
    assert.equal(typeof datos?.description, 'string', `description de ${n}`);
    assert.ok(datos.description.trim().length > 20, `description de ${n} vacía`);
  }
});

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('ciclo-rq: description y las 7 etapas v4 con su nombre', () => {
  const { datos, cuerpo } = frontmatter(leer(join(dirSkills, 'ciclo-rq', 'SKILL.md')));
  assert.ok(
    datos.description.startsWith('Usar antes de cualquier cambio de código o base de datos en un repo con .bacg-lineamientos'),
    'description de ciclo-rq',
  );
  assert.deepEqual(Object.keys(NOMBRE_ETAPA).map(Number), [0, 1, 2, 3, 4, 5, 6]);
  for (const [e, nombre] of Object.entries(NOMBRE_ETAPA)) {
    assert.match(cuerpo, new RegExp(`^\\|\\s*${e}\\s*\\|\\s*${escapar(nombre)}\\s*\\|`, 'm'), `falta la fila de la etapa ${e} (${nombre})`);
  }
  assert.doesNotMatch(cuerpo, /^\|\s*7\s*\|/m, 'la etapa 7 es de 3.x');
});

test('ciclo-rq: nombra los subcomandos y compuertas nuevos de la v4', () => {
  const texto = leer(join(dirSkills, 'ciclo-rq', 'SKILL.md'));
  for (const s of ['$RQ arranque', '$RQ clasificacion confirmar', '$RQ clasificacion cambiar', '$RQ ejecucion inline|subagentes', '$RQ verificar --local']) {
    assert.ok(texto.includes(s), `ciclo-rq no explica ${s}`);
  }
  const fuente = leer(join(raiz, 'plugin', 'scripts', 'rq.mjs'));
  const compuertas = [...fuente.match(/const COMPUERTAS = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  for (const c of compuertas) assert.ok(texto.includes(`\`${c}\``), `ciclo-rq no nombra la compuerta ${c}`);
  for (const n of ['Exploración', 'Acotado', 'Arquitectónico']) assert.ok(texto.includes(n), `ciclo-rq no nombra ${n}`);
  assert.doesNotMatch(texto, /m[aá]s de 5 tareas independientes/, 'la ejecución ya no es una regla fija');
});

// Textos genéricos: sin supuestos de un proyecto puntual, salvo en líneas que empiezan con "Ejemplo".
test('ciclo-rq, proceso.md y los comandos no suponen un proyecto puntual', () => {
  const archivos = [
    join(dirSkills, 'ciclo-rq', 'SKILL.md'),
    join(raiz, 'plugin', 'general', 'proceso.md'),
    ...readdirSync(dirComandos).filter((f) => f.endsWith('.md')).map((f) => join(dirComandos, f)),
  ];
  for (const archivo of archivos) {
    leer(archivo).split(/\r?\n/).forEach((linea, i) => {
      if (/^\s*Ejemplo/.test(linea)) return;
      assert.doesNotMatch(linea, /PowerFy|18\.0-dev|8069|8070/i, `${archivo}:${i + 1} nombra un proyecto puntual`);
    });
  }
});

test('ciclo-rq: sólo usa subcomandos de rq.mjs que existen, y usa todos', () => {
  const reales = subcomandosRq();
  const texto = leer(join(dirSkills, 'ciclo-rq', 'SKILL.md'));
  const u = usados(texto);
  for (const s of ['arranque', 'clasificacion', 'ejecucion']) assert.ok(reales.has(s), `rq.mjs no tiene ${s} en SUBS`);
  for (const s of u) assert.ok(reales.has(s), `ciclo-rq usa "rq.mjs ${s}", que no existe`);
  for (const s of reales) assert.ok(u.has(s), `ciclo-rq no explica "rq.mjs ${s}"`);
  assert.match(texto, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/rq\.mjs/);
});

test('ciclo-rq: nombra las skills obligatorias de cada etapa', () => {
  const texto = leer(join(dirSkills, 'ciclo-rq', 'SKILL.md'));
  for (const s of [
    'superpowers:brainstorming',
    'superpowers:writing-plans',
    'superpowers:test-driven-development',
    'superpowers:executing-plans',
    'superpowers:subagent-driven-development',
    'superpowers:verification-before-completion',
    'superpowers:requesting-code-review',
    'feature-dev:code-architect',
    'security-guidance',
    'pr-review-toolkit',
    'claude-security',
    'claude-md-management',
    'lineamientos-dev-claude-bacg:diseno-frontend',
    'lineamientos-dev-claude-bacg:design-taste-frontend',
    'lineamientos-dev-claude-bacg:redesign-existing-projects',
    'lineamientos-dev-claude-bacg:decision-arq',
    'superpowers:systematic-debugging',
    'pr-review-toolkit:silent-failure-hunter',
    'supabase-postgres-best-practices',
    'engineering:system-design',
  ]) {
    assert.ok(texto.includes(s), `ciclo-rq no nombra ${s}`);
  }
});

test('ciclo-rq: invocación exacta de lo que no es una Skill', () => {
  const texto = leer(join(dirSkills, 'ciclo-rq', 'SKILL.md'));
  for (const s of [
    'subagent_type "feature-dev:code-architect"',
    '/pr-review-toolkit:review-pr',
    'subagent_type "pr-review-toolkit:code-reviewer"',
    'Skill "claude-security:claude-security"',
    'Skill "claude-md-management:claude-md-improver"',
    '/revise-claude-md',
  ]) {
    assert.ok(texto.includes(s), `ciclo-rq no dice ${s}`);
  }
  assert.match(texto, /`security-guidance`[^\n]*hooks/, 'security-guidance actúa sola por hooks');
});

test('ciclo-rq: precisión de compuertas y ruta del CLI', () => {
  const texto = leer(join(dirSkills, 'ciclo-rq', 'SKILL.md'));
  assert.ok(texto.includes('push_prod: false'), 'PROD salvo push_prod: false explícito');
  for (const s of ['docs/**', 'tests/**', 'e2e/**', '*.test.*', '*.spec.*', '.bacg-lineamientos']) {
    assert.ok(texto.includes(s), `commits libres: falta ${s}`);
  }
  assert.match(texto, /`apply_migration`[^\n]*siempre/, 'apply_migration a PROD siempre exige la etapa 5');
  assert.ok(texto.includes('CLI del RQ'), 'ciclo-rq no manda a usar la ruta de SessionStart');
  for (const c of ['bacg-rq', 'bacg-estado']) {
    assert.ok(leer(join(dirComandos, `${c}.md`)).includes('CLI del RQ'), `/${c} no usa la ruta de SessionStart`);
  }
});

test('decision-arq: cuándo, formato, destino y manage_adr', () => {
  const texto = leer(join(dirSkills, 'decision-arq', 'SKILL.md'));
  for (const s of ['Contexto', 'Opciones', 'Decisión', 'Consecuencias', 'Estado', 'proyectos/<id>/adr/NNNN-<slug>.md', 'manage_adr']) {
    assert.ok(texto.includes(s), `decision-arq no menciona ${s}`);
  }
});

test('diseno-frontend: orquesta las skills de diseño con la precedencia', () => {
  const texto = leer(join(dirSkills, 'diseno-frontend', 'SKILL.md'));
  for (const s of ['design-taste-frontend', 'frontend-design:frontend-design', 'redesign-existing-projects', 'canon > skill > código vecino']) {
    assert.ok(texto.includes(s), `diseno-frontend no menciona ${s}`);
  }
});

test('skills vendorizadas: FUENTE.md con URL, licencia y commit, y la licencia al lado', () => {
  for (const n of ['design-taste-frontend', 'redesign-existing-projects']) {
    const dir = join(dirSkills, n);
    assert.ok(existsSync(join(dir, 'SKILL.md')), `falta ${n}/SKILL.md`);
    const fuente = leer(join(dir, 'FUENTE.md'));
    assert.match(fuente, /https:\/\/github\.com\/Leonxlnx\/taste-skill/);
    assert.match(fuente, /MIT/);
    assert.match(fuente, /[0-9a-f]{40}/, `FUENTE.md de ${n} sin commit`);
    assert.match(leer(join(dir, 'LICENSE')), /MIT License/);
  }
});

test('comandos /bacg-rq y /bacg-estado: description, invocan ciclo-rq y usan subcomandos reales', () => {
  const reales = subcomandosRq();
  for (const c of ['bacg-rq', 'bacg-estado']) {
    const texto = leer(join(dirComandos, `${c}.md`));
    const { datos, cuerpo } = frontmatter(texto);
    assert.equal(typeof datos?.description, 'string', `description de /${c}`);
    assert.ok(cuerpo.includes('lineamientos-dev-claude-bacg:ciclo-rq'), `/${c} no invoca ciclo-rq`);
    assert.ok(usados(cuerpo).has('estado'), `/${c} no corre rq.mjs estado`);
    for (const s of usados(cuerpo)) assert.ok(reales.has(s), `/${c} usa "rq.mjs ${s}", que no existe`);
  }
});
