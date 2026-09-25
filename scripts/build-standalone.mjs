// Builds dist/digimon-sim-standalone.html: ONE self-contained file that runs via double-click
// (file:// — no server, no hosting, no GitHub Pages URL). For sending to friends for playtesting.
// This is a dev-only extra build, separate from the normal no-build-step site (still deployed via
// scripts/deploy-pages.mjs as before) — it does not change how src/*.js or index.html are served normally.
//
// Two things break under file://+ES modules that don't break on a real server:
//   1. <script type="module"> imports across files are blocked by the browser under file://.
//      Fix: bundle the whole src/main.js import graph into one IIFE with esbuild.
//   2. fetch('./data/*.json') (src/state.js, src/cpudeck.js, src/cpu.js) is blocked under file://.
//      Fix: embed those JSON files' contents at build time and inject an esbuild `inject`-shim that
//      overrides globalThis.fetch for exactly those known relative URLs, falling through to the real
//      fetch for everything else (card art on dgchub.com/digimoncard.com, the JSZip CDN script, and the
//      deck-recipe .docx template all still go over the real network exactly as before — recipients need
//      internet for those, same as the hosted site).
// The maintained source files (src/state.js etc.) are NOT edited — the shim only exists inside this one bundle.
//
// 사용: node scripts/build-standalone.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rp = (...p) => path.join(root, ...p);

// Exact relative URLs the app fetch()es at startup (grepped from src/*.js — see header comment above).
// Keys MUST match the literal string passed to fetch()/loadCpuDecks() in the source exactly.
const EMBED = {
  './data/cards_full.json': rp('data/cards_full.json'),   // src/state.js loadData()
  './data/decks.json': rp('data/decks.json'),               // src/state.js loadData()
  './data/parallels.json': rp('data/parallels.json'),       // src/state.js loadData() (optional art variants)
  './data/cpu-params.json': rp('data/cpu-params.json'),     // src/cpu.js loadParams() (optional: 전문가 tuned params)
  './data/cpu-decks.json': rp('data/cpu-decks.json'),       // src/cpudeck.js loadCpuDecks(), called from main.js init()
};
// NOT embedded, deliberately:
//  - data/human-deck-stats.json (src/cpudeck.js loadHumanStats): not called anywhere at startup (dead export,
//    no callers in src/*.js as of this build) — nothing to break, so left untouched.
//  - assets/deck-recipe-template.docx (src/deckrecipe.js exportDeckRecipeDocx): binary, on-demand only (player
//    clicks "레시피 다운로드(docx)" in the deck builder). Its fetch() is already wrapped in try/catch that
//    returns { ok:false, error } instead of throwing, so under file:// it just shows a Korean error message —
//    verified in src/deckrecipe.js, not touched here. Not worth base64-embedding a rarely-used export feature.

for (const [url, file] of Object.entries(EMBED)) {
  if (!fs.existsSync(file)) throw new Error(`build-standalone: missing data file for ${url}: ${file}`);
}

// esbuild plugin: resolves a virtual module that (1) defines DATA = {<url>: <raw JSON>, ...} straight from the
// files above (JSON is valid JS object/array syntax, so this is plain string concatenation, no parse+restringify)
// and (2) monkey-patches globalThis.fetch to serve DATA for those exact URLs and fall through to the real fetch
// for everything else. Loaded via esbuild's `inject`, so it runs before any src/*.js module-level code.
const SHIM_ID = 'standalone-fetch-shim';
function embedDataPlugin() {
  return {
    name: 'embed-standalone-data',
    setup(build) {
      build.onResolve({ filter: new RegExp(`^${SHIM_ID}$`) }, (args) => ({ path: args.path, namespace: SHIM_ID }));
      build.onLoad({ filter: /.*/, namespace: SHIM_ID }, () => {
        let src = 'const DATA = {\n';
        for (const [url, file] of Object.entries(EMBED)) {
          src += `  ${JSON.stringify(url)}: ${fs.readFileSync(file, 'utf8').trim()},\n`;
        }
        src += '};\n';
        src += `
const __realFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
globalThis.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (Object.prototype.hasOwnProperty.call(DATA, url)) {
    return Promise.resolve(new Response(JSON.stringify(DATA[url]), { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } }));
  }
  if (!__realFetch) return Promise.reject(new Error('standalone build: no network fetch available for ' + url));
  return __realFetch(input, init);
};
export {};
`;
        return { contents: src, loader: 'js' };
      });
    },
  };
}

console.log('bundling src/main.js …');
const result = await esbuild.build({
  entryPoints: [rp('src/main.js')],
  bundle: true,
  format: 'iife',
  write: false,
  // no `target`: this is a bundle, not a transpile — pass the codebase's own syntax (optional chaining,
  // nullish coalescing, async/await, etc.) straight through for modern browsers, same as the hosted site.
  inject: [SHIM_ID],
  plugins: [embedDataPlugin()],
  logLevel: 'info',
});
const bundleJs = result.outputFiles[0].text;

const cssFiles = ['src/styles.css', 'src/fx.css', 'src/securityui.css', 'src/mobilebar.css', 'src/peek.css'];
const css = cssFiles.map((f) => `/* ${f} */\n${fs.readFileSync(rp(f), 'utf8')}`).join('\n');

const srcHtml = fs.readFileSync(rp('index.html'), 'utf8');
const titleMatch = srcHtml.match(/<title>([^<]*)<\/title>/);
const title = titleMatch ? titleMatch[1] : '디지몬 카드게임 시뮬레이터';
const langMatch = srcHtml.match(/<html\s+lang="([^"]*)"/);
const lang = langMatch ? langMatch[1] : 'ko';
const viewportMatch = srcHtml.match(/<meta name="viewport"[^>]*>/);
const viewport = viewportMatch ? viewportMatch[0] : '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />';

const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
${viewport}
<title>${title}</title>
<!-- Standalone build (scripts/build-standalone.mjs): double-click and play, no server needed.
     Card data is embedded below; card art still loads from the internet (dgchub.com / digimoncard.com),
     same as the hosted site. Regenerate with: node scripts/build-standalone.mjs -->
<style>
${css}
</style>
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
  <script>
${bundleJs}
  </script>
</body>
</html>
`;

const outDir = rp('dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'digimon-sim-standalone.html');
fs.writeFileSync(outFile, html);
const kb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
console.log(`wrote ${outFile} (${kb} MB)`);
