import { S } from './lib.mjs';
import * as fs from 'fs';
const a = JSON.parse(fs.readFileSync('data/rulings/slice4.json', 'utf8'));
const ids = new Set(a.flatMap(e => e.cards.map(c => c.split(' ')[0])));
const miss = [...ids].filter(i => !S.CARDS[i]);
console.log(a.length, ids.size, 'missing', miss.length);
let nAll = 0; for (const e of a) { if (e.cards.every(c => !S.CARDS[c.split(' ')[0]])) nAll++; }
console.log('entries with no card in DB', nAll);
console.log(JSON.stringify(S.CARDS['BT1-010']).slice(0, 900));
