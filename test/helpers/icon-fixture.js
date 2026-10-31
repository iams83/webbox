'use strict';

// ICO de 256×256 con bitmap BGRA opaco, para probar recursos sin herramientas gráficas.
function createIco(red = 40, green = 100, blue = 200) {
  const pixels = 256 * 256 * 4;
  const mask = 32 * 256;
  const data = Buffer.alloc(22 + 40 + pixels + mask);
  data.writeUInt16LE(1, 2);
  data.writeUInt16LE(1, 4);
  data.writeUInt16LE(1, 10);
  data.writeUInt16LE(32, 12);
  data.writeUInt32LE(40 + pixels + mask, 14);
  data.writeUInt32LE(22, 18);
  data.writeUInt32LE(40, 22);
  data.writeInt32LE(256, 26);
  data.writeInt32LE(512, 30);
  data.writeUInt16LE(1, 34);
  data.writeUInt16LE(32, 36);
  data.writeUInt32LE(pixels + mask, 42);
  for (let offset = 62; offset < 62 + pixels; offset += 4) {
    data[offset] = blue; data[offset + 1] = green; data[offset + 2] = red; data[offset + 3] = 255;
  }
  return data;
}

module.exports = { createIco };
