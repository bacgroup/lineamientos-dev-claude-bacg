// PLG-CTX (4.2.0): compactación de salidas largas sin perder errores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compactarTexto, compactarJson, compactar, esLineaCritica } from '../plugin/scripts/lib/compactar.mjs';

const relleno = (n, f = (i) => `2026-11-10 12:00:${String(i % 60).padStart(2, '0')} INFO odoo.modules.loading: módulo ${i} cargado`) =>
  Array.from({ length: n }, (_, i) => f(i));

test('esLineaCritica: errores, fallas y tracebacks; no líneas comunes', () => {
  for (const l of ['ERROR powerfy odoo.addons.x: FAIL: test_a', 'Traceback (most recent call last):', 'AssertionError: 1 != 2', '✖ falla el spec', 'fatal: not a git repository', 'Error: boom']) {
    assert.ok(esLineaCritica(l), l);
  }
  for (const l of ['INFO odoo: cargado', 'Ran 12 tests in 3.1s', 'todo bien']) assert.ok(!esLineaCritica(l), l);
});

test('compactarTexto: una salida corta queda igual', () => {
  const t = relleno(20).join('\n');
  assert.equal(compactarTexto(t).texto, t);
});

test('compactarTexto: un error en el medio de 2000 líneas sobrevive con su contexto, y se conservan principio y final', () => {
  const l = relleno(2000);
  l[1000] = 'Traceback (most recent call last):';
  l[1001] = '  File "/mnt/extra-addons/pf/tests/test_x.py", line 88, in test_totales';
  l[1002] = 'AssertionError: 15180.5 != 15230.5';
  const r = compactarTexto(l.join('\n'));
  for (const x of [l[0], l[1999], l[1000], l[1001], l[1002], l[999]]) assert.ok(r.texto.includes(x), x);
  assert.match(r.texto, /líneas omitidas|\[×\d+\]/);
  assert.ok(r.texto.length < l.join('\n').length / 5, `${r.texto.length}`);
});

test('compactarTexto: un error entre líneas variadas (sin repetir) sobrevive y se omite el resto', () => {
  const palabras = ['alfa', 'beta', 'gama', 'delta', 'épsilon', 'zeta'];
  const l = Array.from({ length: 1500 }, (_, i) => `${palabras[i % 6]} ${palabras[(i * 7) % 6]} paso ${i}: ${'x'.repeat(i % 13)}`);
  l[700] = 'FAIL: test_totales_por_vendedor (pf.tests.TestGerente)';
  const r = compactarTexto(l.join('\n'));
  assert.ok(r.texto.includes(l[700]));
  assert.ok(r.texto.includes(l[699]) && r.texto.includes(l[701]));
  assert.ok(r.texto.includes(l[1499]));
  assert.match(r.texto, /líneas omitidas/);
});

test('compactarTexto: líneas repetidas consecutivas (salvo números) se colapsan con la cuenta', () => {
  const l = [...relleno(5, () => 'arranque'), ...relleno(300, (i) => `GET /web/static/x.js 200 ${i}ms`), 'fin'];
  const r = compactarTexto(l.join('\n'));
  assert.match(r.texto, /\[×300\] GET \/web\/static\/x\.js 200 0ms/);
  assert.ok(r.texto.includes('fin'));
});

test('compactarTexto: con cientos de errores conserva los primeros y los últimos y dice cuántos omitió', () => {
  const l = relleno(3000, (i) => (i % 5 === 0 ? `ERROR caso ${i} falló` : `INFO paso ${i}`));
  const r = compactarTexto(l.join('\n'));
  assert.ok(r.texto.includes('ERROR caso 0 falló'));
  assert.ok(r.texto.includes('ERROR caso 2995 falló'));
  assert.match(r.texto, /líneas omitidas/);
  assert.ok(r.texto.split('\n').length < 400);
});

test('compactarTexto: saca códigos ANSI', () => {
  const r = compactarTexto(`\u001b[31mERROR rojo\u001b[0m\n${relleno(10).join('\n')}`);
  assert.ok(r.texto.startsWith('ERROR rojo'));
});

test('compactarJson: saca campos de ruido de la API de GitHub, recorta listas y textos largos', () => {
  const commits = Array.from({ length: 30 }, (_, i) => ({
    sha: `abc${i}`,
    node_id: 'MDY6Q29tbWl0',
    url: 'https://api.github.com/x',
    html_url: `https://github.com/o/r/commit/abc${i}`,
    comments_url: 'https://api.github.com/x/comments',
    commit: { message: 'x'.repeat(2000), author: { name: 'n', date: '2026-11-10' } },
    author: { login: 'u', avatar_url: 'https://avatars/x', gravatar_id: '' },
  }));
  const original = JSON.stringify(commits);
  const r = compactarJson(original);
  const v = JSON.parse(r.texto);
  assert.equal(v.length, 21); // 20 + el aviso de cuántos faltan
  assert.match(JSON.stringify(v[20]), /10 elementos más/);
  assert.equal(v[0].node_id, undefined);
  assert.equal(v[0].url, undefined);
  assert.equal(v[0].comments_url, undefined);
  assert.equal(v[0].author.avatar_url, undefined);
  assert.equal(v[0].html_url, 'https://github.com/o/r/commit/abc0');
  assert.ok(v[0].commit.message.length < 600);
  assert.ok(r.texto.length < original.length / 4);
});

test('compactarJson: si no es JSON devuelve null', () => {
  assert.equal(compactarJson('hola { no'), null);
});

test('compactar: elige JSON o texto según el contenido', () => {
  assert.equal(compactar('[{"node_id":"x","a":1}]').tipo, 'json');
  assert.equal(compactar(relleno(500).join('\n')).tipo, 'texto');
});

test('resumenFalla: el FAIL de Odoo en el medio sobrevive aunque después venga un teardown largo, y guarda la salida completa', async () => {
  const { resumenFalla } = await import('../plugin/scripts/lib/cli.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home falla-'));
  const l = [
    ...relleno(400),
    'FAIL: test_totales_por_vendedor (odoo.addons.pf.tests.TestGerente)',
    'AssertionError: 15180.5 != 15230.5',
    ...relleno(600, (i) => `INFO teardown ${i} ${'·'.repeat(i % 11)}`),
  ];
  const r = resumenFalla(l.join('\n'), 60, { home, id: 'tests-R-1' });
  assert.ok(r.includes('FAIL: test_totales_por_vendedor'));
  assert.ok(r.includes('AssertionError: 15180.5 != 15230.5'));
  assert.ok(r.includes(l[l.length - 1]));
  const m = r.match(/\[salida completa: (.+)\]$/);
  assert.ok(m);
  assert.equal(fs.readFileSync(m[1], 'utf8'), l.join('\n'));
});

test('resumenFalla: una salida corta queda entera y sin archivo', async () => {
  const { resumenFalla } = await import('../plugin/scripts/lib/cli.mjs');
  const t = relleno(50).join('\n');
  assert.equal(resumenFalla(t, 60), t);
});
