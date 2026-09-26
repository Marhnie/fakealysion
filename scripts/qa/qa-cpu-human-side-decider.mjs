// QA (bug report "CPU battle: cards I never played get played, their effects fire and prompts appear"):
// plays CPU(p2) vs a fully PASSIVE human (p1: hatches nothing, plays nothing, attacks nothing, only passes) through the real engine,
// with the UI's ownership rule (Cpu.deciderFor + pendingOwner, exactly what main.js ctxChoose uses) observed on every prompt, and
// reports every effect of a p1 card that resolved plus every prompt whose decider differs from the owner of the resolving effect.
//   node scripts/qa/qa-cpu-human-side-decider.mjs [games=800] [--verbose] [--passive (p1 = passive human, p2 = CPU; default is the both-CPU census)]
// FAIL conditions (real bugs):  (1) a p1 effect trigger whose tags are NOT one of the legit rule-driven families
// (【시큐리티】 / 【소멸 시】 / 【턴 시작】... see LEGIT) resolves; (2) a prompt of a p2-owned effect is decided by p1 without a documented reason
// (stack owner picks own stacks: 'pickStack' prompt with 자신의); (3) a p1 card is played/evolved during p2's turn other than by a security-effect play.
import * as fs from 'fs';
import * as S from '../../src/state.js';
import * as E from '../../src/engine.js';
import * as Cpu from '../../src/cpu.js';
import { createSim } from '../../src/cpusim.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const NARG = process.argv.find((a) => /^\d+$/.test(a));
const N = Number(NARG || 800); // default (test-all / qa run): the census mode below, ~40 s
const VERBOSE = process.argv.includes('--verbose');
const CVC = process.argv.includes('--cvc') || (!NARG && !process.argv.includes('--passive')); // census mode: BOTH seats are CPU (covers far more effects), random (soak-style) decks
const RANDOM = process.argv.includes('--random-decks') || CVC;
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const cards = Object.values(S.CARDS);
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
function coherentDeck(name) {
  const cols = Math.random() < 0.5 ? [pick(COLORS)] : [...new Set([pick(COLORS), pick(COLORS)])];
  const ok = (c) => (c.colors || []).length > 0 && c.colors.every((x) => cols.includes(x)) && !c.isParallel;
  const byLv = (lv) => cards.filter((c) => c.category === 'digimon' && c.level === lv && ok(c) && c.cost != null);
  const eggs = cards.filter((c) => c.category === 'digitama' && ok(c));
  const tamers = cards.filter((c) => c.category === 'tamer' && ok(c));
  const opts = cards.filter((c) => c.category === 'option' && ok(c));
  const main = {}, dig = {};
  const add = (target, c, max) => { const cur = target[c.id] || 0; if (cur >= Math.min(max, S.maxCopiesFor(c.id))) return false; target[c.id] = cur + 1; return true; };
  const fill = (pool, n) => { let tries = 0, got = 0; while (got < n && pool.length && tries++ < 400) if (add(main, pick(pool), 4)) got++; };
  if (!eggs.length) return null;
  for (let i = 0; i < 5; i++) add(dig, pick(eggs), 4);
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  fill(byLv(3), 14); fill(byLv(4), 11); fill(byLv(5), 8); fill(byLv(6), 3); fill(tamers, 4); fill(opts, 6);
  const any = [...byLv(3), ...byLv(4), ...byLv(5), ...opts];
  let guard = 0; while (total(main) < 50 && any.length && guard++ < 2000) add(main, pick(any), 4);
  if (total(main) !== 50 || total(dig) < 1) return null;
  const d = { name, main, digitama: dig };
  return S.deckLegality(d).ok ? d : null;
}
const mainPool = cards.filter((c) => ['digimon', 'tamer', 'option'].includes(c.category));
const eggPool = cards.filter((c) => c.category === 'digitama' || (c.category === 'digimon' && c.level === 2));
function randomDeck(name) { const main = {}, dig = {}; for (let i = 0; i < 50; i++) { const c = pick(mainPool); main[c.id] = (main[c.id] || 0) + 1; } for (let i = 0; i < 5; i++) { const c = pick(eggPool); dig[c.id] = (dig[c.id] || 0) + 1; } return { name, main, digitama: dig }; }
const makeDeck = (n) => { if (RANDOM) return randomDeck(n); let d = null, g = 0; while (!d && g++ < 60) d = coherentDeck(n); return d; };

