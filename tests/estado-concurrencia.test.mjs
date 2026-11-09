import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cargarEstado, guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { conLock, intentarLock, soltarLock, lockTomado } from '../plugin/scripts/lib/lock.mjs';

function raizTemporal() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'estado conc-'));
  guardarEstado(raiz, {
    codigo: 'R-C1', tipo: 'rq', clasificacion: 'bounded', etapa: 3,
    aprobaciones: [{ etapa: 1, frase: 'Aprobado el diseño', fecha: 'x' }], skills: [], saltos: [], circuito: [],
  });
  return raiz;
}

// Handoff 4.0.1, punto 9: `verificar` (11 min) leyó el estado al arrancar y al terminar volcó su copia, borrando
// `verificar --local` y la skill que se registraron mientras tanto.
test('guardarEstado no pisa lo que otro proceso registró después de que éste leyó (read-modify-write)', () => {
  const raiz = raizTemporal();
  const largo = cargarEstado(raiz, 'R-C1'); // verificar arranca

  const local = cargarEstado(raiz, 'R-C1'); // verificar --local mientras tanto
  local.verificacion_local = { que: 'recorrido', capturas: ['a.png'], fecha: 'y' };
  guardarEstado(raiz, local);
  const hook = cargarEstado(raiz, 'R-C1'); // el hook anota una skill
  hook.skills = [...hook.skills, { skill: 'odoo-review', etapa: 3 }];
  guardarEstado(raiz, hook);

  largo.e2e = { ok: true, completo: true };
  guardarEstado(raiz, largo);

  const final = cargarEstado(raiz, 'R-C1');
  assert.deepEqual(final.e2e, { ok: true, completo: true });
  assert.deepEqual(final.verificacion_local, { que: 'recorrido', capturas: ['a.png'], fecha: 'y' });
  assert.deepEqual(final.skills, [{ skill: 'odoo-review', etapa: 3 }]);
  // El objeto en memoria queda igual a lo escrito.
  assert.deepEqual(largo.verificacion_local, final.verificacion_local);
});

test('guardarEstado fusiona listas: suma lo nuevo de cada lado y respeta lo que este proceso quitó', () => {
  const raiz = raizTemporal();
  const a = cargarEstado(raiz, 'R-C1');
  const b = cargarEstado(raiz, 'R-C1');
  b.aprobaciones = [...b.aprobaciones, { etapa: 4, frase: 'Dale a DEV', fecha: 'z' }];
  guardarEstado(raiz, b);
  a.aprobaciones = []; // a quita la del diseño
  a.saltos = [{ compuerta: 'e2e', frase: 'Sin E2E', motivo: 'm' }];
  guardarEstado(raiz, a);
  const final = cargarEstado(raiz, 'R-C1');
  assert.deepEqual(final.aprobaciones, [{ etapa: 4, frase: 'Dale a DEV', fecha: 'z' }]);
  assert.deepEqual(final.saltos, [{ compuerta: 'e2e', frase: 'Sin E2E', motivo: 'm' }]);
});

test('guardarEstado: dos escrituras sucesivas del mismo objeto no repiten entradas', () => {
  const raiz = raizTemporal();
  const a = cargarEstado(raiz, 'R-C1');
  a.skills = [{ skill: 's1' }];
  guardarEstado(raiz, a);
  a.skills = [...a.skills, { skill: 's2' }];
  guardarEstado(raiz, a);
  assert.deepEqual(cargarEstado(raiz, 'R-C1').skills, [{ skill: 's1' }, { skill: 's2' }]);
});

test('guardarEstado en procesos en paralelo: ninguna skill se pierde', () => {
  const raiz = raizTemporal();
  const url = pathToFileURL(path.resolve('plugin/scripts/lib/estado.mjs')).href;
  const n = 6;
  const script = `
    import { cargarEstado, guardarEstado } from ${JSON.stringify(url)};
    const [raiz, i] = process.argv.slice(1);
    for (let k = 0; k < 5; k++) {
      const e = cargarEstado(raiz, 'R-C1');
      e.skills = [...e.skills, { skill: 's' + i + '-' + k }];
      guardarEstado(raiz, e);
    }`;
  const hijos = Array.from({ length: n }, (_, i) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', script, raiz, String(i)]);
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('close', (status) => resolve({ status, stderr }));
    }));
  return Promise.all(hijos).then((rs) => {
    for (const r of rs) assert.equal(r.status, 0, r.stderr);
    assert.equal(cargarEstado(raiz, 'R-C1').skills.length, n * 5);
  });
});

test('lock: lo toma uno, otro no; uno abandonado (pid muerto) se toma', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const archivo = path.join(dir, 'x.lock');
  assert.equal(intentarLock(archivo, 'yo'), true);
  assert.equal(lockTomado(archivo)?.pid, process.pid);
  soltarLock(archivo);
  assert.equal(lockTomado(archivo), null);
  fs.writeFileSync(archivo, JSON.stringify({ pid: 999999, fecha: new Date().toISOString(), que: 'muerto' }));
  assert.equal(lockTomado(archivo), null);
  assert.equal(conLock(archivo, () => 42), 42);
  assert.equal(fs.existsSync(archivo), false);
});
