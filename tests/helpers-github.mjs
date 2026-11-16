// prMergadoGh con un env que no tenga BACG_DEV_SIN_GH (la suite lo puede traer del entorno) y el PATH del proceso,
// donde el test puso el gh falso.
import { prMergeadoGh } from '../plugin/scripts/lib/rq-rama.mjs';

export const prMergadoGhSeguro = (raiz, codigo) => prMergeadoGh(raiz, codigo, { ...process.env, BACG_DEV_SIN_GH: '' });
