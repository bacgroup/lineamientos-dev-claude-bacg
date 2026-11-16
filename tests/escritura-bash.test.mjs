// PLG-CLOUD (hallazgo 16): con reglas 4.4, la compuerta de Bash aplica la compuerta de edición a lo que un comando
// escribe en el repo (redirección, heredoc, sed -i, tee, cp, mv, python -c / node -e con open(…,'w') o
// writeFileSync). Antes, en REPORTES, el agente escribió código por Bash antes del diseño aprobado y del test en rojo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluarBash } from '../plugin/scripts/lib/compuerta-bash.mjs';
import { guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const PY = { id: 'demo', repos: [{ nombre: 'demo-app' }] };

function repo({ reglas = 44, aprobado = false } = {}) {
  const raiz = crearRepoTemporal({ archivos: { 'src/a.ts': 'a\n', '.bacg-dev/proyecto.yml': `id: demo\nnombre: Demo\nrepos:\n  - { nombre: demo-app }\n` } });
  guardarEstado(raiz, {
    codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', etapa: 1, ...(reglas ? { reglas } : {}), saltos: [],
    aprobaciones: aprobado ? [{ etapa: 1, frase: 'apruebo', fecha: '2026-11-16T00:00:00Z' }] : [],
  });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'spec.md'), '# R-1\n\n## Diseño\nx\n\n## Tareas\n- una\n');
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-1\n');
  return raiz;
}
const evaluar = (raiz, comando) => evaluarBash({ comando, cwd: raiz, ctx: { textosUsuario: [] } });

const ESCRIBEN_CODIGO = [
  "cat > src/a.ts <<'EOF'\nexport const x = 1;\nEOF",
  'echo x >> src/nuevo.ts',
  "sed -i 's/a/b/' src/a.ts",
  'printf x | tee src/b.ts',
  'cp /tmp/x.ts src/a.ts',
  `python3 -c "open('src/a.ts','w').write('x')"`,
  `python -c "from pathlib import Path; Path('src/c.ts').write_text('x')"`,
  `node -e "require('fs').writeFileSync('src/a.ts','x')"`,
];

test('4.4: escribir código por Bash antes del diseño aprobado se niega, con el motivo de la compuerta de edición', () => {
  const raiz = repo();
  for (const c of ESCRIBEN_CODIGO) {
    const r = evaluar(raiz, c);
    assert.equal(r.decision, 'deny', c);
    assert.match(r.motivo, /Escritura por Bash/, c);
    assert.match(r.motivo, /diseño aprobado/, c);
  }
});

test('4.4: con el diseño aprobado, la misma escritura pasa', () => {
  const raiz = repo({ aprobado: true });
  for (const c of ESCRIBEN_CODIGO) assert.equal(evaluar(raiz, c).decision, 'allow', c);
});

test('4.4: escribir fuera del repo, en docs o leer con python no se niega', () => {
  const raiz = repo();
  for (const c of [
    'echo x > /tmp/salida.txt',
    'echo x > docs/notas.md',
    `python3 -c "print(open('src/a.ts').read())"`,
    `python3 -c "open('src/a.ts','r').read()"`,
    'cat src/a.ts > /tmp/copia.ts',
  ]) assert.equal(evaluar(raiz, c).decision, 'allow', c);
});

test('sin reglas 4.4: Bash sigue como en la 4.4.0 (sólo protege estado y transcript)', () => {
  const raiz = repo({ reglas: null });
  assert.equal(evaluar(raiz, 'echo x > src/a.ts').decision, 'allow');
  assert.equal(evaluar(raiz, 'echo x > docs/rq/R-1/estado.yml').decision, 'deny');
});
