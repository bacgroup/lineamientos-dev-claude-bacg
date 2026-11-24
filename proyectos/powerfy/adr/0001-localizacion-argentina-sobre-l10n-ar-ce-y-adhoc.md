# 0001. Localización Argentina sobre l10n_ar de Odoo CE + módulos CE de ADHOC, vendorizados en powerfy-l10n

- Fecha: 2026-11-24
- RQ: PF-L10N-AR
- Estado: propuesta

## Contexto

BACG necesita vender PowerFy (Odoo 18 CE) en Argentina, y PowerFy no tiene hoy facturación electrónica con ARCA (ex AFIP) ni en el backend ni en el POS. La pregunta era: ¿sobre qué módulos se construye la interfaz con ARCA? El pedido original era partir de OCA.

Qué hay disponible en la rama 18.0 (relevado el 2026-11-24):

| Fuente | Qué trae | Licencia | Estado |
|---|---|---|---|
| Odoo CE (`odoo/odoo`, addons) | `l10n_ar` (plan de cuentas, responsabilidades frente al IVA, tipos de comprobante, PDF con QR y leyenda de la Ley 27.743 de transparencia fiscal), `l10n_ar_withholding` (retenciones en pagos), `l10n_ar_pos` (tipo de documento y responsabilidad en el POS), `l10n_ar_website_sale`, `l10n_latam_check` | LGPL-3 | Mantenido por Odoo |
| Odoo Enterprise | `l10n_ar_edi` (factura electrónica con ARCA). En CE no existe: la URL del manifiesto en 18.0 devuelve 404 | Propietaria | Sólo con suscripción EE |
| `OCA/l10n-argentina` 18.0 | **Vacío:** no tiene ningún módulo, sólo el scaffold. Último commit: 2025-02-02 | AGPL-3 | No es viable |
| `ingadhoc/odoo-argentina-ce` 18.0 | `l10n_ar_afipws` (certificados, WSAA, padrón), `l10n_ar_afipws_fe` (WSFE, WSFEX, WSBFE y WSMTXCA, CAE, ya incluye `CondicionIVAReceptor` de la RG 5616), `l10n_ar_pos_afipws_fe` (23 líneas: factura el pedido del POS), `l10n_ar_reports` | AGPL-3 | Activo (último commit: 2026-11-18). Autores: ADHOC, Moldeo y "OCA" en el manifiesto. **Sin tests** |
| `ingadhoc/odoo-argentina` 18.0 | `l10n_ar_ux`, `l10n_ar_tax` (percepciones e IIBB, depende de `account_payment_pro` y `l10n_latam_check_ux` de otros repos de ADHOC), `l10n_ar_purchase`, `l10n_ar_bank` | AGPL-3 | Activo (2026-11-24) |
| `ingadhoc/odoo-argentina-ee` 18.0 | Libro IVA digital, SIRE, ARBA y otros | AGPL/LGPL | **Requiere EE** (`account_reports`, `l10n_ar_edi`): no aplica |

Restricciones que pesan:

- PowerFy es CE y su modelo comercial no admite exigir una licencia EE por cliente.
- La librería que habla con ARCA es `pyafipws`. Los repos de ADHOC la instalan desde forks de GitHub sin versión fija (`filoquin/pyafipws@py3k` y `ingadhoc/pyafipws@odoo18`), y además necesita `M2Crypto` y `pyOpenSSL`, que suman librerías de sistema a la imagen.
- Cada cliente tiene su certificado y su clave de ARCA, que son secretos.
- Ya existe un patrón para Centroamérica en `powerfy-l10n` (serie `vitt_l10n_*`, ver PF-L10N-CA).

## Opciones

