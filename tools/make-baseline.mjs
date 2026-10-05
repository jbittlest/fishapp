// Dev-only: derive baseline.html (legacy markup + ESM engine) from the legacy index.html.
import fs from 'node:fs';
const src = fs.existsSync('legacy/index.html') ? 'legacy/index.html' : 'index.html';
let h = fs.readFileSync(src, 'utf8');
h = h.replace(/<link rel="stylesheet" href="\.\/libs\/leaflet\/leaflet\.css">\r?\n/, '')
  .replace(/<script src="\.\/libs\/leaflet\/leaflet\.js"><\/script>[\s\S]*?<script src="\.\/js\/app\.js"><\/script>/, '<script type="module" src="/src/baseline.js"></script>')
  .replace('href="./css/style.css"', 'href="/legacy/css/style.css"');
fs.writeFileSync('baseline.html', h);
console.log(h.match(/<script[^>]*>/g), h.includes('/legacy/css/style.css'));
