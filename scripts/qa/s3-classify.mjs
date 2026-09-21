// Builds docs/qa-slice3-classification.json ({qid: 'T'|'R'|'N'}) and prints counts. R = definitional / general-rule questions (no board outcome to assert).
import * as fs from 'fs';
const qa = JSON.parse(fs.readFileSync('data/rulings/slice3.json', 'utf8'));
const dir = 'scripts/qa'; const built = new Set();
for (const f of fs.readdirSync(dir).filter(x => /^qa-slice3-.*\.mjs$/.test(x))) for (const m of fs.readFileSync(dir + '/' + f, 'utf8').matchAll(/await sc\('Q(\d+)'/g)) built.add(Number(m[1]));
const defRe = /(どういった(効果|固有|意味)|どういう(意味|こと|効果|ルール|カード)|具体的に(どういう|何|どの)|とは(、|何)|どんな効果|何を指して|どのような意味|どういうことですか|よくわかりません|どのカードが|どれですか|どちらのプレイヤー|どちらが選|どのタイミング|どの(場所|順|色)|参照すればいい)/;
const cls = {}; let T = 0, R = 0;
for (const q of qa) { if (built.has(q.id)) { cls[q.id] = 'T'; T++; } else if (defRe.test(q.q)) { cls[q.id] = 'R'; R++; } else { cls[q.id] = 'T'; T++; } }
fs.mkdirSync('docs', { recursive: true }); fs.writeFileSync('docs/qa-slice3-classification.json', JSON.stringify(cls));
console.log({ total: qa.length, T, R, N: 0, built: built.size });
