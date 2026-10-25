// Build index.html from tools/index.template.html, splicing in the chart LUT <svg> block from the
// legacy page BYTE FOR BYTE (its direction — pale deep, saturated shallow — is a safety property).
import fs from 'node:fs';
const legacy = fs.readFileSync('legacy/index.html', 'utf8');
const start = legacy.indexOf('<!-- Chart colour lookup.');
const end = legacy.indexOf('</defs></svg>', start);
if (start < 0 || end < 0) throw new Error('LUT block not found in legacy/index.html');
const lut = legacy.slice(start, end + '</defs></svg>'.length);
if (!lut.includes('id="lut-day"') || !lut.includes('id="lut-night"')) throw new Error('LUT filters missing');
const out = fs.readFileSync('tools/index.template.html', 'utf8').replace('<!--LUT-->', lut);
fs.writeFileSync('index.html', out);
console.log('index.html written, LUT block', lut.length, 'chars');
