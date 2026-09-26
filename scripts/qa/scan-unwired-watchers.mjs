// Scan the whole card pool for the "unwired watcher" / "stray compiled op" bug classes found by the Q&A audits (docs/audit-2026-09-unresolved-c.md):
//  (a) a continuous / 【자신의·상대의·서로의 턴】 segment whose printed trigger is a "~했을 때" event that NO engine path will ever queue:
//        A1 no watcher parse + no HOOKS descriptor      (state.js parseWatcherTrigger/parseEventWatcher cannot read the phrasing)
//        A2 parsed by parseEventWatcher but dropped as EW_UNSAFE (conditional / multi-step text) and not marked ewTrusted
//        A3 parsed, fires, but the effect sentence compiles to an EMPTY script (only a manual pending is left)
//        A4 only a card-specific SCRIPT exists (script never triggered)
//        A6 two-clause "A했을 때, 또는 B했을 때" trigger: only clause A is read (needs a hook covering both)
//        A5 HOOKS descriptor whose tag/has matches no printed segment (dead hook) or whose events key is never emitted
//  (b) a generic-compiled script (no card-specific script) that contains an op with no corresponding words in the printed segment
//      (stray grant, e.g. a trailing keyword line compiled into a grantKeyword).
// Triage notes live in the HANDLED table below (patterns the engine handles by other means); anything else is printed as a SUSPECT.
// Run: node scripts/qa/scan-unwired-watchers.mjs [--json] [--strict]   (--strict exits 1 when a SUSPECT remains)
import fs from 'node:fs';
import * as S from '../../src/state.js';
import * as Effects from '../../src/effects.js';
import { HOOKS } from '../../src/cards/index.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();

const TURN = new Set(['자신의 턴', '상대의 턴', '서로의 턴']);
const EVENT_RE = /(?:했을|되었을|됐을|줄었을|늘어났을|줄어들었을|놓였을|되돌아갔을|얻었을|받았을|사용했을|하였을|가졌을)\s*때/;
const EW_UNSAFE = /있다면|라면|이라면|마다|그\s*후|하는\s*것으로|선택하여|한다면|경우|또는\s*효과로|이상일|이하일/;
const stripReminder = (t) => t.replace(/\([^()]*\)/g, '').replace(/「[^」]*【[^」]*」/g, ''); // reminder text and quoted 「【태그】 …」 grants are not this segment's own trigger

// patterns the engine handles WITHOUT a watcher parse / hook (each names the handler)
const HANDLED = [
  [/발휘한\s*《디지버스트》로\s*이\s*카드가\s*파기되었을\s*때/, 'state.js queueDigiburstTrashed (queued when the source is digiburst-trashed)'],
  [/^이\s*카드가\s*(?:「[^」]+」의\s*)?(?:효과로\s*)?진화원에서(?:\s*효과로)?\s*파기되었을\s*때/, 'state.js queueOwnDiscardTriggers (inherited "이 카드가 진화원에서 파기되었을 때")'],
  [/^《딜레이》\.?$/, 'main.js 《딜레이》 watcher path (delayBulletPlan)'],
];
const handledBy = (text) => { for (const [re, why] of HANDLED) if (re.test(text.trim())) return why; return null; };

function scriptFor(cardId, tags, text) {
  const sp = Effects.lookupCardSpecific(cardId, tags, text); if (sp) return { s: sp, specific: true };
  try { return { s: Effects.compileToScript(text), specific: false }; } catch { return { s: [], specific: false }; }
}
const out = { a: [], b: [] };
const cards = Object.values(S.CARDS);
const textsOf = (c) => { const t = [['effectKo', c.effectKo], ['inheritedKo', c.inheritedKo]]; if (c.optionKo) t.push(['optionKo', S.optionView(c.id).effectKo]); return t; };

