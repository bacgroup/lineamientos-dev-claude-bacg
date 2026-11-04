import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
