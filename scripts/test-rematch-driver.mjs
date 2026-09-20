// Headless regression for the CPU UI driver across game replacement (rematch / new game / undo / load).
// Game A parks the driver forever inside a search that never returns (stand-in for any action awaiting a prompt of a dead state);
// the state object is then swapped for game B, exactly like the UI does on a rematch. The driver must act in B (no stuck busyTick token,
// per-game bookkeeping reset) — with the old module-level flag it stalled forever.
// Run: node scripts/test-rematch-driver.mjs < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Cpu from '../src/cpu.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const cards = Object.values(S.CARDS);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const mainPool = cards.filter((c) => ['digimon', 'tamer', 'option'].includes(c.category));
const eggPool = cards.filter((c) => c.category === 'digitama');
const deck = { name: 'rnd', main: Object.fromEntries(Array.from({ length: 50 }, () => [pick(mainPool).id, 1])), digitama: Object.fromEntries(Array.from({ length: 5 }, () => [pick(eggPool).id, 1])) };
const mk = () => { const st = S.newGame(deck, deck); E.drawOpeningHand(st, 'p1'); E.drawOpeningHand(st, 'p2'); E.setSecurityStacks(st); E.beginGame(st, 'p2'); return st; };
let cur = mk(); cur.phase = 'main'; cur.activePlayer = 'p2';
const calls = [];
const api = {
  getState: () => cur, busy: () => false, pendingAttack: () => null, pendingOwner: () => null, hasScript: () => true, closePending: () => {}, answer: () => {},
  fxBusyMs: () => 0, setActing: () => {}, thinkUpdate: () => {}, skipBreeding: () => calls.push(['skipBreeding', cur]), hatch: () => calls.push(['hatch', cur]), move: () => calls.push(['move', cur]),
  pass: () => calls.push(['pass', cur]), play: async () => { calls.push(['play', cur]); }, evolve: async () => {}, jogress: async () => {}, attack: () => calls.push(['attack', cur]), train: () => {}, useMain: () => {},
  pa: { chooseTarget() {}, passRedirect() {}, useCounter() {}, passCounter() {}, block() {}, passBlock() {}, pierce() {}, close() {} },
};
const D = Cpu.createUiDriver(api);
D.enabled = true; D.level = 'hard'; D.speed = 'fast'; D.setSearch({ enabled: true, budgetMs: 200 });
const realSearch = Cpu.HOOKS.search;
Cpu.HOOKS.search = () => new Promise(() => {}); // parks forever
const tick = async (n) => { for (let i = 0; i < n; i++) { D.beat().catch(() => {}); await new Promise((r) => setTimeout(r, 30)); } };
await tick(3);
if (D.busyTick === false) throw new Error('setup: driver should be parked inside the hung search');
const stA = cur;
cur = mk(); cur.phase = 'main'; cur.activePlayer = 'p2'; // rematch: brand-new state object
Cpu.HOOKS.search = realSearch ? () => Promise.resolve(null) : () => Promise.resolve(null);
await new Promise((r) => setTimeout(r, 1300)); // pace
await tick(30);
const acted = calls.filter((c) => c[1] === cur);
if (!acted.length) throw new Error('STALL: the driver never acted in the new game (busyTick=' + JSON.stringify(D.busyTick) + ')');
if (calls.some((c) => c[1] === stA)) throw new Error('driver acted on the dead game');
console.log('rematch driver test OK — first action in new game:', acted[0][0]);
D.stop();
process.exit(0);
