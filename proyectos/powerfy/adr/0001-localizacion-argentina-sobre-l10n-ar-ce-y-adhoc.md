# 0001. Localización Argentina con módulos propios sobre l10n_ar de Odoo CE, con OCA/ADHOC sólo como referencia

- Fecha: 2026-11-24 (revisión 2 del mismo día)
- RQ: PF-L10N-AR
- Estado: propuesta. Pasa a `aceptada` cuando la POC en homologación de ARCA funcione y el usuario apruebe el spec.

## Contexto

BACG necesita vender PowerFy (Odoo 18 CE) en Argentina. PowerFy no tiene hoy localización fiscal ni facturación electrónica con ARCA (ex AFIP), ni en el backend ni en el POS. El usuario pidió partir de OCA, tomar lo publicado por ADHOC como referencia y **no depender de sus módulos**.

Qué hay disponible (relevado el 2026-11-24, clonando las ramas):

| Fuente | Qué trae | Licencia | Estado |
|---|---|---|---|
| Odoo CE (`odoo/odoo` 18.0) | `l10n_ar` (plan de cuentas, responsabilidades frente al IVA, tipos de comprobante, PDF con QR y leyenda de la Ley 27.743), `l10n_ar_withholding`, `l10n_ar_pos`, `l10n_ar_website_sale`, `l10n_latam_check` | LGPL-3 | Mantenido por Odoo. Se usa como base. |
| Odoo Enterprise | `l10n_ar_edi` (factura electrónica). No está en CE: el manifiesto en 18.0 devuelve 404. | Propietaria | No aplica. |
| `OCA/l10n-argentina` | **18.0, 17.0 y 15.0 vacías.** La última versión con módulos es la **16.0**: `l10n_ar_afipws`, `l10n_ar_afipws_fe` y `l10n_ar_bank`. La 14.0 suma `l10n_ar_ledger` (Libro IVA Digital), `l10n_ar_partner` y `l10n_ar_invoice_report`. | AGPL-3 | Sin tests y sin POS. Es el mismo linaje que ADHOC, que figura como coautor. |
| `ingadhoc/odoo-argentina-ce` 18.0 | Conexión con ARCA, factura electrónica (WSFE, WSFEX, WSBFE y WSMTXCA, `CondicionIVAReceptor` de la RG 5616), factura desde el POS y reportes | AGPL-3 | Activo (2026-11-18). Sin tests. El CAEA aparece sólo como campo, sin el flujo. |
| `ingadhoc/odoo-argentina` 18.0 | `l10n_ar_tax` (percepciones, IIBB, padrones) y `l10n_ar_ux` | AGPL-3 | Activo. Arrastra otros repos de ADHOC. |
| `ingadhoc/odoo-argentina-ee` 18.0 | Libro IVA Digital, SIRE, ARBA | AGPL/LGPL | Requiere EE. Sirve sólo como referencia funcional. |
| `pyafipws` (fork `ingadhoc@odoo18`) | Cliente Python de los WS de ARCA (WSAA, WSFEv1, padrón, etc.) | **LGPL-3+** | Se puede usar como librería sin cambiar la licencia de PowerFy. |

Restricciones:

- PowerFy es CE y no puede exigir una licencia EE por cliente.
- **Licencia:** OCA y ADHOC son AGPL-3. Copiar su código dentro de módulos de PowerFy convierte esos módulos en obra derivada AGPL-3: hay que mantener la licencia y los créditos, y ofrecer el código fuente a los usuarios por red (SaaS). Leerlos para entender el protocolo y los casos de ARCA no tiene esa consecuencia.
- Cada cliente tiene su certificado y su clave de ARCA, que son secretos.
- Ya existe un patrón en `powerfy-l10n` (`vitt_l10n_*` para Centroamérica).

## Opciones

1. **Instalar los módulos CE de ADHOC vendorizados** (revisión 1 de este ADR).
   - Pros: lo más rápido.
   - Contras: dependencia de terceros que el usuario descartó. AGPL en el producto. Sin tests. Libro IVA y SIRE requieren EE.
2. **Módulos propios `powerfy_l10n_ar_*` sobre `l10n_ar` de CE**, implementados desde las especificaciones oficiales de ARCA, usando OCA (16.0 y 14.0) y ADHOC (18.0) **sólo como referencia funcional, sin copiar código**, y `pyafipws` como librería (LGPL).
   - Pros: código y licencia propios, tests propios, alcance a medida (POS, CAEA, Libro IVA y SIRE sobre CE).
   - Contras: el costo más alto. BACG sigue sola los cambios normativos.
