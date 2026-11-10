import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../plugin/scripts/vendor/js-yaml.mjs';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const general = path.join(raiz, 'plugin', 'general');
const plantilla = path.join(raiz, 'proyectos', '_plantilla');

const ARCHIVOS_GENERAL = ['resumen', 'proceso', 'entornos', 'tests', 'seguridad', 'tokens', 'git'];

test('general/ tiene los siete lineamientos', () => {
  for (const n of ARCHIVOS_GENERAL) {
    assert.ok(fs.existsSync(path.join(general, `${n}.md`)), `falta general/${n}.md`);
  }
});

test('general/resumen.md entra en 6000 caracteres', () => {
  const texto = fs.readFileSync(path.join(general, 'resumen.md'), 'utf8');
  assert.ok(texto.length > 0);
  assert.ok(texto.length <= 6000, `resumen.md tiene ${texto.length} caracteres`);
});

test('ningún archivo de general/ nombra un proyecto puntual', () => {
  for (const f of fs.readdirSync(general)) {
    const texto = fs.readFileSync(path.join(general, f), 'utf8');
    assert.doesNotMatch(texto, /punapp|crm|sede|azsewfx/i, `general/${f} nombra un proyecto`);
  }
});

test('_plantilla/proyecto.yml parsea y tiene las claves del contrato', () => {
  const py = yaml.load(fs.readFileSync(path.join(plantilla, 'proyecto.yml'), 'utf8'));
  for (const k of ['id', 'nombre', 'cuenta_github', 'repos', 'datos', 'ramas_prod', 'entornos', 'mcp_prod', 'skills_requeridas', 'circuito_prod', 'ui', 'sensible', 'tests']) {
    assert.ok(k in py, `falta la clave ${k}`);
  }
  assert.ok(Array.isArray(py.repos) && py.repos.length > 0);
  for (const k of ['nombre', 'rol', 'push_prod']) assert.ok(k in py.repos[0], `repos[0].${k}`);
  assert.ok(py.entornos.local && py.entornos.dev && py.entornos.prod);
  assert.equal(py.version_ciclo, 4, 'la plantilla está en la numeración de etapas v4');
  assert.ok(!('motor' in py.datos), 'datos.motor va comentado: sin declarar, se detecta');
  assert.match(fs.readFileSync(path.join(plantilla, 'proyecto.yml'), 'utf8'), /#\s*motor: odoo[^\n]*\n[^\n]*__manifest__\.py/, 'el comentario de datos.motor explica la detección');
  assert.ok(Array.isArray(py.mcp_prod) && py.mcp_prod.every((m) => m.servidor && m.tipo));
  assert.ok(py.skills_requeridas.every((s) => [2, 3, 5].includes(s.etapa) && s.skill), 'skills_requeridas con etapas v4 (2, 3 o 5)');
  assert.ok(!('lovable' in py), 'Lovable no es parte de la plantilla BACG');
  assert.ok(Array.isArray(py.circuito_prod) && py.circuito_prod[0].paso);
  for (const { paso } of py.circuito_prod) {
    assert.match(paso, /^(sql|push|merge-prs-sync|manual|dev):.+|^sync-lineamientos$/, `paso inválido en circuito_prod: ${paso}`);
  }
  assert.ok(Array.isArray(py.ui.patrones) && py.ui.canon);
  assert.ok(Array.isArray(py.sensible.rutas));
  for (const k of ['unit', 'componentes', 'sql', 'e2e', 'cobertura_cambios_min']) assert.ok(k in py.tests, `tests.${k}`);
  assert.equal(py.tests.cobertura_cambios_min, 80);
});

test('_plantilla tiene reglas, resumen (≤2000) y backlog con su encabezado', () => {
  assert.ok(fs.existsSync(path.join(plantilla, 'reglas.md')));
  const resumen = fs.readFileSync(path.join(plantilla, 'resumen.md'), 'utf8');
  assert.ok(resumen.length > 0 && resumen.length <= 2000, `resumen de plantilla: ${resumen.length}`);
  const backlog = fs.readFileSync(path.join(plantilla, 'backlog.md'), 'utf8');
  assert.match(backlog, /\| Código \| Tarea \| Prioridad \| Estado \| Impacto \| Link \|/);
});
