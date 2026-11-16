// PLG-CLOUD (hallazgo 12): los rojos conocidos reconocen la salida de los tests de Odoo, además de vitest/jest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fallosDe, soloRojosConocidos } from '../plugin/scripts/lib/cli.mjs';

const SALIDA_ODOO = `2026-11-16 10:00:01,123 42 INFO powerfy_tpl odoo.modules.module: odoo.addons.powerfy_migracion.tests.test_loader running
2026-11-16 10:00:02,456 42 ERROR powerfy_tpl odoo.addons.powerfy_migracion.tests.test_loader: FAIL: TestLoader.test_columnas_demo
Traceback (most recent call last):
AssertionError: 3 != 4
2026-11-16 10:00:03,789 42 ERROR powerfy_tpl odoo.addons.powerfy_reports.tests.test_tablas: ERROR: TestTablas.test_totales
FAIL: test_vacio (odoo.addons.powerfy_bi.tests.test_kpi.TestKpi.test_vacio)
`;

test('fallosDe reconoce los FAIL y ERROR de Odoo (log y unittest)', () => {
  const f = fallosDe(SALIDA_ODOO);
  assert.ok(f.includes('powerfy_migracion.tests.test_loader.TestLoader.test_columnas_demo'), f.join('\n'));
  assert.ok(f.includes('powerfy_reports.tests.test_tablas.TestTablas.test_totales'));
  assert.ok(f.includes('odoo.addons.powerfy_bi.tests.test_kpi.TestKpi.test_vacio'));
  assert.equal(f.length, 3);
});

test('con los de Odoo declarados como rojos conocidos, no bloquean; uno nuevo, sí', () => {
  const conocidos = ['powerfy_migracion.tests.test_loader', 'TestTablas.test_totales', 'TestKpi.test_vacio'];
  assert.equal(soloRojosConocidos(fallosDe(SALIDA_ODOO), conocidos), true);
  assert.equal(soloRojosConocidos(fallosDe(`${SALIDA_ODOO}FAIL: test_nuevo (odoo.addons.x.tests.t.T.test_nuevo)\n`), conocidos), false);
});

test('vitest/jest sigue igual', () => {
  assert.deepEqual(fallosDe('FAIL src/a.test.ts > suma > da 2\n'), ['src/a.test.ts > suma > da 2']);
});
