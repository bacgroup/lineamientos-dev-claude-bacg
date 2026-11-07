// Entorno de la suite (npm test lo carga con --import): la validación previa de `abrir` hace git fetch de cada repo
// y alarga mucho los tests que no la prueban. Se saltea por defecto; tests/previa.test.mjs la corre a propósito.
process.env.BACG_DEV_SIN_PREVIA ??= '1';

// Cada proceso de tests usa su propia carpeta temporal y la borra al salir. Los repos de prueba se crean en el temp y
// la CLI mira las carpetas vecinas de un repo (repos hermanos): en el temp compartido se acumulaban decenas de miles
// de carpetas de corridas viejas y cada comando las recorría.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

{
  // En cada proceso (el runner y cada archivo de tests): la del archivo queda dentro de la del runner.
  const propio = fs.mkdtempSync(path.join(os.tmpdir(), 'bacg-tests-'));
  for (const v of ['TMPDIR', 'TMP', 'TEMP']) process.env[v] = propio;
  process.on('exit', () => {
    try {
      fs.rmSync(propio, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // archivos todavía abiertos (Windows): quedan para la próxima limpieza del sistema
    }
  });
}

// Los tests arman sus propios homes: una cuenta de Claude con CLAUDE_CONFIG_DIR no tiene que cambiarles nada.
delete process.env.CLAUDE_CONFIG_DIR;
