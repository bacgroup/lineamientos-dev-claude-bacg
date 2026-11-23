// PLG-TEST-INFRA: clase de una falla de tests (rojo, timeout o infraestructura del runner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claseFalla } from '../plugin/scripts/lib/cli.mjs';

const VITEST_WORKER_VERDE = [
  ' Test Files  196 passed (196)',
  '      Tests  1608 passed (1608)',
  '',
  '⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯',
  'Error: [vitest-worker]: Timeout calling "onTaskUpdate" with "[...]"',
  '   Duration  212.40s',
].join('\n');

const VITEST_TIMEOUT = [
  ' FAIL  src/pages/Inbox.test.tsx > Inbox > muestra los leads',
  'Error: Test timed out in 5000ms.',
  'If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".',
  ' FAIL  src/pages/Cotizador.test.tsx > Cotizador > calcula',
  'Error: Test timed out in 15000ms.',
  '      Tests  2 failed | 1606 passed (1608)',
].join('\n');

const VITEST_ROJO = [
  ' FAIL  src/a.test.ts > caso uno',
  'AssertionError: expected 1 to be 2',
  '      Tests  1 failed | 10 passed (11)',
].join('\n');

test('claseFalla: todos en verde y el worker de vitest no contesta → infraestructura', () => {
  assert.equal(claseFalla(VITEST_WORKER_VERDE), 'infraestructura');
});

test('claseFalla: jest en verde con un worker que no termina → infraestructura', () => {
  const s = 'Tests:       40 passed, 40 total\nA worker process has failed to exit gracefully and has been force exited.';
  assert.equal(claseFalla(s), 'infraestructura');
});

test('claseFalla: todos los fallos son Test timed out → timeout', () => {
  assert.equal(claseFalla(VITEST_TIMEOUT), 'timeout');
});

test('claseFalla: timeout de jest (Exceeded timeout) → timeout', () => {
  const s = '  ● Lista › carga\n\n    thrown: "Exceeded timeout of 5000 ms for a test."\nTests:       1 failed, 9 passed, 10 total';
  assert.equal(claseFalla(s), 'timeout');
});

test('claseFalla: un fallo de aserción → rojo', () => {
  assert.equal(claseFalla(VITEST_ROJO), 'rojo');
});

test('claseFalla: timeouts mezclados con un rojo real → rojo', () => {
  assert.equal(claseFalla(`${VITEST_TIMEOUT}\n${VITEST_ROJO}`), 'rojo');
});

test('claseFalla: error del worker con un test fallado → no es infraestructura', () => {
  assert.equal(claseFalla(`${VITEST_ROJO}\nError: [vitest-worker]: Timeout calling "onTaskUpdate"`), 'rojo');
});

test('claseFalla: salida sin resumen reconocible (falla al arrancar) → rojo', () => {
  assert.equal(claseFalla('sh: vitest: command not found'), 'rojo');
  assert.equal(claseFalla(''), 'rojo');
});

test('claseFalla: con colores ANSI', () => {
  assert.equal(claseFalla(`\u001b[32m${VITEST_WORKER_VERDE}\u001b[39m`), 'infraestructura');
});
