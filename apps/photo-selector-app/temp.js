const fs=require('fs');
let b=fs.readFileSync('src/workers/raw-jpeg-extractor.ts','utf8');
const add = \

function isDecodableJpeg(data: Uint8Array, offset: number, length: number): boolean {
  if (length < 10) return false;
  if (data[offset] !== 0xFF || data[offset + 1] !== 0xD8) return false;
  let i = offset + 2;
  const end = Math.min(offset + length, data.length);
  while (i < end - 1) {
    if (data[i] !== 0xFF) { i++; continue; }
    while (i < end - 1 && data[i] === 0xFF) i++;
    if (i >= end) break;
    const marker = data[i++];
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) return true;
    if (marker === 0xC3) return false;
    if (marker === 0xD9 || marker === 0xDA) break;
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    if (i + 1 >= end) break;
    const len = (data[i] << 8) | data[i + 1];
    if (len < 2) break;
    i += len;
  }
  return false;
}
\;
fs.writeFileSync('src/workers/raw-jpeg-extractor.ts', b + add);