// ---------------- (a) ----------------
for (const c of cards) for (const [src, text] of textsOf(c)) {
  if (!text) continue;
  for (const seg of S.parseEffectSegments(text).segments) {
    const first = seg.body.trim().split('\n')[0];
    if (!(seg.tags.length === 1 && TURN.has(seg.tags[0]) && EVENT_RE.test(stripReminder(first)))) continue;
    if (S.isHandledContinuousKeywordBody(seg.body) || S.isHandledRedirectBody(seg.body)) continue;
    const hd = S.hookDescriptorFor(c.id, seg.tags, seg.body);
    if (hd) continue;                                                     // bespoke hook: checked by A5 below
    const pw = S.parseWatcherTrigger(seg.body), ew = pw ? null : S.parseEventWatcher(seg.body);
    let why = null, note = null;
    if ((pw || ew) && /^(?:또는|혹은)\s/.test((pw || ew).effect)) why = 'A6 two-clause "…했을 때, 또는 …했을 때" trigger: only the first clause is read, effect text starts with 또는';
    else if (pw) { const { s } = scriptFor(c.id, seg.tags, pw.effect); if (!s.length) why = 'A3 watcher fires, effect text compiles empty'; note = handledBy(pw.effect); }
    else if (ew) { const { s } = scriptFor(c.id, seg.tags, ew.effect); if (EW_UNSAFE.test(ew.effect)) why = 'A2 EW_UNSAFE watcher dropped (no ewTrusted hook)'; else if (!s.length) why = 'A3 watcher fires, effect text compiles empty'; }
    else { why = Effects.lookupCardSpecific(c.id, seg.tags, seg.body) ? 'A4 only a card script exists (never triggered)' : 'A1 no watcher parse and no hook'; note = handledBy(first); }
    if (!why) continue;
    out.a.push({ id: c.id, src, tag: seg.tags[0], why, handled: note, body: first.slice(0, 150) });
  }
}
// A5: dead / unemitted hook descriptors
{
  let t = ''; for (const f of fs.readdirSync('src')) if (f.endsWith('.js')) t += fs.readFileSync('src/' + f, 'utf8'); for (const f of fs.readdirSync('src/cards')) t += fs.readFileSync('src/cards/' + f, 'utf8');
  const emitted = new Set([...t.matchAll(/(?:emitGameEvent|dispatchHookEvents)\(\s*[\w.]+,\s*'(\w+)'/g)].map((m) => m[1]));
  for (const [id, list] of Object.entries(HOOKS)) {
    const c = S.CARDS[id]; if (!c) continue;
    for (const d of list) {
      for (const k of Object.keys(d.events || {})) if (!emitted.has(k)) out.a.push({ id, src: d.src || 'effectKo', tag: d.tag, why: `A5 hook listens to event '${k}' that is never emitted`, body: d.has || '' });
      if (!d.tag || String(d.tag).startsWith('__') || !d.events) continue;                       // only event hooks: a dead filter never queues anything
      const texts = (d.src || 'effectKo') === 'effectKo' ? [c.effectKo, c.optionKo ? S.optionView(id).effectKo : null] : [c.inheritedKo];
      const ok = texts.some((tx) => tx && S.parseEffectSegments(tx).segments.some((sg) => sg.tags[0] === d.tag && (!d.has || sg.body.includes(d.has)))) || !!d.text;
      if (!ok) out.a.push({ id, src: d.src || 'effectKo', tag: d.tag, why: 'A5 event hook matches no printed segment (dead filter)', body: d.has || '' });
    }
  }
}

// ---------------- (b) ----------------
const KW_LINE = /^(?:\s*[《≪][^》≫]*(?:[《≪][^》≫]*[》≫][^》≫]*)*[》≫]\s*(?:\([^()]*\))?)+$/;
const KW_WORD = { 시큐리티어택: /S\s*어택|시큐리티\s*어택/, 블로커: /블로커/, 돌진: /돌진/, 관통: /관통/, 재기동: /재기동/, 속공: /속공/, 충돌: /충돌/, 회피: /회피/, 길동무: /길동무/, 재밍: /재밍/, 연계: /연계/, 레이드: /레이드|진격/, 링크: /링크/, 리크루트: /리크루트/ };
const OP_WORDS = { modifyDP: /DP/, modifyDPAll: /DP/, gainMemory: /메모리|코스트/, setMemoryIfLE: /메모리/, draw: /드로우|뽑/, destroy: /소멸|파기/, playFree: /등장|사용/, playThisFree: /등장/, trashHand: /파기/, rest: /레스트/, restStack: /레스트/, unsuspend: /액티브|재기동/, blastEvolve: /블래스트|블라스트/, retreat: /퇴화/, raid: /레이드|진격/, recoverTop: /리커버리/, trashDeckTop: /파기/, removeSecurity: /시큐리티/, securityTopToHand: /시큐리티/, securityBottomToHand: /시큐리티/, restrictAttack: /어택/, attackNow: /어택/, jogressEffect: /조그레스/, saveUnderTamer: /세이브/, returnToHandStripSources: /패|덱/, evolveEffect: /진화/ };
function flat(x, o = []) { if (Array.isArray(x)) x.forEach((y) => flat(y, o)); else if (x && typeof x === 'object') { if (x.op) o.push(x); for (const v of Object.values(x)) if (v && typeof v === 'object') flat(v, o); } return o; }
for (const c of cards) for (const [src, text] of textsOf(c)) {
  if (!text) continue;
  for (const seg of S.parseEffectSegments(text).segments) {
    const { s, specific } = scriptFor(c.id, seg.tags, seg.body); if (specific || !s.length) continue;   // card-specific scripts are hand-written: audit only the generic compiler
    const kwLines = seg.body.split('\n').slice(1).filter((l) => KW_LINE.test(l.trim()));
    const bodyNo = seg.body.split('\n').filter((l, i) => i === 0 || !KW_LINE.test(l.trim())).join('\n');
    const bad = [];
    for (const op of flat(s)) {
      if (op.op === 'grantKeyword') { const re = KW_WORD[op.keyword]; if (re && !re.test(bodyNo)) bad.push(`grantKeyword:${op.keyword}` + (kwLines.some((l) => re.test(l)) ? ' (only in a trailing keyword line)' : ' (no mention)')); }
      else if (OP_WORDS[op.op] && !OP_WORDS[op.op].test(bodyNo)) bad.push(`${op.op} (no mention)`);
    }
    if (bad.length) out.b.push({ id: c.id, src, tag: seg.tags.join('/'), why: bad.join(', '), body: seg.body.slice(0, 140).replace(/\n/g, ' / ') });
  }
}

const suspectsA = out.a.filter((r) => !r.handled), triaged = out.a.filter((r) => r.handled);
if (process.argv.includes('--json')) console.log(JSON.stringify({ suspectsA, triaged, b: out.b }, null, 1));
else {
  const by = {}; for (const r of suspectsA) (by[r.why] ||= []).push(r);
  for (const [k, v] of Object.entries(by)) { console.log(`\n== SUSPECT (a) ${k}: ${v.length}`); for (const r of v) console.log(`${r.id} [${r.src}/${r.tag}] ${r.body}`); }
  console.log(`\n== (a) triaged as handled elsewhere: ${triaged.length}`);
  const byH = {}; for (const r of triaged) (byH[r.handled] ||= []).push(r.id); for (const [k, v] of Object.entries(byH)) console.log(`  ${v.length} x ${k}: ${v.join(' ')}`);
  console.log(`\n== SUSPECT (b) stray ops: ${out.b.length}`); for (const r of out.b) console.log(`${r.id} [${r.src}/${r.tag}] ${r.why} :: ${r.body}`);
}
const n = suspectsA.length + out.b.length;
console.log(`\nunwired-watcher scan: ${n} suspect(s)`);
if (process.argv.includes('--strict') && n) process.exit(1);
