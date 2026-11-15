import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from '../plugin/scripts/vendor/js-yaml.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leerJson = (ruta) => JSON.parse(readFileSync(join(raiz, ruta), 'utf8'));

test('marketplace.json declara el plugin lineamientos-dev-claude-bacg', () => {
  const m = leerJson('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'lineamientos-dev-claude-bacg');
  const p = m.plugins.find((x) => x.name === 'lineamientos-dev-claude-bacg');
  assert.ok(p, 'falta el plugin lineamientos-dev-claude-bacg');
  assert.equal(p.source, './plugin');
});

test('plugin.json tiene nombre y versión semver', () => {
  const p = leerJson('plugin/.claude-plugin/plugin.json');
  assert.equal(p.name, 'lineamientos-dev-claude-bacg');
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
});

test('js-yaml vendorizado carga y vuelca YAML', () => {
  assert.equal(yaml.load('a: 1').a, 1);
  assert.equal(yaml.dump({ b: 2 }), 'b: 2\n');
});

// Cowork rechaza el paquete si una descripción trae algo con forma de etiqueta XML
// ("SKILL.md description cannot contain XML tags"): usar {id} en vez de <id>.
const frontmatter = (ruta) => {
  const m = readFileSync(join(raiz, ruta), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, `${ruta} no tiene frontmatter`);
  // Línea a línea y no con yaml.load: algunos comandos traen ": " dentro del valor
  // sin comillas y Claude Code los acepta igual.
  const d = m[1].match(/^description:\s*(.*)$/m);
  return { description: d ? d[1].replace(/^(['"])(.*)\1$/, '$2') : undefined };
};

test('descripciones de skills, comandos y manifiestos sin etiquetas XML', () => {
  const etiqueta = /<[^<>\n]*>/;
  const casos = [
    ...readdirSync(join(raiz, 'plugin/skills')).map((s) => [`plugin/skills/${s}/SKILL.md`, frontmatter(`plugin/skills/${s}/SKILL.md`).description]),
    ...readdirSync(join(raiz, 'plugin/commands')).filter((c) => c.endsWith('.md'))
      .map((c) => [`plugin/commands/${c}`, frontmatter(`plugin/commands/${c}`).description]),
    ['plugin/.claude-plugin/plugin.json', leerJson('plugin/.claude-plugin/plugin.json').description],
    ...leerJson('.claude-plugin/marketplace.json').plugins.map((p) => [`marketplace.json (${p.name})`, p.description]),
  ];
  for (const [ruta, desc] of casos) {
    if (ruta.includes('/skills/')) assert.ok(desc, `${ruta} sin description`);
    if (desc) assert.doesNotMatch(String(desc), etiqueta, `${ruta}: la description tiene una etiqueta XML (usar {x} en vez de <x>)`);
  }
});