1. **`l10n_ar` de CE + módulos CE de ADHOC (`odoo-argentina-ce` y una selección de `odoo-argentina`), vendorizados en `powerfy-l10n` con commit fijo.**
   - Pros: cubre factura electrónica en el backend y en el POS ya en 18.0. Activo y usado en Argentina. Lo más barato para llegar a vender.
   - Contras: es AGPL-3. No trae tests. `pyafipws` llega desde un fork personal. La contingencia del POS sin conexión con CAEA sólo existe como campo, sin el flujo de pedido y rendición. El libro IVA digital, SIRE y ARBA de ADHOC requieren EE, así que esos reportes hay que construirlos.
2. **Odoo Enterprise `l10n_ar_edi`.**
   - Pros: soporte oficial y completo.
   - Contras: rompe el modelo CE de PowerFy, cuesta una licencia por usuario y obliga a migrar la base a EE.
3. **OCA `l10n-argentina`.**
   - Contras: vacío en 18.0. Habría que portar módulos viejos, que es lo mismo que la opción 1 pero sin mantenedor.
4. **Desarrollo propio contra los WS de ARCA, sobre `pyafipws` o con SOAP directo.**
   - Pros: control total, licencia propia.
   - Contras: el costo más alto, y BACG quedaría sola siguiendo cada cambio normativo de ARCA (RG 5616, Ley 27.743, etc.).
5. **Proveedor SaaS de facturación electrónica** (API de terceros), con un conector PowerFy.
   - Pros: poco desarrollo, el proveedor absorbe los cambios normativos.
   - Contras: costo por comprobante, dependencia de un tercero, datos fiscales fuera de PowerFy y un POS que depende de dos servicios externos.

## Decisión

Opción 1. Es la única que llega a facturación electrónica en el backend y en el POS sobre CE sin licencia EE y con un mantenedor activo. Las brechas (tests, reportes de IVA, CAEA en el POS, librería fijada) las cubre BACG en módulos `powerfy_l10n_ar_*` propios, sin modificar los de ADHOC. La opción 5 queda como plan B si la opción 1 no pasa la homologación con ARCA.

## Consecuencias

- **Se vuelve más fácil:** facturar con CAE (A, B, C, M y E de exportación) y notas de crédito y débito desde el backend, y facturar el pedido del POS. Además se reusan `l10n_ar` y `l10n_ar_pos` de CE.
- **Se vuelve más difícil o hay que construir:**
  - Tests propios del circuito con ARCA en homologación, porque ADHOC no los trae.
  - Libro IVA digital, Mis Comprobantes y SIRE sobre CE.
  - Flujo CAEA de contingencia para el POS sin conexión.
  - Revisar si `l10n_ar_tax` (IIBB y percepciones) vale lo que arrastra: tres repos más de ADHOC.
- **Licencia:** AGPL-3. Si se modifica un módulo de ADHOC y se ofrece por red, hay que publicar esos cambios. Por eso nada se modifica en los módulos de ADHOC y todo va en los módulos propios. [A validar con legal] si PowerFy los ofrece como SaaS.
- **Seguridad:** el certificado y la clave de ARCA de cada cliente nunca van al repo. Se cargan por instancia desde el wizard de `l10n_ar_afipws`, con acceso restringido a un rol de `powerfy_roles`. El ambiente (homologación o producción) se controla con `afip.ws.env.type`: DEV y DEMO siempre en homologación.
- **Despliegue:**
  - Agregar `pyafipws` (fork propio en `bacgroup`, con commit fijo), `M2Crypto` y `pyOpenSSL` al Dockerfile de `powerfy-docker`.
  - Sumar los módulos a `TEST_MODULES` y `TEST_TAGS`.
  - Actualizar ADHOC con un merge controlado por RQ, no con un *pull* automático.
- **Mantenimiento:** se sigue la rama 18.0 de ADHOC, y su 19.0 ya existe para cuando PowerFy migre.
- **Cómo se revierte:** se desinstalan los módulos AR. Los comprobantes ya emitidos conservan su CAE en `account.move`. La migración a la opción 2 o a la 5 se escribiría como un ADR que reemplaza a este.
