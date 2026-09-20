// DIRECTED watcher probe (complements the census's opportunity counting, which cannot tell "subject too narrow for these random decks" from "wiring broken").
// For every printed turn-scoped watcher segment that the engine's own parser (S.parseWatcherTrigger) understands, build a minimal board:
//   holder = the card (own top, or as an inherited source under a base Digimon) for p1, subject = a real card that satisfies the parser's own predicates,
// emit the exact engine event through S.emitGameEvent and check that a pending item for (holder card, holder stack) is queued.
// node scripts/census-watch-probe.mjs [--verbose] < /dev/null      -> prints the segments that DID NOT queue (with why-guesses)
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const VERBOSE = process.argv.includes('--verbose');
const cards = Object.values(S.CARDS).filter(c => !c.isToken);
const digis = cards.filter(c => c.category === 'digimon' && c.level >= 3 && c.dp);
const tamers = cards.filter(c => c.category === 'tamer');
const egg = cards.find(c => c.category === 'digitama');
const base = digis.find(c => c.level === 3);
function freshState() {
  const st = S.newGame({ name: 'a', main: { [base.id]: 50 }, digitama: { [egg.id]: 5 } }, { name: 'b', main: { [base.id]: 50 }, digitama: { [egg.id]: 5 } });
  E.drawOpeningHand(st, 'p1'); E.drawOpeningHand(st, 'p2'); E.setSecurityStacks(st); E.beginGame(st, 'p1');
  st.turnNumber = 6; st.phase = 'main';
  return st;
}
function put(st, p, id) { const pl = st.players[p]; pl.hand.unshift(id); const s = S.playDigimonFresh(st, p, 0); return s || pl.battle[pl.battle.length - 1]; }
const results = { ok: 0, fail: [], skipped: 0 };
const KINDS_OK = new Set(['play', 'digivolve', 'delete', 'rest', 'discard', 'attack']);
for (const X of cards) {
  if (X.category === 'option') { results.skipped++; continue; }
  for (const [key, inh] of [['effectKo', false], ['inheritedKo', true]]) {
    if (!X[key]) continue;
    if (inh && X.category === 'tamer') continue;
    for (const seg of S.parseEffectSegments(X[key]).segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      if (seg.zoneMarker) continue;
      let ab = null; try { ab = S.parseWatcherTrigger(seg.body); } catch (e) { ab = null; }
      if (!ab) continue;
      const kinds = ab.kinds || [ab.kind];
      const kind = kinds.find(k => KINDS_OK.has(k)); if (!kind) { results.skipped++; continue; }
      // subject
      const causeOpts = [null, 'effect', 'ownEffect', 'battle', 'oppEffect'];
      const cause = causeOpts.find(c => { try { return ab.causeTest(c); } catch (e) { return false; } });
      const subjPool = ab.isTamer ? tamers : digis;
      const wantSelf = !!ab.selfOnly;
      let subj = null;
      if (!wantSelf) { subj = subjPool.find(c => { try { return ab.subjPred(c) && (!ab.newCardPred || ab.newCardPred(c)) && (!ab.condPred || ab.condPred(c)); } catch (e) { return false; } }); if (!subj) { results.skipped++; continue; } }
      let outcome = null;
      for (const restState of [false, true]) { // "이 디지몬이 레스트/액티브 상태라면" conditions: try both
        const st = freshState();
        const owner = ab.who === 'opp' ? 'p2' : 'p1';
        st.activePlayer = seg.tags[0] === '상대의 턴' ? 'p2' : 'p1';
        let holder;
        try {
          if (!inh) holder = put(st, 'p1', X.id);
          else { holder = put(st, 'p1', base.id); holder.sources.push(X.id); }
          if (X.category !== 'tamer' || true) holder.suspended = restState;
          // a rest-cost tamer needs to be untapped: watchers of the form "이 테이머를 레스트시키는 것으로" handled by holder.suspended=false run
          let subjStack;
          if (wantSelf) subjStack = holder;
          else subjStack = put(st, owner, subj.id);
          st.pending = []; st.log.length = 0; holder.suspended = restState; // (putting the subject onto the board may have rested the holder as a real trigger's cost)
          for (const q of ['p1', 'p2']) for (const x of [st.players[q].raising, ...st.players[q].battle]) if (x) x.turnEffectUses = {}; // putting the subject onto the board already fired (and consumed the once-per-turn of) the watcher
          const evOwner = wantSelf ? 'p1' : owner;
          S.emitGameEvent(st, kind, { owner: evOwner, stack: subjStack, cause });
          const got = st.pending.filter(t => t.cardId === X.id && t.stackUid === holder.uid);
          if (got.length) { outcome = 'ok'; break; }
          outcome = 'miss';
        } catch (e) { outcome = 'ERR ' + String(e.message).slice(0, 60); break; }
      }
      if (outcome === 'ok') results.ok++; else results.fail.push({ id: X.id, name: X.nameKo, inh, tag: seg.tags[0], kind, cause, subj: subj && subj.id, outcome, body: seg.body.replace(/\s+/g, ' ').slice(0, 100) });
    }
  }
}
console.log(`watcher probe: ${results.ok} queued OK, ${results.fail.length} NOT queued, ${results.skipped} skipped (options / unmodelled)`);
for (const f of results.fail) console.log(`${f.id} ${f.name} [${f.inh ? '진화원' : '본체'}] 【${f.tag}】 ${f.kind}/${f.cause} subj=${f.subj} -> ${f.outcome} | ${f.body}`);
process.exit(0);
