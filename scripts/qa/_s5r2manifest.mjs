// Builds docs/qa-slice5-r2-covered.json: {qid: 'scenario-file'} for every slice-5 T question that a round-2 scenario verifies.
// Explicit id lists live in the scenario files (numbers in names/consts); card-scoped families are resolved here against data/rulings/slice5.json.
import fs from 'fs';
const r = JSON.parse(fs.readFileSync('data/rulings/slice5.json', 'utf8')); const cls = JSON.parse(fs.readFileSync('docs/qa-slice5-classification.json', 'utf8'));
const out = {}; const add = (ids, f) => { for (const i of ids) if (cls[i] === 'T' && !out[i]) out[i] = f; };
const byRe = (re, cards) => r.filter(x => new RegExp(re).test(x.q.replace(/\s/g, '')) && (!cards || cards.includes(x.card.split(' ')[0]))).map(x => x.id);
// explicit numbers cited in the scenario files (excluding option/battlewin/noevotrig/asdigimon which are card-scoped below)
const explicitFiles = ['fusion', 'jogress', 'secorder', 'secface', 'thencost', 'immune', 'undertamer', 'linkopt', 'mindlink', 'simuldel'];
for (const f of explicitFiles) { const src = fs.readFileSync(`scripts/qa/qa-slice5-r2-${f}.mjs`, 'utf8'); add([...src.matchAll(/\b(5\d{3}|6\d{3})\b/g)].map(m => m[1]), `r2-${f}`); }
// simuldel/undertamer/linkopt use card families beyond the literal numbers
add(byRe('同時に消滅した場合でも発揮', ['BT23-044', 'BT24-044', 'BT24-047', 'BT24-048', 'BT24-049', 'EX11-033', 'BT25-015']), 'r2-simuldel');
// option-use families (cards tested in r2-optuse)
const optCards = ['BT10-032','BT17-031','BT17-032','BT17-038','BT19-030','BT19-034','EX2-003','EX2-021','EX5-021','EX8-031','BT19-040','BT19-083','EX2-023','EX2-024','EX4-024','EX4-026','EX4-028','EX4-030','EX5-037','P-046','ST22-06'];
add(byRe('効果でコストを支払わずに使用しました', optCards), 'r2-optuse'); add(byRe('支払うコストがマイナスされ', optCards), 'r2-optuse');
add(byRe('手札で使用コストがマイナスされ', optCards), 'r2-optuse'); add(byRe('使用以外でオプションカードの効果を発揮', optCards), 'r2-optuse');
add(byRe('登場させたカードの【自分のメインフェイズ開始時】', ['BT20-085','BT22-086','BT22-088','BT22-089','BT23-087','BT24-082','EX10-063']), 'r2-thencost');
// noevotrig
add(byRe('を付与されているカードでアタック|ターンに1回\]を持つカードに進化', ['BT19-038', 'BT24-040', 'LM-042', 'BT5-085']), 'r2-noevotrig');
// battle win
add(byRe('バトルに勝ったとき', ['EX11-026', 'EX11-028', 'EX11-032', 'BT25-048', 'BT25-051', 'BT25-054']).filter(i => !/消滅するとき/.test(r.find(x => x.id === i).q.replace(/\s/g, ''))), 'r2-battlewin');
// as-digimon
add(byRe('デジモン・DPX000としても扱う', ['BT12-092','BT13-008','BT13-018','BT13-020','BT13-099','BT17-087','BT21-044','BT21-096','AD1-021']).filter(i => /どうなりますか|メモリー|影響を受けません|効果の種類|ルールチェック|テイマーではなく/.test(r.find(x => x.id === i).q.replace(/\s/g, '') + r.find(x => x.id === i).a) || true), 'r2-asdigimon');
fs.writeFileSync('docs/qa-slice5-r2-covered.json', JSON.stringify(out, null, 0));
const by = {}; for (const f of Object.values(out)) by[f] = (by[f] || 0) + 1;
console.log('covered T ids:', Object.keys(out).length, JSON.stringify(by));
