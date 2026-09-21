// 공식 카드 Q&A(digimoncard.com/rule/)를 상품별로 수집해 data/rulings/*.json 에 저장 (로컬 전용, 커밋 안 함)
import fs from 'node:fs';
const BASE = 'https://digimoncard.com/rule/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dec = (t) => t.replace(/<br\s*\/?>/g, '\n').replace(/<span>[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim();
const top = await (await fetch(BASE)).text();
const prods = [...top.matchAll(/<option value="(\d{6})"\s*>([^<]+)<\/option>/g)].map(m => ({ id: m[1], name: m[2].trim() }));
const uniq = [...new Map(prods.map(p => [p.id, p])).values()];
console.log('products', uniq.length);
fs.mkdirSync('data/rulings', { recursive: true });
let total = 0;
for (const p of uniq) {
  const f = `data/rulings/${p.id}.json`;
  if (fs.existsSync(f)) { total += JSON.parse(fs.readFileSync(f, 'utf8')).length; continue; }
  let html = '';
  for (let t = 0; t < 3 && !html; t++) { try { const r = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `prodid=${p.id}&is_card_search=true` }); if (r.ok) html = await r.text(); } catch (e) { /* retry */ } if (!html) await sleep(3000); }
  const out = [];
  const i0 = html.indexOf('id="qaResult_card"');
  const body = i0 < 0 ? '' : html.slice(i0);
  for (const box of body.split('<dl class="qa_box">').slice(1)) {
    const cm = box.match(/<dt class="qa_category">\s*<span>\d+<\/span>\s*([^<]+?)\s*<\/dt>/);
    const card = cm ? cm[1].trim() : '';
    for (const q of box.split('<dl class="questions">').slice(1)) {
      const qi = q.match(/<dt>Q(\d+)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/);
      const ai = q.match(/<dt>A(\d+)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/);
      if (qi && ai) out.push({ id: +qi[1], card, prod: p.name, q: dec(qi[2]), a: dec(ai[2]) });
    }
  }
  fs.writeFileSync(f, JSON.stringify(out));
  total += out.length; console.log(p.id, p.name, out.length);
  await sleep(2500);
}
// merge unique by Q id (same Q is shown under several cards)
const all = new Map();
for (const f of fs.readdirSync('data/rulings')) { if (!/^\d{6}\.json$/.test(f)) continue; for (const r of JSON.parse(fs.readFileSync('data/rulings/' + f, 'utf8'))) { const k = r.id; if (!all.has(k)) all.set(k, { ...r, cards: [r.card] }); else if (!all.get(k).cards.includes(r.card)) all.get(k).cards.push(r.card); } }
fs.writeFileSync('data/rulings/all.json', JSON.stringify([...all.values()].sort((a, b) => a.id - b.id)));
console.log('rows', total, 'unique Q', all.size);
