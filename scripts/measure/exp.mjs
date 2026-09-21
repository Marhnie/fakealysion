// Experiment definitions: each exp = { N, gen(i, ctx) -> spec }.  Deterministic in (exp name, i).  ctx = { pool, starters }.
import * as L from './lib.mjs';
const HARD = { level: 'hard' };
// balanced 2x2 design helper: k = game index within an arm -> which seat is the variant (A) and who moves first, deck index
const bal = (k, poolN) => ({ aSeat: k % 2 ? 'p2' : 'p1', first: (k >> 1) % 2 ? 'p2' : 'p1', di: Math.floor(k / 4) % poolN });
const other = (p) => (p === 'p1' ? 'p2' : 'p1');
export const POOL_N = 40;

// generic "variant policy vs default policy, mirror deck" experiment
function variantExp(name, arms, perArm) {
  const names = Object.keys(arms);
  return {
    name, N: names.length * perArm, arms: names,
    gen(i, ctx) {
      const arm = names[i % names.length], k = Math.floor(i / names.length);
      const b = bal(k, ctx.pool.length), d = ctx.pool[b.di];
      const pol = { p1: {}, p2: {} }; pol[b.aSeat] = arms[arm]; pol[other(b.aSeat)] = {};
      return { seed: L.hashSeed(name, i), deck: { p1: d, p2: d }, first: b.first, pol, meta: { arm, aSeat: b.aSeat, first: b.first, di: b.di } };
    },
  };
}
// deck-variant experiment: variant composition (A) vs default composition (B), same colours, mirror policy (hard both)
function deckExp(name, arms, perArm) {
  const names = Object.keys(arms);
  return {
    name, N: names.length * perArm, arms: names,
    gen(i) {
      const arm = names[i % names.length], k = Math.floor(i / names.length);
      const b = bal(k, 1);
      L.seedMath(L.hashSeed(name, 'deck', i));
      const C = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
      const c1 = C[Math.floor(Math.random() * 7)];
      const cols = Math.random() < 0.5 ? [c1] : [...new Set([c1, C[Math.floor(Math.random() * 7)]])];
      let dA = null, dB = null, g = 0;
      while ((!dA || !dB) && g++ < 20) { dA = L.genDeck('A', arms[arm], cols); dB = L.genDeck('B', {}, cols); }
      if (!dA || !dB) return null;
      const deck = {}; deck[b.aSeat] = dA; deck[other(b.aSeat)] = dB;
      return { seed: L.hashSeed(name, i), deck, first: b.first, pol: { p1: HARD, p2: HARD }, meta: { arm, aSeat: b.aSeat, first: b.first, cols: cols.join('+') } };
    },
  };
}
const PER = Number(process.env.PER || 6000);
export const EXPS = {
  // 1) baselines (hard vs hard): mirror pool / cross pool / pseudo-starters
  base: {
    name: 'base', N: 15000, arms: ['mirror', 'cross', 'starter'],
    gen(i, ctx) {
      const mode = ['mirror', 'cross', 'starter'][i % 3], k = Math.floor(i / 3);
      const first = k % 2 ? 'p2' : 'p1';
      let d1, d2;
      L.seedMath(L.hashSeed('base', 'pick', i));
      const r = () => Math.floor(Math.random() * 1e9);
      if (mode === 'mirror') { d1 = d2 = ctx.pool[r() % ctx.pool.length]; }
      else if (mode === 'cross') { const a = r() % ctx.pool.length; let b = r() % ctx.pool.length; if (b === a) b = (b + 1) % ctx.pool.length; d1 = ctx.pool[a]; d2 = ctx.pool[b]; }
      else { const a = r() % ctx.starters.length; const b = r() % ctx.starters.length; d1 = ctx.starters[a]; d2 = ctx.starters[b]; }
      return { seed: L.hashSeed('base', i), deck: { p1: d1, p2: d2 }, first, pol: { p1: HARD, p2: HARD }, meta: { arm: mode, first, d1: d1.name, d2: d2.name } };
    },
  },
  // 6) CPU levels: mirror pool decks, all ordered level pairs (seat/first balanced)
  levels: (() => {
    const pairs = [['easy', 'easy'], ['normal', 'normal'], ['hard', 'hard'], ['normal', 'easy'], ['hard', 'easy'], ['hard', 'normal']];
    return {
      name: 'levels', N: pairs.length * PER, arms: pairs.map((p) => p.join('-')),
      gen(i, ctx) {
        const pi = i % pairs.length, k = Math.floor(i / pairs.length), b = bal(k, ctx.pool.length), d = ctx.pool[b.di];
        const pol = {}; pol[b.aSeat] = { level: pairs[pi][0] }; pol[other(b.aSeat)] = { level: pairs[pi][1] };
        return { seed: L.hashSeed('levels', i), deck: { p1: d, p2: d }, first: b.first, pol, meta: { arm: pairs[pi].join('-'), aSeat: b.aSeat, first: b.first } };
      },
    };
  })(),
  // 6b) levels on cross decks (random deck pair): does deck strength matter more than level?
  levelsX: (() => {
    const pairs = [['hard', 'hard'], ['hard', 'normal'], ['hard', 'easy'], ['easy', 'easy']];
    return {
      name: 'levelsX', N: pairs.length * PER, arms: pairs.map((p) => p.join('-')),
      gen(i, ctx) {
        const pi = i % pairs.length, k = Math.floor(i / pairs.length), b = bal(k, ctx.pool.length);
        L.seedMath(L.hashSeed('levelsX', 'pick', i)); const a = Math.floor(Math.random() * ctx.pool.length); let c = Math.floor(Math.random() * ctx.pool.length); if (c === a) c = (c + 1) % ctx.pool.length;
        const deck = { p1: ctx.pool[a], p2: ctx.pool[c] };
        const pol = {}; pol[b.aSeat] = { level: pairs[pi][0] }; pol[other(b.aSeat)] = { level: pairs[pi][1] };
        return { seed: L.hashSeed('levelsX', i), deck, first: b.first, pol, meta: { arm: pairs[pi].join('-'), aSeat: b.aSeat, first: b.first, dA: deck[b.aSeat].name, dB: deck[other(b.aSeat)].name } };
      },
    };
  })(),
  // 2a) mulligan policy (variant vs CPU-hard default, mirror decks)
  mull: variantExp('mull', { keep: { mull: 'keep' }, always: { mull: 'always' }, noLv3: { mull: 'noLv3' }, cost3: { mull: 'cost3' }, lv3or4: { mull: 'lv3or4' }, cpuSelf: {} }, PER),
  // 2b) breeding (hatch / move timing)
  breed: variantExp('breed', { hatchFrom2: { hatchFrom: 2 }, hatchFrom3: { hatchFrom: 3 }, noHatch: { noHatch: true }, moveMin4: { moveMinLv: 4 }, moveMin5: { moveMinLv: 5 }, cpuSelf: {} }, PER),
  // 3) memory / tempo (TUNE overrides on the variant seat only) + evolve-vs-play preference
  mem: variantExp('mem', {
    useAll3: { tune: { hardThreshold: -9, hardLimit: 3 } },
    overspend: { tune: { hardThreshold: -9, hardLimit: 10, hardGw: 0 } },
    limit0: { tune: { hardLimit: 0 } }, limit1: { tune: { hardLimit: 1 } }, limit2: { tune: { hardLimit: 2 } }, limit3: { tune: { hardLimit: 3 } }, limit7: { tune: { hardLimit: 7 } },
    thrLow: { tune: { hardThreshold: 0 } }, thrHigh: { tune: { hardThreshold: 3 } },
    prefEvolve: { pref: 'evolve' }, prefPlay: { pref: 'play' }, cpuSelf: {},
  }, PER),
  // 3b) follow-up of `mem`: where does "spend more memory / hand over more" stop paying off?
  mem2: variantExp('mem2', {
    gw0: { tune: { hardGw: 0 } }, lim7gw0: { tune: { hardLimit: 7, hardGw: 0 } }, lim10: { tune: { hardLimit: 10 } }, lim10gw0: { tune: { hardLimit: 10, hardGw: 0 } },
    overspend: { tune: { hardThreshold: -9, hardLimit: 10, hardGw: 0 } }, overEvo: { pref: 'evolve', tune: { hardThreshold: -9, hardLimit: 10, hardGw: 0 } },
    dangerFree: { tune: { hardLimit: 10, hardGw: 0, hardReserve: 0 } }, cpuSelf: {},
  }, 2500),
  // 3c) resource exchange rates: what is one security / one card / one memory worth (in win-rate points)?  A = handicapped seat, hard vs hard, mirror decks
  handicap: (() => {
    const kinds = ['sec-1', 'sec+1', 'hand-1', 'hand+1', 'mem+1', 'mem+2', 'ctrl'];
    return {
      name: 'handicap', N: kinds.length * 3000, arms: kinds,
      gen(i, ctx) {
        const arm = kinds[i % kinds.length], k = Math.floor(i / kinds.length), b = bal(k, ctx.pool.length), d = ctx.pool[b.di];
        const first = arm.startsWith('mem+') ? b.aSeat : b.first; // a memory head-start only exists for the player who moves first
        return { seed: L.hashSeed('handicap', i), deck: { p1: d, p2: d }, first, pol: { p1: HARD, p2: HARD }, handicap: arm === 'ctrl' ? null : { seat: b.aSeat, kind: arm }, meta: { arm, aSeat: b.aSeat, first } };
      },
    };
  })(),
  // 4) attack decisions
  atk: variantExp('atk', {
    player: { atk: 'player' }, digi: { atk: 'digi' },
    aggro: { tune: { hardThrA: -99, hardReserve: 0 } }, passive2: { tune: { hardThrA: 2 } }, passive5: { tune: { hardThrA: 5 } }, passive99: { tune: { hardThrA: 99 } },
    reserve0: { tune: { hardReserve: 0 } }, reserve8: { tune: { hardReserve: 8 } },
    gain2lo: { tune: { hardGain2: 2.2 } }, gain2hi: { tune: { hardGain2: 6 } },
    riskblind: { tune: { pSecDig: 0 } }, riskhigh: { tune: { pSecDig: 1.0 } },
    chump0: { tune: { hardChump: 0 } }, chump5: { tune: { hardChump: 5 } }, cpuSelf: {},
  }, Math.floor(PER * 0.8)),
  // 2c/5) deck composition (variant deck vs default deck of the same colours; both hard)
  comp: deckExp('comp', {
    eggs3: { eggs: 3 }, eggs4: { eggs: 4 }, eggs1: { eggs: 1 },
    lowCurve: { lv3: 22, lv4: 14, lv5: 4, lv6: 0 }, highCurve: { lv3: 8, lv4: 10, lv5: 12, lv6: 6 }, noLv6: { lv6: 0, lv3: 17 }, lv6x8: { lv6: 8, lv3: 9 },
    tamers0: { tamers: 0, lv3: 18 }, tamers8: { tamers: 8, lv3: 10 }, opts0: { opts: 0, lv3: 18 }, opts12: { opts: 12, lv3: 8 }, opts0lv4: { opts: 0, lv4: 17 },
    cpuSelf: {},
  }, Math.floor(PER * 0.75)),
  // 5) random legal decks with random composition -> regression / per-card marginals (hard vs hard)
  rand: {
    name: 'rand', N: 40000, arms: ['rand'],
    gen(i) {
      L.seedMath(L.hashSeed('rand', 'deck', i));
      const dA = L.genDeck('A', L.randomComp()), dB = L.genDeck('B', L.randomComp());
      if (!dA || !dB) return null;
      const first = i % 2 ? 'p2' : 'p1';
      return { seed: L.hashSeed('rand', i), deck: { p1: dA, p2: dB }, first, pol: { p1: HARD, p2: HARD }, meta: { arm: 'rand', first }, saveDecks: true };
    },
  },
  // 5b) pseudo-starter round robin (hard vs hard, 60 games per ordered pair)
  starters: {
    name: 'starters', N: 16 * 15 * 60, arms: ['rr'],
    gen(i, ctx) {
      const n = ctx.starters.length, pairIdx = i % (n * (n - 1)), k = Math.floor(i / (n * (n - 1)));
      const a = Math.floor(pairIdx / (n - 1)); let b = pairIdx % (n - 1); if (b >= a) b++;
      const first = k % 2 ? 'p2' : 'p1';
      return { seed: L.hashSeed('starters', i), deck: { p1: ctx.starters[a], p2: ctx.starters[b] }, first, pol: { p1: HARD, p2: HARD }, meta: { arm: 'rr', a: ctx.starters[a].name, b: ctx.starters[b].name, first } };
    },
  },
};
