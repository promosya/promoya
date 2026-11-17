// Planillas de Excel (.xlsx) sin librerías: armar la planilla base / exportar, y leer lo que sube el usuario.
// Un .xlsx es un ZIP con archivos XML adentro.

// ---------- ZIP ----------
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function armarZip(archivos) {
  const enc = new TextEncoder();
  const partes = [], central = [];
  let offset = 0;
  for (const [nombre, contenido] of archivos) {
    const n = enc.encode(nombre), d = enc.encode(contenido), crc = crc32(d);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, d.length, true); local.setUint32(22, d.length, true); local.setUint16(26, n.length, true);
    partes.push(new Uint8Array(local.buffer), n, d);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, d.length, true); cen.setUint32(24, d.length, true); cen.setUint16(28, n.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), n);
    offset += 30 + n.length + d.length;
  }
  const tamCentral = central.reduce((a, b) => a + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function leerZip(buffer) {
  const v = new DataView(buffer), b = new Uint8Array(buffer);
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('El archivo no es un Excel válido');
  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const dec = new TextDecoder();
  const salida = {};
  for (let k = 0; k < total; k++) {
    const metodo = v.getUint16(p + 10, true), comp = v.getUint32(p + 20, true);
    const ln = v.getUint16(p + 28, true), le = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const nombre = dec.decode(b.subarray(p + 46, p + 46 + ln));
    p += 46 + ln + le + lc;
    if (!/^xl\/(sharedStrings|workbook|worksheets\/sheet\d+)\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(nombre)) continue;
    const ini = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const datos = b.subarray(ini, ini + comp);
    if (metodo === 0) salida[nombre] = dec.decode(datos);
    else if (metodo === 8) salida[nombre] = await new Response(new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }
  return salida;
}

// ---------- Escribir .xlsx ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const letra = (i) => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

function hojaXml(filas, { anchos = [], validaciones = '', fijarCabecera = true } = {}) {
  const cols = anchos.length ? `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const vista = fijarCabecera ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const datos = filas.map((f, r) => `<row r="${r + 1}">${f.map((v, c) => {
    const estilo = r === 0 && fijarCabecera ? ' s="1"' : (f.estilo ? ` s="${f.estilo}"` : '');
    return `<c r="${letra(c)}${r + 1}" t="inlineStr"${estilo}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${vista}${cols}<sheetData>${datos}</sheetData>${validaciones}</worksheet>`;
}

export function armarXlsx(hojas) {
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hojas.map((h, i) => `<sheet name="${esc(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  // Estilos: 0 normal, 1 cabecera (negrita, fondo naranja), 2 título, 3 texto con ajuste de línea
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF6A00"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return armarZip([
    ['[Content_Types].xml', ct], ['_rels/.rels', rels], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wbRels], ['xl/styles.xml', estilos],
    ...hojas.map((h, i) => [`xl/worksheets/sheet${i + 1}.xml`, hojaXml(h.filas, h.opciones)]),
  ]);
}

export const COLUMNAS_PLANILLA = ['nombre', 'email', 'soundcloud', 'tipo', 'pais', 'etiquetas', 'notas'];
export const TIPOS_PLANILLA = ['DJ', 'Sello', 'Radio', 'Prensa', 'Otro'];

// Planilla para sellos: solo nombre y email (país y notas, opcionales)
export function plantillaSellos() {
  const instrucciones = [
    ['Cómo completar esta planilla de sellos'],
    [''],
    ['1. Andá a la hoja «Sellos» (pestaña de abajo).'],
    ['2. Borrá la fila de ejemplo y escribí un sello por fila: el nombre del sello y el email donde reciben demos.'],
    ['3. país y notas son opcionales (por ejemplo: «solo tech house», «responden rápido»).'],
    ['4. Guardá el archivo como está (.xlsx).'],
    ['5. En PromoYa: Sellos → Importar → elegí este archivo → Importar.'],
  ].map((f, i) => Object.assign(f, { estilo: i === 0 ? 2 : 3 }));
  return armarXlsx([
    { nombre: 'Sellos', filas: [['nombre', 'email', 'pais', 'notas'], ['Sello Ejemplo Records', 'demos@selloejemplo.com', 'Reino Unido', 'Tech house']], opciones: { anchos: [32, 36, 18, 40] } },
    { nombre: 'Instrucciones', filas: instrucciones, opciones: { anchos: [110], fijarCabecera: false } },
  ]);
}

export function plantillaContactos() {
  const listaTipos = `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Tipo" error="Elegí uno de la lista" sqref="D2:D2000"><formula1>"${TIPOS_PLANILLA.join(',')}"</formula1></dataValidation></dataValidations>`;
  const instrucciones = [
    ['Cómo completar esta planilla'],
    [''],
    ['1. Andá a la hoja «Contactos» (pestaña de abajo).'],
    ['2. Borrá las dos filas de ejemplo y escribí un contacto por fila. No cambies los títulos de la fila 1.'],
    ['3. email es obligatorio. Lo demás es opcional, pero cargá el soundcloud de cada uno: así PromoYa sabe quién te escuchó.'],
    ['4. soundcloud: el link del perfil (soundcloud.com/usuario) o solo el usuario.'],
    ['5. tipo: elegilo de la lista (DJ, Sello, Radio, Prensa u Otro). Si lo dejás vacío queda como DJ.'],
    ['6. etiquetas: palabras separadas por coma (por ejemplo: tech house, residente). Sirven para armar grupos.'],
    ['7. Guardá el archivo como está (Ctrl+G o Ctrl+S). Tiene que quedar como .xlsx.'],
    ['8. En PromoYa: Contactos → Importar → elegí este archivo → revisá la lista → Importar.'],
    [''],
    ['Si un email ya estaba cargado, se actualizan sus datos (no se duplica).'],
  ].map((f, i) => Object.assign(f, { estilo: i === 0 ? 2 : 3 }));
  return armarXlsx([
    { nombre: 'Contactos', filas: [COLUMNAS_PLANILLA, ['DJ Ejemplo', 'dj.ejemplo@gmail.com', 'soundcloud.com/djejemplo', 'DJ', 'Argentina', 'tech house, residente', 'Lo conocí en un evento'], ['Sello Ejemplo', 'demos@selloejemplo.com', '', 'Sello', 'España', 'minimal', '']], opciones: { anchos: [26, 32, 34, 12, 16, 26, 36], validaciones: listaTipos } },
    { nombre: 'Instrucciones', filas: instrucciones, opciones: { anchos: [110], fijarCabecera: false } },
  ]);
}

export function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- Leer .xlsx / .csv ----------
export async function leerXlsx(buffer) {
  const z = await leerZip(buffer);
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const compartidos = z['xl/sharedStrings.xml'] ? [...xml(z['xl/sharedStrings.xml']).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
  // Elegir la hoja «Contactos» si existe; si no, la primera
  let archivo = 'xl/worksheets/sheet1.xml';
  if (z['xl/workbook.xml'] && z['xl/_rels/workbook.xml.rels']) {
    const hojas = [...xml(z['xl/workbook.xml']).getElementsByTagName('sheet')];
    const rels = Object.fromEntries([...xml(z['xl/_rels/workbook.xml.rels']).getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const hoja = hojas.find((h) => /contactos/i.test(h.getAttribute('name'))) || hojas[0];
    const id = hoja && (hoja.getAttribute('r:id') || hoja.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    if (id && rels[id]) archivo = 'xl/' + rels[id].replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  if (!z[archivo]) throw new Error('No encontré la hoja de contactos en el Excel');
  const filas = [];
  for (const row of xml(z[archivo]).getElementsByTagName('row')) {
    const f = [];
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '';
      const col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let valor = t === 's' ? compartidos[Number(v)] ?? '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : v;
      f[col >= 0 ? col : f.length] = valor;
    }
    filas.push(Array.from(f, (x) => x ?? ''));
  }
  return filas.filter((f) => f.some((x) => String(x).trim()));
}

// Devuelve el texto del CSV respetando acentos aunque Excel lo haya guardado en el formato viejo de Windows
export async function textoDeCsv(archivo) {
  const buf = await archivo.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8.replace(/^﻿/, '');
}
