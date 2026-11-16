// Reglas de cumplimiento de la 4.4 (PLG-DFF2): valen para los RQ abiertos con ellas (`reglas: 44` en estado.yml) o
// actualizados con `rq.mjs reglas actualizar`. Los RQ en curso de antes siguen con las de la 4.3.
export const REGLAS_ACTUALES = 44;

/** ¿El RQ sigue las reglas de cumplimiento de la 4.4? */
export const reglas44 = (estado) => Number.isInteger(estado?.reglas) && estado.reglas >= 44;
