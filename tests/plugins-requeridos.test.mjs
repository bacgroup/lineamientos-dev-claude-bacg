// PLG-DEPS: lista única de plugins requeridos (núcleo y por stack), faltantes y comandos para instalarlos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PLUGINS_NUCLEO, PLUGINS_TODOS, pluginsRequeridos, faltantesRequeridos, comandosInstalar,
} from '../plugin/scripts/lib/plugins-requeridos.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function homeCon(ids) {
  const home = tmp('home-req-');
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  const datos = { version: 2, plugins: Object.fromEntries(ids.map((p) => [p, [{ scope: 'user' }]])) };
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify(datos));
  return home;
}

test('PLG-DEPS: el núcleo son los 6 plugins de todo proyecto', () => {
  assert.deepEqual(PLUGINS_NUCLEO, [
    'superpowers@superpowers-marketplace',
    'pr-review-toolkit@claude-plugins-official',
    'security-guidance@claude-plugins-official',
    'claude-security@claude-plugins-official',
    'feature-dev@claude-plugins-official',
    'claude-md-management@claude-plugins-official',
  ]);
  assert.ok(PLUGINS_TODOS.includes('frontend-design@claude-plugins-official'));
  assert.ok(PLUGINS_TODOS.includes('typescript-lsp@claude-plugins-official'));
});

test('PLG-DEPS: un proyecto Odoo sin UI web ni TypeScript no exige frontend-design ni typescript-lsp (PLG-REQ)', () => {
  const raiz = tmp('repo-odoo-');
  fs.writeFileSync(path.join(raiz, '__manifest__.py'), '{}');
  assert.deepEqual(pluginsRequeridos({ raiz, proyecto: { ui: { patrones: [] } } }), PLUGINS_NUCLEO);
  assert.deepEqual(pluginsRequeridos({ raiz: null, proyecto: null }), PLUGINS_NUCLEO);
});

test('PLG-DEPS: ui.patrones exige frontend-design; tsconfig o typescript en package.json exigen typescript-lsp', () => {
  const conUi = tmp('repo-ui-');
  assert.ok(pluginsRequeridos({ raiz: conUi, proyecto: { ui: { patrones: ['src/**'] } } }).includes('frontend-design@claude-plugins-official'));
  const conTs = tmp('repo-ts-');
  fs.writeFileSync(path.join(conTs, 'tsconfig.json'), '{}');
  assert.ok(pluginsRequeridos({ raiz: conTs, proyecto: {} }).includes('typescript-lsp@claude-plugins-official'));
  const conPkg = tmp('repo-pkg-');
  fs.writeFileSync(path.join(conPkg, 'package.json'), JSON.stringify({ devDependencies: { typescript: '^5' } }));
  assert.ok(pluginsRequeridos({ raiz: conPkg, proyecto: {} }).includes('typescript-lsp@claude-plugins-official'));
  const pkgRoto = tmp('repo-pkg-roto-');
  fs.writeFileSync(path.join(pkgRoto, 'package.json'), '{ no es json');
  assert.ok(!pluginsRequeridos({ raiz: pkgRoto, proyecto: {} }).includes('typescript-lsp@claude-plugins-official'));
});

test('PLG-DEPS: faltantesRequeridos da null si no se puede leer lo instalado y la lista si se puede', () => {
  assert.equal(faltantesRequeridos({ raiz: null, proyecto: null, env: {}, home: tmp('home-vacio-') }), null);
  const home = homeCon(PLUGINS_NUCLEO.slice(1));
  assert.deepEqual(faltantesRequeridos({ raiz: null, proyecto: null, env: {}, home }), ['superpowers@superpowers-marketplace']);
  assert.deepEqual(faltantesRequeridos({ raiz: null, proyecto: null, env: {}, home: homeCon(PLUGINS_NUCLEO) }), []);
});

test('PLG-DEPS: comandosInstalar suma el marketplace de superpowers sólo si falta superpowers', () => {
  assert.deepEqual(comandosInstalar(['superpowers@superpowers-marketplace', 'feature-dev@claude-plugins-official']), [
    'claude plugin marketplace add obra/superpowers-marketplace',
    'claude plugin install superpowers@superpowers-marketplace',
    'claude plugin install feature-dev@claude-plugins-official',
  ]);
  assert.deepEqual(comandosInstalar(['feature-dev@claude-plugins-official']), ['claude plugin install feature-dev@claude-plugins-official']);
  assert.deepEqual(comandosInstalar([]), []);
});
