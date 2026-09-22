// Spectate-mode test: 6 short CPU-vs-CPU games through src/spectate.js runSpectateGame (easy / normal, random legal built-in decks).
// Asserts: winner or turn-cap end, timeline > 10 steps, every step's snapshot restores, replay file v2 round-trips.
// Run: node scripts/test-spectate.mjs < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as SN from '../src/snapshot.js';
import * as RP from '../src/replay.js';
import * as Cpu from '../src/cpu.js';
import { runSpectateGame, thinTimeline, stepReadMs } from '../src/spectate.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
// random legal color-coherent decks (same idea as scripts/test-cpu.mjs coherentDeck)
let RS = 7; const rand = () => { RS = (RS + 0x6D2B79F5) >>> 0; let t = RS; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const cards = Object.values(S.CARDS).filter((c) => !c.isToken);
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
function makeDeck(name) {
  for (let tries = 0; tries < 60; tries++) {
    const cols = [pick(COLORS)]; if (rand() < 0.4) cols.push(pick(COLORS));
    const okc = (c) => (c.colors || []).length > 0 && c.colors.every((x) => cols.includes(x)) && !c.isParallel;
    const lv = (n) => cards.filter((c) => c.category === 'digimon' && c.level === n && okc(c) && c.cost != null);
    const eggs = cards.filter((c) => c.category === 'digitama' && okc(c));
    const pools = [[lv(3), 14], [lv(4), 11], [lv(5), 8], [cards.filter((c) => c.category === 'tamer' && okc(c)), 4], [cards.filter((c) => c.category === 'option' && okc(c)), 6]];
    if (!eggs.length) continue;
    const main = {}, dig = {};
    const add = (t, c) => { if ((t[c.id] || 0) >= Math.min(4, S.maxCopiesFor(c.id))) return false; t[c.id] = (t[c.id] || 0) + 1; return true; };
    for (let i = 0; i < 5; i++) add(dig, pick(eggs));
    for (const [pool, n] of pools) { let g = 0, got = 0; while (got < n && pool.length && g++ < 300) if (add(main, pick(pool))) got++; }
    const any = pools.flatMap(([p]) => p); let g = 0; const tot = () => Object.values(main).reduce((a, b) => a + b, 0);
    while (tot() < 50 && any.length && g++ < 3000) add(main, pick(any));
    const d = { name, main, digitama: dig }; if (tot() === 50 && S.deckLegality(d).ok) return d;
  }
  throw new Error('no deck');
}
const lv = ['easy', 'normal'];
const games = [];
for (let i = 0; i < 6; i++) games.push({ a: makeDeck('덱A' + i), b: makeDeck('덱B' + i), la: lv[i % 2], lb: lv[(i >> 1) % 2], seed: 1000 + i });
let prog = 0;
for (const g of games) {
  const r = await runSpectateGame({ deckA: g.a, deckB: g.b, levelA: g.la, levelB: g.lb, seed: g.seed, maxTurns: 25, maxMs: 60000, onProgress: () => { prog++; } });
  const tag = `${g.a.name} vs ${g.b.name} ${g.la}/${g.lb}`;
  ok(['win', 'draw', 'turncap'].includes(r.ended), `${tag}: ended=${r.ended} errors=${r.errors.slice(0, 2)}`);
  ok(r.list.length > 10, `${tag}: timeline ${r.list.length}`);
  ok(r.ended !== 'win' || r.winner, `${tag}: winner missing`);
  const scratch = {};
  let bad = 0;
  for (const e of r.list) { try { SN.restoreState(scratch, e.snap); if (!scratch.players || !scratch.players.p1) bad++; } catch (er) { bad++; } }
  ok(bad === 0, `${tag}: ${bad} snapshots failed to restore`);
  const txt = RP.replayFileJSON({ firstPlayer: r.firstPlayer, winner: r.winner, turnNumber: r.turns }, r.list);
  const back = RP.parseReplayFile(txt);
  ok(back.list.length === r.list.length && back.meta.winner === r.winner, `${tag}: replay round trip`);
  const sc2 = {}; SN.restoreState(sc2, back.list[back.list.length - 1].snap);
  ok(sc2.turnNumber === r.turns, `${tag}: parsed last snapshot turn ${sc2.turnNumber} vs ${r.turns}`);
  ok(r.list.every((e) => Array.isArray(e.lines)), `${tag}: lines arrays`);
  console.log(`${tag}: ${r.ended} winner=${r.winner} turns=${r.turns} steps=${r.list.length} ${Math.round(r.ms)}ms errs=${r.errors.length} json=${(txt.length / 1048576).toFixed(1)}MB`);
}
ok(prog > 50, 'onProgress called');
// cancel
{ const sig = { aborted: false }; let n = 0; const r = await runSpectateGame({ deckA: makeDeck('c1'), deckB: makeDeck('c2'), maxTurns: 30, signal: sig, onProgress: () => { if (++n === 12) sig.aborted = true; } }); ok(r.ended === 'cancelled' && r.list.length >= 2, 'cancel -> ' + r.ended); }
// thinning keeps first/last and lines
{ const L = Array.from({ length: 11 }, (_, i) => ({ lines: ['l' + i], snap: i })); thinTimeline(L); ok(L[0].snap === 0 && L[L.length - 1].snap === 10 && L.reduce((a, e) => a + e.lines.length, 0) === 11, 'thin'); }
ok(stepReadMs({ lines: [] }, 1) < stepReadMs({ lines: ['가나다라마바사'.repeat(10)] }, 1) && stepReadMs({ lines: ['x'] }, 2) < stepReadMs({ lines: ['x'] }, 1), 'read ms scaling');
console.log(fails ? `test-spectate: ${fails} FAILED` : 'test-spectate: ALL OK');
process.exit(fails ? 1 : 0);
