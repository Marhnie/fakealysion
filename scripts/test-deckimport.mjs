import fs from 'node:fs';
import assert from 'node:assert/strict';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
process.chdir('D:/닼웤롴덬/digimon-sim');
const S = await import('file:///D:/닼웤롴덬/digimon-sim/src/state.js');
const { parseDeckText, deckToText } = await import('file:///D:/닼웤롴덬/digimon-sim/src/deckimport.js');
await S.loadData();
const sample = `4 EX1-066
1 BT7-107
2 BT8-084
3 LM-032
4 BT20-063
4 BT20-068
4 BT20-072
2 BT20-088
4 BT21-065
4 BT23-064
3 BT23-087
4 BT23-069
3 BT23-098
2 BT23-065
3 BT23-061
3 BT23-071
4 BT20-006
`;
const r = parseDeckText(sample, S);
console.log('main', r.mainN, 'digitama', r.digN, 'errors', r.errors, 'warnings', r.warnings);
assert.equal(r.errors.length, 0);
assert.equal(r.mainN + r.digN, 54);
// formats
const f = parseDeckText('EX1-066 x4\n3x BT7-107 아구몬\nBT8-084,2\nLM-032\t3\n  # comment\n\n4 bt20-063', S);
assert.equal(f.main['EX1-066'], 4); assert.equal(f.main['BT7-107'], 3); assert.equal(f.main['BT8-084'], 2); assert.equal(f.main['LM-032'], 3); assert.equal(f.main['BT20-063'], 4);
// duplicates merge, unknown, parallel suffix
const g = parseDeckText('2 BT20-063\n2 BT20-063_P1\n1 ZZ99-999\n5 ???', S);
assert.equal(g.main['BT20-063'], 4); assert.equal(g.errors.length, 1);
// export round trip
const t = deckToText({ main: r.main, digitama: r.digitama }, S); const r2 = parseDeckText(t, S);
assert.deepEqual(r2.main, r.main); assert.deepEqual(r2.digitama, r.digitama);
const leg = S.deckLegality({ main: r.main, digitama: r.digitama }); console.log('legality', JSON.stringify(leg).slice(0, 300));
// DCGO 덱 파일 형식: "N 이름   ID(_Pn)" + 머리말(Name:/Key Card:/Sort Index:)
{ const d = parseDeckText('Name: NewDeck
Key Card: -1
Sort Index: 0

// DeckList

4 Minomon   BT3-004_P1 
3 KoKabuterimon   BT16-037 
', S);
  assert.equal(d.errors.length, 0); assert.equal(d.digitama['BT3-004'], 4); assert.equal(d.main['BT16-037'], 3); }
console.log('deckimport tests OK');
