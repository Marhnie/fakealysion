// Writes docs/qa-slice1-classification.json ({qid: 'T'|'R'|'N'}) for data/rulings/slice1.json (which stays local / gitignored).
// T = a concrete board situation with a stated outcome (heuristic: card in DB, question is situational), R = rule/explanation-only question,
// N = not applicable (no effect text in our DB edition, or the Korean printed text differs from the Japanese one asked about). Heuristic, then hand-overrides below.
import * as fs from 'fs';
import * as S from '../../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const a = JSON.parse(fs.readFileSync('data/rulings/slice1.json', 'utf8'));
const R_RE = /とは何ですか|どういった効果|どういう効果|どのような効果|どのカード|どれですか|どういうことですか|〈ルール〉|固有のルール|とはどういう|どういう意味|どのような意味|どうやって進化/;
const N_OVERRIDE = new Set([999, 1000]); // BT2-020: printed Korean text (trash-count condition) differs from the Japanese wording asked about
const out = {}; const cnt = { T: 0, R: 0, N: 0 };
for (const e of a) {
  const ids = (e.cards.length ? e.cards : [e.card]).map(c => c.split(' ')[0]);
  const have = ids.filter(i => S.CARDS[i] && (S.CARDS[i].effectKo || S.CARDS[i].inheritedKo));
  let k = 'T';
  if (!have.length || N_OVERRIDE.has(e.id)) k = 'N'; else if (R_RE.test(e.q)) k = 'R';
  out[e.id] = k; cnt[k]++;
}
// a question that has a built scenario is testable by definition
const builtQ = new Set(); for (const f of fs.readdirSync('scripts/qa')) { if (!f.startsWith('qa-slice1-') || f === 'qa-slice1-classify.mjs') continue; const src = fs.readFileSync('scripts/qa/' + f, 'utf8'); for (const m of src.matchAll(/T\((\d{3,4}),|\[(\d{3,4}), '/g)) builtQ.add(Number(m[1] || m[2])); }
for (const q of builtQ) if (out[q] && out[q] !== 'T') { cnt[out[q]]--; out[q] = 'T'; cnt.T++; }
fs.mkdirSync('docs', { recursive: true }); fs.writeFileSync('docs/qa-slice1-classification.json', JSON.stringify(out, null, 0));
console.log(a.length, JSON.stringify(cnt), out[671], typeof out[671]);
