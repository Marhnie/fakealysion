// Writes docs/qa-slice5-classification.json ({qid: 'T'|'R'|'N'}). Heuristic: definitional / order-choice / naming questions are R (rule-only), everything with a concrete board outcome is T.
// N overrides (card text differs in KR edition / unimplemented content) are read from scripts/qa/_N5.json if present.
import * as fs from 'fs';
const a = JSON.parse(fs.readFileSync('data/rulings/slice5.json', 'utf8'));
const R_RE = [/とは、どういった/, /どういったカード(?:を指|ですか)/, /どういった状況を指し/, /どの状態であることを指し/, /プレイヤーが発揮する順を選ぶことができます/, /どういった効果ですか/];
const R_ONLY_A = /^同時誘発となるので、プレイヤーが発揮する順を選ぶことができます。?\s*$/;
let N = {}; try { N = JSON.parse(fs.readFileSync('scripts/qa/_N5.json', 'utf8')); } catch {}
const out = {}; const cnt = { T: 0, R: 0, N: 0 };
for (const e of a) {
  let c = 'T';
  if (R_RE.some(r => r.test(e.q)) || R_ONLY_A.test(e.a.replace(/\n/g, ' '))) c = 'R';
  if (/(どの順で発揮|どの順番で処理)/.test(e.q) && /(同時誘発)/.test(e.a) && !/ただし|できません|いいえ/.test(e.a)) c = 'R';
  if (N[e.id]) c = 'N';
  out[e.id] = c; cnt[c]++;
}
fs.writeFileSync('docs/qa-slice5-classification.json', JSON.stringify(out, null, 0));
console.log(a.length, JSON.stringify(cnt));
