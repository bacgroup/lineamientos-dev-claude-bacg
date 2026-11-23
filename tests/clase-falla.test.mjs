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

// Revisión de PLG-TEST-INFRA: salidas con el formato real de vitest y jest.
test('claseFalla: vitest repite el timeout en el árbol y en Failed Tests; con un rojo real → rojo', () => {
  const s = [
    ' ❯ src/a.test.ts (2 tests | 2 failed) 5012ms',
    '   × lento 5003ms',
    '     → Test timed out in 5000ms.',
    '   × suma 3ms',
    '     → expected 3 to be 4',
    '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯',
    ' FAIL  src/a.test.ts > lento',
    'Error: Test timed out in 5000ms.',
    ' FAIL  src/a.test.ts > suma',
    'AssertionError: expected 3 to be 4',
    ' Test Files  1 failed (1)',
    '      Tests  2 failed (2)',
  ].join('\n');
  assert.equal(claseFalla(s), 'rojo');
});

test('claseFalla: vitest con el timeout repetido de un solo test → timeout', () => {
  const s = [
    '   × lento 5003ms',
    '     → Test timed out in 5000ms.',
    ' FAIL  src/a.test.ts > lento',
    'Error: Test timed out in 5000ms.',
    '      Tests  1 failed | 4 passed (5)',
  ].join('\n');
  assert.equal(claseFalla(s), 'timeout');
});

test('claseFalla: jest repite los fallos en el Summary; 1 rojo + 1 timeout → rojo', () => {
  const bloque = '  ● Lista › carga\n\n    thrown: "Exceeded timeout of 5000 ms for a test."\n\n  ● Lista › suma\n\n    expect(received).toBe(expected)\n';
  const s = `${bloque}\nSummary of all failing tests\n${bloque}\nTests:       2 failed, 8 passed, 10 total`;
  assert.equal(claseFalla(s), 'rojo');
});

test('claseFalla: un archivo o suite que no carga con los tests en verde → rojo', () => {
  assert.equal(claseFalla(' Test Files  1 failed | 9 passed (10)\n      Tests  40 passed (40)\nError: [vitest-worker]: Timeout calling "onTaskUpdate"'), 'rojo');
  assert.equal(claseFalla('Test Suites: 1 failed, 9 passed, 10 total\nTests:       40 passed, 40 total\nA worker process has failed to exit gracefully'), 'rojo');
});

test('claseFalla: jest en verde con el aviso de handles abiertos no es infraestructura', () => {
  assert.equal(claseFalla('Tests:       40 passed, 40 total\nA worker process has failed to exit gracefully and has been force exited.'), 'rojo');
});

test('claseFalla: un Unhandled Rejection del código del producto con todo en verde → rojo', () => {
  const s = '      Tests  10 passed (10)\n⎯⎯ Unhandled Rejection ⎯⎯\nTypeError: x is undefined\n ❯ src/api/leads.ts:42:7\nThis error originated in "src/api/leads.test.ts" test file.';
  assert.equal(claseFalla(s), 'rojo');
});