3. **Portar el código AGPL de OCA/ADHOC a módulos de PowerFy** (copia con modificaciones).
   - Pros: arranque rápido.
   - Contras: esos módulos quedan AGPL-3, con obligación de publicar el código a los clientes SaaS. Además se hereda deuda sin tests.
4. **Odoo Enterprise `l10n_ar_edi`.**
   - Contras: rompe el modelo CE.
5. **Proveedor SaaS de facturación electrónica.**
   - Pros: poco desarrollo.
   - Contras: costo por comprobante, dependencia de un tercero y POS con doble dependencia externa.

## Decisión

Opción 2. Cumple el pedido de no depender de ADHOC y deja a PowerFy con código y licencia propios. La regla es **referencia sí, copia no**: el equipo lee OCA y ADHOC para entender casos y validaciones, pero escribe el código desde los manuales de ARCA. Si legal confirma que PowerFy puede publicar estos módulos como AGPL-3, se habilita la opción 3 en un ADR que reemplace a este. La opción 5 queda como plan B si la POC no homologa.

**Alcance de la v1** (definido por el usuario el 24/11):

| Orden | Módulo propio (nombre tentativo) | Qué hace | Referencia |
|---|---|---|---|
| 0 | POC | WSAA y WSFEv1 en homologación: factura A/B/C y nota de crédito desde el backend y el POS | Manual WSFEv1 de ARCA, `l10n_ar_afipws_fe` |
| 1 | `powerfy_l10n_ar_ws` | Certificados por compañía, WSAA (token y firma con caché), padrón (consulta de CUIT) y ambiente homologación/producción | `l10n_ar_afipws` |
| 2 | `powerfy_l10n_ar_fe` | CAE para A, B, C, M, E (WSFEX), FCE MiPyME, NC y ND, RG 5616 y QR. Reintento idempotente: antes de emitir se consulta el último comprobante autorizado | `l10n_ar_afipws_fe` |
| 3 | `powerfy_l10n_ar_pos` | Factura del ticket con CAE sobre `l10n_ar_pos`, y **CAEA**: pedido quincenal, emisión sin conexión y rendición (informar los comprobantes y los períodos sin movimiento) | `l10n_ar_pos_afipws_fe` y el manual del CAEA |
| 4 | `powerfy_l10n_ar_iva` | Libro IVA Digital (archivos de ventas, compras y alícuotas) y SIRE (retenciones y percepciones de IVA) sobre CE | `l10n_ar_ledger` (OCA 14.0), `l10n_ar_txt_sire` (EE) |
| 5 | `powerfy_l10n_ar_iibb` | Percepciones y retenciones de IIBB, padrones (ARBA/AGIP), Convenio Multilateral y la retención en pagos sobre `l10n_ar_withholding` de CE | `l10n_ar_tax` |

## Consecuencias

- **Se vuelve más fácil:** sin dependencia de ADHOC. Licencia y versionado propios. Tests desde el día uno (la referencia no los trae). Libro IVA y SIRE sobre CE, que hoy nadie ofrece abierto en la 18.0.
- **Se vuelve más difícil:**
  - Es la opción de mayor esfuerzo: v1 de seis piezas, donde IIBB y CAEA son las más complejas.
  - Hay que seguir las RG de ARCA y de las provincias: hace falta un responsable funcional de normativa.
  - La regla "sin copia" hay que poder demostrarla: el código se escribe desde la especificación y en la revisión de cada PR se chequea que no haya bloques copiados de OCA ni de ADHOC.
- **Seguridad:**
  - Certificado y clave de ARCA por compañía, nunca en el repo. Acceso sólo con un rol de `powerfy_roles`.
  - DEV y DEMO siempre en homologación, con una compuerta que impida emitir en producción desde esos ambientes.
- **Despliegue:**
  - `pyafipws` en un fork propio de `bacgroup`, con commit fijo, sin modificarlo (si se modifica, esos cambios se publican por LGPL). También `pyOpenSSL` y `M2Crypto`, o `cryptography`, en el Dockerfile.
  - Módulos nuevos en `TEST_MODULES` y `TEST_TAGS`.
  - Los tests contra ARCA en homologación se separan de los unitarios, porque dependen de la red y del certificado.
- **Cómo se revierte:** los comprobantes emitidos guardan su CAE o CAEA en `account.move`. Cambiar de opción es un ADR nuevo que reemplaza a este.
- **Pendiente:**
  - Decisión legal sobre la licencia de los módulos PowerFy (propietaria o AGPL), que habilita o no la opción 3.
  - Confirmar con un contador las RG vigentes al momento del desarrollo.
