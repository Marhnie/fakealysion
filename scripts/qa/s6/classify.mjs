// Builds docs/qa-slice6-classification.json ({qid: 'T'|'R'|'N'}) and prints the counts used by docs/qa-slice6-report.md.
// Run from repo root after the scenario files (node scripts/qa/qa-slice6-*.mjs) have written scripts/qa/s6/_res-*.json:   node scripts/qa/s6/classify.mjs < /dev/null
// The rulings JSON itself (data/rulings, gitignored) is only read here, never copied.
import * as fs from 'fs';
import * as S from '../../../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const all = JSON.parse(fs.readFileSync('data/rulings/slice6.json', 'utf8'));
const groups = JSON.parse(fs.readFileSync('scripts/qa/s6/_groups.json', 'utf8')); // [{ids:[...], cards:[...]}], index = G#
// R = general rule / definition / player-choice ordering / UI-only (covered by the rule oracle or not observable on the engine)
const R = new Set([4, 7, 21, 34, 42, 43, 48, 49, 50, 51, 55, 62, 63, 66, 67, 79, 90, 91, 93, 94, 95, 101, 134, 137, 155, 156, 171, 175, 176, 187, 200, 201, 211, 244, 245, 251, 254, 255, 256, 258, 259, 269, 277, 284, 288, 291, 292, 293, 305, 307, 311, 332, 333, 334]);
// N = the Korean DB has no effect text for the card (P-240..P-244) -> nothing to test
const N = new Set([214, 215, 216, 217, 218, 219]);
const cls = {};
for (const x of all) { const id = x.card.split(' ')[0]; if (!S.CARDS[id]) cls[x.id] = 'N'; }
groups.forEach((g, i) => { const c = N.has(i) ? 'N' : R.has(i) ? 'R' : 'T'; for (const q of g.ids) cls[q] = c; });
// scenario results
const res = {}; // G# -> {ok}
for (const f of fs.readdirSync('scripts/qa/s6').filter((f) => /^_res-.*\.json$/.test(f))) for (const r of JSON.parse(fs.readFileSync('scripts/qa/s6/' + f, 'utf8'))) { const g = Number(String(r.g).replace(/^G(\d+).*$/, '$1')); (res[g] ||= []).push(r); }
const built = new Set(Object.keys(res).map(Number));
const cnt = { total: all.length, N: 0, R: 0, T: 0, built: 0, pass: 0, gap: 0, fail: 0 };
for (const q of all) cnt[cls[q.id]]++;
groups.forEach((g, i) => { if (cls[g.ids[0]] !== 'T' || !res[i]) return; const rs = res[i]; const n = g.ids.length; cnt.built += n; if (rs.every((r) => r.ok || r.xfail)) { if (rs.some((r) => r.xfail && !r.ok)) cnt.gap += n; else cnt.pass += n; } else cnt.fail += n; });
fs.writeFileSync('docs/qa-slice6-classification.json', JSON.stringify(cls));
console.log(JSON.stringify(cnt), 'groups total', groups.length, 'groups built', [...built].filter((g) => cls[groups[g]?.ids[0]] === 'T').length);
console.log('unbuilt T groups:', groups.map((g, i) => (cls[g.ids[0]] === 'T' && !res[i] ? i : null)).filter((x) => x != null).join(','));
