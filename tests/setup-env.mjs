// Entorno de la suite (npm test lo carga con --import): la validación previa de `abrir` hace git fetch de cada repo
// y alarga mucho los tests que no la prueban. Se saltea por defecto; tests/previa.test.mjs la corre a propósito.
process.env.BACG_DEV_SIN_PREVIA ??= '1';
