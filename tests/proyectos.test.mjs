import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../plugin/scripts/vendor/js-yaml.mjs';
import { basesProd } from '../plugin/scripts/lib/stack.mjs';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const proyectos = path.join(raiz, 'proyectos');

const RE_PASO = /^(sql|push|merge-prs-sync|manual):.+|^sync-lineamientos$/;
const ENCABEZADO_BACKLOG = '| Código | Tarea | Prioridad | Estado | Impacto | Link |';
// lovable, datos, ramas_prod y agentes_externos son opcionales: el stack por defecto es Supabase + Lovable.
const CLAVES = ['id', 'nombre', 'cuenta_github', 'repos', 'entornos', 'circuito_prod', 'ui', 'sensible', 'tests'];

const dirProyecto = (p) => path.join(proyectos, p);
const cargar = (p) => yaml.load(fs.readFileSync(path.join(dirProyecto(p), 'proyecto.yml'), 'utf8'));
const pasos = (py) => py.circuito_prod.map((c) => c.paso);

// Proyectos que todavía tienen su proyecto.yml acá (desde 0.5 la configuración vive en .bacg-dev/ de cada repo).
const registrados = fs.existsSync(proyectos)
  ? fs.readdirSync(proyectos, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(proyectos, d.name, 'proyecto.yml')))
      .map((d) => d.name)
  : [];


for (const p of registrados) {
  test(`${p}: proyecto.yml cumple el contrato`, () => {
    const py = cargar(p);
    assert.equal(py.id, p, 'id debe coincidir con el nombre de la carpeta');
    for (const k of CLAVES) assert.ok(k in py, `falta la clave ${k}`);

    assert.ok(Array.isArray(py.repos) && py.repos.length > 0, 'repos debe ser un array no vacío');
    for (const r of py.repos) {
      assert.equal(typeof r.nombre, 'string', 'repo sin nombre');
      assert.ok('rol' in r, `repo ${r.nombre}: falta rol`);
      assert.ok(r.push_prod === true || r.push_prod === false, `repo ${r.nombre}: push_prod debe ser booleano`);
      // ruta_local es opcional: el repo se identifica por su remoto origin y los hijos se operan por gh y MCP.
      if ('ruta_local' in r) {
        assert.ok(typeof r.ruta_local === 'string' && r.ruta_local.length > 0, `repo ${r.nombre}: ruta_local vacía`);
      }
    }
    const nombresRepos = py.repos.map((r) => r.nombre);

    // Bases de PROD: supabase_refs y/o bases (otro motor). Pueden faltar si el circuito no tiene pasos sql:.
    for (const k of ['supabase_refs', 'bases']) {
      const v = py.entornos.prod?.[k];
      assert.ok(v === undefined || Array.isArray(v), `entornos.prod.${k} debe ser un array`);
    }
    const refs = basesProd(py);

    assert.ok(Array.isArray(py.circuito_prod) && py.circuito_prod.length > 0, 'circuito_prod vacío');
    const lista = pasos(py);
    for (const paso of lista) {
      assert.match(paso, RE_PASO, `paso inválido en circuito_prod: ${paso}`);
      const [tipo, ...resto] = paso.split(':');
      const arg = resto.join(':');
      if (tipo === 'sql') assert.ok(refs.includes(arg), `sql:${arg} no está en entornos.prod (supabase_refs o bases)`);
      if (tipo === 'push' || tipo === 'merge-prs-sync') {
        assert.ok(nombresRepos.includes(arg), `${tipo}:${arg} no es un repo de repos`);
      }
    }
    assert.ok(lista[lista.length - 1].startsWith('manual:'), 'el último paso del circuito debe ser manual:');

    for (const clave of Object.keys(py.lovable.proyectos)) {
      assert.ok(nombresRepos.includes(clave), `lovable.proyectos.${clave} no es un repo de repos`);
    }

    assert.ok(Array.isArray(py.ui.patrones) && py.ui.patrones.length > 0, 'ui.patrones debe ser un array no vacío');
    assert.ok(
      fs.existsSync(path.join(dirProyecto(p), py.ui.canon)),
      `ui.canon (${py.ui.canon}) no existe en proyectos/${p}/`
    );

    assert.equal(py.tests.cobertura_cambios_min, 80);
    // Los comandos los declara cada PC (~/.claude/bacg-dev.json); en proyecto.yml pueden quedar vacíos.
    assert.ok(typeof py.tests.unit === 'string', 'tests.unit debe ser un string');
  });

  test(`${p}: resumen.md ≤ 2000 y backlog.md con encabezado`, () => {
    const resumen = fs.readFileSync(path.join(dirProyecto(p), 'resumen.md'), 'utf8');
    assert.ok(resumen.length > 0 && resumen.length <= 2000, `resumen.md tiene ${resumen.length} caracteres`);
    const backlog = fs.readFileSync(path.join(dirProyecto(p), 'backlog.md'), 'utf8');
    assert.ok(backlog.includes(ENCABEZADO_BACKLOG), 'backlog.md sin el encabezado de la tabla');
    assert.ok(fs.existsSync(path.join(dirProyecto(p), 'reglas.md')), 'falta reglas.md');
  });
}

test('registro.yml lista los proyectos con su repo y cuenta de gh', () => {
  const r = yaml.load(fs.readFileSync(path.join(proyectos, 'registro.yml'), 'utf8'));
  const ids = r.proyectos.map((p) => p.id);
  for (const id of ['powerfy']) assert.ok(ids.includes(id), `falta ${id} en registro.yml`);
  for (const p of r.proyectos) {
    assert.equal(typeof p.repo, 'string', `${p.id}: repo`);
    assert.equal(typeof p.cuenta_gh, 'string', `${p.id}: cuenta_gh`);
  }
});