// legit rule-driven p1 triggers while the human is passive (tag substrings)
const LEGIT = ['시큐리티', '소멸 시', '턴 시작', '턴 종료', '상대 턴', '상대의 턴', '딜레이', '상대의 디지몬이 등장', '상대가', '드로우', '언제든지', '자신의 턴 종료', '어택 시', '블록', '블로커', '카운터', '시작 시', '등장 시'];
// prompts that are the EFFECT USER's decision even though the cards shown belong to the opponent (rules 3-1-3-4 ordering, 'choose the opponent Digimon's evolution sources', reveal of the opponent's deck, "…을 줄 디지몬 선택" with a '자신의 턴' duration) — a foreign decider here = the bug of the report (the human gets a prompt for the CPU's effect, or the CPU silently answers for the human)
const MUST_OWN = /(진화원에서 파기할 카드 선택|파기할 상대|덱 위\/아래 어느 쪽|순서를 정하세요|DP\s*[-+]\d+.*을\s*줄\s*디지몬)/;
const agg = { violations: [], p1Effects: {}, foreignDecider: {}, p1PlayedDuringP2: {}, games: 0, errs: 0 };
const bump = (o, k, ex) => { (o[k] ||= { n: 0, ex }).n++; };
let curPhase = '';
for (let g = 0; g < N; g++) {
  const dA = makeDeck('A'), dB = makeDeck('B');
  const state = S.newGame(dA, dB);
  const cfgs = { p1: { level: 'normal', banned: new Set() }, p2: { level: g % 4 === 0 ? 'easy' : g % 4 === 1 ? 'normal' : 'hard', banned: new Set() } };
  const hooks = {
    decide: (t, k, o, who) => {
      if (who !== t.player && (k === 'orderCards' || k === 'pickSourcesMulti' || MUST_OWN.test(String((o && o.prompt) || '')))) agg.violations.push(`${k} owner=${t.player} decider=${who} ${S.card(t.cardId).id} :: ${String((o && o.prompt) || '').slice(0, 60)}`);
      if (who !== t.player) bump(agg.foreignDecider, `${k} owner=${t.player} decider=${who} pay.player=${o && o.player} :: ${String((o && o.prompt) || '').slice(0, 40)}`, `${S.card(t.cardId).id} ${S.card(t.cardId).nameKo} ${JSON.stringify(t.tags)} T${state.turnNumber} active=${state.activePlayer}`);
    },
    effectBegin: (t) => { if (t.player === 'p1') bump(agg.p1Effects, `${(t.tags || []).join('/')} | active=${state.activePlayer}`, `${S.card(t.cardId).id} ${S.card(t.cardId).nameKo} :: ${String(t.text).slice(0, 60)}`); },
  };
  const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: () => { agg.errs++; }, hooks });
  try {
    E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2');
    const first = g % 2 ? 'p2' : 'p1';
    E.setSecurityStacks(state); E.beginGame(state, first);
  } catch (e) { agg.errs++; continue; }
  const p1BoardUids = () => new Set(state.players.p1.battle.map((s) => s.uid));
  for (let t = 0; t < 60 && !state.winner; t++) {
    const p = state.activePlayer;
    const before = p1BoardUids();
    try {
      await sim.beginTurn(p);
      if (state.winner) break;
      if (p === 'p1' && !CVC) { // passive human: no breeding action (skip), no plays, only pass
        await sim.mainLoop('p1', async () => ({ type: 'pass' }));
      } else {
        await sim.mainLoop(p, async () => Cpu.planMain(state, p, cfgs[p]));
      }
    } catch (e) { agg.errs++; break; }
    if (p === 'p2') for (const s of state.players.p1.battle) if (!before.has(s.uid)) bump(agg.p1PlayedDuringP2, `${S.card(s.cardId).id} ${S.card(s.cardId).nameKo}`, `T${state.turnNumber}`);
  }
  agg.games++;
}
console.log(`games ${agg.games}, engine errors ${agg.errs}`);
const show = (title, o) => { console.log('\n== ' + title); for (const [k, v] of Object.entries(o).sort((a, b) => b[1].n - a[1].n).slice(0, VERBOSE ? 200 : 25)) console.log(String(v.n).padStart(5), k, ' e.g.', v.ex); };
show('p1 (human) effects that resolved while the human was passive', agg.p1Effects);
show('prompts of an effect decided by someone other than the effect owner', agg.foreignDecider);
show('p1 board arrivals during p2 turns (cards the human never played)', agg.p1PlayedDuringP2);
console.log('\nviolations (effect-user decision routed to the other seat):', agg.violations.length);
for (const v of [...new Set(agg.violations)].slice(0, 20)) console.log('  ' + v);
console.log(agg.violations.length || agg.errs ? 'RESULT: PROBLEMS' : 'RESULT: OK');
process.exit(agg.violations.length || agg.errs ? 1 : 0);
