'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

function isPng(data) {
  return data.length >= 33 && data.subarray(0, 8).equals(pngSignature)
    && data.toString('ascii', 12, 16) === 'IHDR' && data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0;
}

async function readIcon(filename, label = 'icon', { icoOnly = false } = {}) {
  const extension = path.extname(filename).toLowerCase();
  if (extension !== '.ico' && (icoOnly || extension !== '.png')) {
    throw new Error(label + (icoOnly ? ' debe ser un archivo .ico.' : ' debe ser un archivo .ico o .png.'));
  }
  let data;
  try { data = await fs.readFile(filename); }
  catch (error) { throw new Error('No se puede leer ' + label + ' «' + filename + '»: ' + error.code + '.'); }
  let valid = false;
  if (extension === '.png') valid = isPng(data);
  else if (data.length >= 22 && data.readUInt16LE(0) === 0 && data.readUInt16LE(2) === 1) {
    const count = data.readUInt16LE(4);
    const headerSize = 6 + count * 16;
    valid = count > 0 && headerSize <= data.length;
    for (let index = 0; valid && index < count; index++) {
      const entry = 6 + index * 16;
      const size = data.readUInt32LE(entry + 8);
      const offset = data.readUInt32LE(entry + 12);
      valid = size >= 12 && offset >= headerSize && offset + size <= data.length;
      if (valid) {
        const bitmap = data.subarray(offset, offset + size);
        valid = isPng(bitmap) || [12, 40, 108, 124].includes(bitmap.readUInt32LE(0));
      }
    }
  }
  if (!valid) throw new Error(label + ' no contiene un icono válido: ' + filename);
  return data;
}

module.exports = { readIcon };
