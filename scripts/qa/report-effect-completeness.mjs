#!/usr/bin/env node
// Effect-completeness report: an HONEST, measured answer to "are ALL card effects implemented?".
//
//   scripts/audit-effects.mjs says "100% coverage" - that only means every printed effect segment either compiles to
//   a non-empty script or matches a hard-coded "handled elsewhere" regex.  It says nothing about whether the script is
//   complete, correct, fully automatic or ever tested.  This report measures those things separately:
//
//     A  inventory                    cards / segments / registries
//     B  segment resolution class     rule-handled | hook | bespoke (src/cards/*.js) | generic compiler
//     C  manual fallbacks             segments whose script (or runtime) still asks the human to do something
//     D  suspected partials           printed sentences with no corresponding op (engine's droppedSentences + a heuristic)
//     E  CPU decision surface         ctx.choose kinds and what Cpu.answerChoice does with them
//     F  verification                 regression-script coverage per card / per ruling, optional full qa run
//     G  data gaps                    rulings that name cards missing from data/cards_full.json, cards w/o Korean text
//     H  known structural gaps        counts of "unresolved / still open" bullets in docs/audit-2026-09-*.md
//     I  headless play sample         (--sample=N|all) play every effect of N random cards in the qa harness and count
//                                     throws / manual notes / manualOnly pendings / unresolved scripts
//
//   Usage (run from anywhere):
//     node scripts/qa/report-effect-completeness.mjs [--sample=150|all] [--seed=20261009] [--run-qa] [--qa-json=file]
//                                                    [--json=out.json] [--list=N]   (N = max rows per printed list, default 40)
//   Read-only with respect to src/ and data/ (the optional --run-qa copies the qa scripts into a temp dir first).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const LIST = Number(args.list || 40);
const rel = (p) => path.join(ROOT, p);
process.chdir(ROOT); // lib2.mjs / qa scripts read data/ relative to the cwd
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(path.resolve(ROOT, String(url)), 'utf8')) });

const S = await import(pathToFileURL(rel('src/state.js')).href);
const Fx = await import(pathToFileURL(rel('src/effects.js')).href);
const { SCRIPTS, HOOKS, OPS } = await import(pathToFileURL(rel('src/cards/index.js')).href);
await S.loadData();

const R = { generatedAt: new Date().toISOString() };
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : 'n/a');
const hr = (t) => console.log('\n=== ' + t + ' ===');
const head = (arr, n = LIST) => arr.slice(0, n).join(', ') + (arr.length > n ? `, ... (+${arr.length - n})` : '');
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

// ---------------------------------------------------------------------------------------------------------------
// A. inventory
// ---------------------------------------------------------------------------------------------------------------
hr('A. inventory');
const cards = Object.values(S.CARDS);
const byCat = {}; cards.forEach(c => inc(byCat, c.category));
const hasText = (c) => !!((c.effectKo || '').trim() || (c.inheritedKo || '').trim() || c.optionKo);
const cardsWithText = cards.filter(hasText);
R.inventory = { cards: cards.length, byCategory: byCat, cardsWithEffectText: cardsWithText.length, vanilla: cards.length - cardsWithText.length,
  scriptKeys: Object.keys(SCRIPTS).length, hookCards: Object.keys(HOOKS).length, hookDescriptors: Object.values(HOOKS).reduce((n, l) => n + l.length, 0), customOps: Object.keys(OPS).length };
console.log(JSON.stringify(R.inventory));

// ---------------------------------------------------------------------------------------------------------------
// B. classify every segment (mirrors scripts/audit-effects.mjs + scripts/scan-manual.mjs so the three stay in sync)
// ---------------------------------------------------------------------------------------------------------------
// the "handled live elsewhere" regex block is taken verbatim from audit-effects.mjs; every handler is labelled by its preceding comment
const auditSrc = fs.readFileSync(rel('scripts/audit-effects.mjs'), 'utf8');
const a0 = auditSrc.indexOf('totalSegments++;') + 'totalSegments++;'.length;
const a1 = auditSrc.indexOf('let script = [];');
let skipBody = auditSrc.slice(a0, a1);
const handlerLabels = [];
skipBody = skipBody.replace(/turnConditionalHandled\+\+;\s*continue;/g, (m, off) => {
  const before = skipBody.slice(0, off);
  const cm = [...before.matchAll(/\/\/\s*(Handled live via[^\n]*|Bespoke[^\n]*|Handled live[^\n]*)/g)].pop();
  handlerLabels.push((cm ? cm[1] : 'unlabelled').replace(/\s+/g, ' ').slice(0, 70));
  return `return ${handlerLabels.length};`;
});
const auditSkip = new Function('S', 'seg', 'cardId', 'TURN_TAGS', skipBody + '\n return 0;');
const TURN_TAGS = new Set(['자신의 턴', '상대의 턴', '서로의 턴']);

function scriptFor(t) { // mirrors main.js scriptFor
  const sp = Fx.lookupCardSpecific(t.cardId, t.tags, t.text, !!t.inherited);
  if (sp) return { script: sp, bespoke: true };
  if (/^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(t.text.trim())) {
    const m = S.parseEffectSegments(S.card(t.cardId).effectKo || '').segments.find(s => s.tags.includes('메인'));
    if (m) { const sp2 = Fx.lookupCardSpecific(t.cardId, m.tags, m.body); return { script: sp2 || Fx.compileToScript(m.body), bespoke: !!sp2 }; }
  }
  return { script: Fx.compileToScript(t.text), bespoke: false };
}

const effSrc = fs.readFileSync(rel('src/effects.js'), 'utf8');
const KNOWN_OPS = new Set([...effSrc.matchAll(/case '([A-Za-z0-9_$]+)'/g)].map(m => m[1]));
Object.keys(OPS).forEach(k => KNOWN_OPS.add(k));
const BENIGN_NOOP = /지속 효과 — 별도의 HOOKS|조건이 항상 충족됨/; // informational placeholders, not a manual request

// walk a script: collect flags. conditions are closures (cond.test) - only manualCondition() ones carry a label.
function inspectScript(script) {
  const f = { ops: 0, noop: [], manualCost: [], manualCond: [], emptyChoice: [], unknownOps: [], approxNoop: [] };
  const seen = new Set();
  (function walk(x) {
    if (!x || seen.has(x)) return;
    if (typeof x === 'function') { if (x.manualLabel) f.manualCond.push(x.manualLabel); return; }
    if (typeof x !== 'object') return;
    seen.add(x);
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x.op === 'string') {
      if (!['condition', 'costGroup', 'choice', 'effectChoice'].includes(x.op)) f.ops++;
      if (x.op === 'noop') (BENIGN_NOOP.test(x.note || '') ? f.approxNoop : f.noop).push(x.note || '');
      else if (x.op === 'manualCost') f.manualCost.push(x.text || '');
      else if (!KNOWN_OPS.has(x.op)) f.unknownOps.push(x.op);
      if ((x.op === 'effectChoice' || x.op === 'choice') && Array.isArray(x.options)) for (const o of x.options) if (!o.then || !o.then.length) f.emptyChoice.push(o.label || '');
    }
    for (const v of Object.values(x)) walk(v);
  })(script);
  return f;
}

// sentence splitter that ignores '.' inside parentheses (same idea as effects.js splitSentences)
function sentences(text) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '（') depth++;
    if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
    cur += ch;
    if (depth === 0 && (ch === '.' || ch === '。') && !/Lv$/.test(cur.slice(0, -1)) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) { out.push(cur); cur = ''; }
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.replace(/\([^()]*\)/g, '').replace(/〈룰〉.*$/s, '').trim())
    .filter(s => s.length >= 7 && !/^(?:(?:어셈블리|디지크로스)\s*-|[《≪][^》≫]*[》≫]\s*$|나머지는|남은\s*카드|오픈한\s*카드는)/.test(s));
}

const segs = []; // all segments
for (const c of cards) {
  const srcs = [['effectKo', c.effectKo], ['inheritedKo', c.inheritedKo]];
  if (c.optionKo) srcs.push(['optionKo', S.optionView(c.id).effectKo]);
  for (const [src, text] of srcs) {
    if (!text) continue;
    for (const seg of S.parseEffectSegments(text).segments) {
      const rec = { id: c.id, cat: c.category, src, tags: seg.tags, body: seg.body, tagStr: seg.tags.join('/'), cls: null, flags: null, nSent: 0 };
      segs.push(rec);
      const h = auditSkip(S, seg, c.id, TURN_TAGS);
      const hd = S.hookDescriptorFor(c.id, seg.tags, seg.body);
      rec.hook = !!hd;
      if (h && /parseDelayEffect/.test(handlerLabels[h - 1])) { // 《딜레이》: the real effect is the bullet line, compiled at use time by effects.js delayBulletPlan - inspect THAT script
        rec.cls = 'delay'; rec.handler = handlerLabels[h - 1];
        // runtime path (main.js useDelay): a pending item { tags:['메인'], text: S.parseDelayEffect(effectKo) } resolved by scriptFor
        try {
          const body = S.parseDelayEffect(src === 'optionKo' ? S.optionView(c.id).effectKo : c.effectKo);
          if (body) { const sp = Fx.lookupCardSpecific(c.id, ['메인'], body); rec.script = sp || Fx.compileToScript(body); rec.bespokeDelay = !!sp; }
          else { const plan = Fx.delayBulletPlan(S, c.id, seg.tags, seg.body); rec.script = plan ? plan.script : []; }
        } catch (e) { rec.err = String(e.message).slice(0, 80); rec.script = []; }
        rec.flags = inspectScript(rec.script);
        if (!rec.script || !rec.script.length) rec.cls = 'empty';
        continue;
      }
      if (h) { rec.cls = (hd && (!hd.events || hd.selfContained)) ? 'hook' : 'rule'; rec.handler = handlerLabels[h - 1]; if (rec.cls === 'hook') rec.handler = 'S.hookDescriptorFor (continuous/replacement hook)'; continue; }
      let r; try { r = scriptFor({ cardId: c.id, tags: seg.tags, text: seg.body, inherited: src === 'inheritedKo' }); } catch (e) { rec.cls = 'throws'; rec.err = String(e.message).slice(0, 80); rec.flags = {}; continue; }
      rec.cls = r.bespoke ? 'bespoke' : 'generic';
      rec.script = r.script;
      rec.flags = inspectScript(r.script);
      if (!r.script || !r.script.length) { rec.cls = 'empty'; }
      if (rec.cls === 'generic') {
        try { rec.dropped = Fx.droppedSentences(seg.body); } catch { rec.dropped = []; }
        rec.nSent = sentences(seg.body).length;
      }
    }
  }
}
const bySrc = {}; segs.forEach(s => inc(bySrc, s.src));
const cls = {}; segs.forEach(s => inc(cls, s.cls));
const handlerCounts = {}; segs.filter(s => s.cls === 'rule' || s.cls === 'hook').forEach(s => inc(handlerCounts, s.handler));
R.segments = { total: segs.length, bySource: bySrc, byClass: cls, handlerCounts };
hr('B. segment resolution class (total ' + segs.length + ')');
console.log('by source:', JSON.stringify(bySrc));
console.log('rule  = matches an audit-effects "handled live" regex (no script; engine rule in state.js/engine.js). hook = continuous/replacement hook descriptor. delay = 《딜레이》 option (bullet script inspected).');
console.log('bespoke = hand-written script in src/cards/*.js or CARD_SPECIFIC; generic = produced by the free-text compiler; empty/throws = nothing runnable');
for (const k of ['rule', 'hook', 'delay', 'bespoke', 'generic', 'empty', 'throws']) console.log(`  ${k.padEnd(8)} ${String(cls[k] || 0).padStart(5)}  ${pct(cls[k] || 0, segs.length)}`);
console.log('top "handled live" handlers:'); Object.entries(handlerCounts).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log('  ' + String(v).padStart(5) + '  ' + k));
const tagCls = {}; segs.forEach(s => { const k = s.tagStr; (tagCls[k] ||= {}); inc(tagCls[k], s.cls); });

// ---------------------------------------------------------------------------------------------------------------
// C. manual fallbacks
// ---------------------------------------------------------------------------------------------------------------
hr('C. segments that still ask the human (compile-time + engine-known runtime fallbacks)');
const manualRows = [];
for (const s of segs) {
  if (!s.flags) continue;
  const f = s.flags, why = [];
  if (s.cls === 'empty') why.push('EMPTY-SCRIPT');
  if (s.cls === 'throws') why.push('COMPILE-THROWS');
  f.noop && f.noop.forEach(n => why.push('noop:' + n.slice(0, 70)));
  f.manualCost && f.manualCost.forEach(n => why.push('manualCost:' + n.slice(0, 70)));
  f.manualCond && f.manualCond.forEach(n => why.push('manualCond:' + n.slice(0, 70)));
  f.emptyChoice && f.emptyChoice.forEach(n => why.push('emptyChoiceOption:' + n.slice(0, 70)));
  f.unknownOps && f.unknownOps.forEach(n => why.push('unknownOp:' + n));
  (s.dropped || []).forEach(n => why.push('droppedSentence:' + n.slice(0, 70)));
  if (why.length) manualRows.push({ id: s.id, tag: s.tagStr, src: s.src, cls: s.cls, why });
}
const kindOf = (w) => w.split(':')[0];
const manualKinds = {}; manualRows.forEach(r => r.why.forEach(w => inc(manualKinds, kindOf(w))));
const manualCards = new Set(manualRows.map(r => r.id));
const approx = segs.filter(s => s.flags && s.flags.approxNoop && s.flags.approxNoop.length);
R.manual = { segments: manualRows.length, cards: manualCards.size, kinds: manualKinds, rows: manualRows, informationalNoopSegments: approx.length };
console.log(`segments with >=1 manual fallback: ${manualRows.length} (${pct(manualRows.length, segs.length)} of segments), cards: ${manualCards.size} (${pct(manualCards.size, cardsWithText.length)} of cards with text)`);
console.log('fallback kinds (items):', JSON.stringify(manualKinds));
console.log(`(+ ${approx.length} segments carry an informational noop that is NOT counted: continuous effect handled by HOOKS / memory-position approximation)`);
for (const r of manualRows.slice(0, 200)) console.log(`  ${r.id} 【${r.tag}】 [${r.cls}] ${r.why.join(' ; ').slice(0, 150)}`);
const manualByCls = {}; manualRows.forEach(r => inc(manualByCls, r.cls));
console.log('manual rows by class:', JSON.stringify(manualByCls));
// runtime-only fallbacks that no static walk can see (shard helper ops): count source sites so the reader knows they exist
const rtSites = {};
for (const f of fs.readdirSync(rel('src/cards')).filter(f => f.endsWith('.js'))) {
  const t = fs.readFileSync(rel('src/cards/' + f), 'utf8');
  const n = (t.match(/manualOnly: true|자동 처리할 수 없|\(수동\)|수동 확인|수동 처리\)/g) || []).length;
  if (n) rtSites['src/cards/' + f] = n;
}
const mainT = fs.readFileSync(rel('src/main.js'), 'utf8');
rtSites['src/main.js'] = (mainT.match(/manualOnly: true|수동 처리|자동 인식 실패/g) || []).length;
rtSites['src/effects.js'] = (effSrc.match(/수동 처리|수동으로|manualCost|\(수동\)/g) || []).length;
R.manual.runtimeFallbackSites = rtSites;
console.log('runtime-fallback source sites (grep counts, not segments):', JSON.stringify(rtSites));

// ---------------------------------------------------------------------------------------------------------------
// D. suspected partials (generic-compiled only; bespoke scripts are hand-written for the whole segment and cannot be diffed)
// ---------------------------------------------------------------------------------------------------------------
hr('D. suspected partial automation (generic compiler output vs printed sentences)');
const generic = segs.filter(s => s.cls === 'generic');
const droppedSegs = generic.filter(s => s.dropped && s.dropped.length);
// (1) magnitude check: a printed "DP +N" / "메모리 +N" / "《N 드로우》" whose number appears nowhere in the compiled script = a lost/changed parameter
//     (generic scripts only; scripts holding closures are still checked because amounts are plain numbers in the op)
const magnitudeRows = [];
const manualSet = new Set(manualRows.map(r => r.id + '|' + r.tag + '|' + r.src));
for (const s of generic) {
  const body = s.body.replace(/\([^()]*\)/g, '').replace(/「[^」]*」/g, '');
  const want = [];
  for (const m of body.matchAll(/DP(?:를|가)?\s*([+-])\s*(\d[\d,]*)/g)) want.push(['DP', Number(m[2].replace(/,/g, ''))]);
  for (const m of body.matchAll(/메모리(?:를|가)?\s*([+-])\s*(\d+)/g)) want.push(['메모리', Number(m[2])]);
  for (const m of body.matchAll(/《\s*(\d+)\s*드로우\s*》/g)) want.push(['드로우', Number(m[1])]);
  if (!want.length) continue;
  if (JSON.stringify(s.script, (k, v) => (typeof v === 'function' ? '<fn>' : v)).includes('"afterBattle"')) continue; // afterBattle re-compiles the printed text later: amounts live in the text, not the op
  const nums = new Set(); (function w(x, seen = new Set()) { if (typeof x === 'number') { nums.add(Math.abs(x)); return; } if (!x || typeof x !== 'object' || seen.has(x)) return; seen.add(x); for (const v of Object.values(x)) w(v, seen); })(s.script);
  s.magChecked = true;
  const miss = want.filter(([, v]) => !nums.has(v));
  if (miss.length) magnitudeRows.push({ id: s.id, tag: s.tagStr, missing: miss.map(([k, v]) => k + ' ' + v), text: s.body.slice(0, 90) });
}
const magChecked = generic.filter(s => s.magChecked).length;
// (2) weak signal only (NOT used for the status buckets, high false-positive rate: one op can legitimately cover several sentences)
const fewOps = generic.filter(s => s.nSent >= 2 && s.flags.ops < s.nSent && !(s.dropped && s.dropped.length));
R.partials = { genericSegments: generic.length, droppedSentenceSegments: droppedSegs.length, droppedSentenceCards: new Set(droppedSegs.map(s => s.id)).size,
  magnitudeChecked: magChecked, magnitudeSuspects: magnitudeRows, weakFewerOpsThanSentencesSegments: fewOps.length,
  droppedRows: droppedSegs.map(s => ({ id: s.id, tag: s.tagStr, dropped: s.dropped.map(d => d.slice(0, 90)) })) };
console.log(`generic-compiled segments: ${generic.length}`);
console.log(`  engine droppedSentences (a printed sentence whose removal does not change the script): ${droppedSegs.length} segments / ${R.partials.droppedSentenceCards} cards`);
console.log(`  magnitude check (DP/메모리/드로우 amount printed but absent from script): ${magnitudeRows.length} suspects of ${magChecked} checked segments`);
magnitudeRows.forEach(r => console.log(`   suspect: ${r.id} 【${r.tag}】 missing ${r.missing.join(',')} :: ${r.text}`));
console.log(`  weak signal "multi-sentence segment, fewer leaf ops than sentences": ${fewOps.length} segments (mostly false positives: one reveal/stat op covers several sentences) - not used for buckets`);
droppedSegs.slice(0, LIST).forEach(s => console.log(`   dropped: ${s.id} 【${s.tagStr}】 ${s.dropped[0].slice(0, 80)}`));

// ---------------------------------------------------------------------------------------------------------------
// E. CPU decision surface
// ---------------------------------------------------------------------------------------------------------------
hr('E. decisions the CPU cannot make intelligently (Cpu.answerChoice)');
const srcFiles = [...fs.readdirSync(rel('src')).filter(f => f.endsWith('.js')).map(f => 'src/' + f), ...fs.readdirSync(rel('src/cards')).filter(f => f.endsWith('.js')).map(f => 'src/cards/' + f)];
const kindSites = {};
for (const f of srcFiles) for (const m of fs.readFileSync(rel(f), 'utf8').matchAll(/choose\(\s*['"]([A-Za-z]+)['"]/g)) inc(kindSites, m[1]);
const cpuT = fs.readFileSync(rel('src/cpu.js'), 'utf8');
const ac0 = cpuT.indexOf('export function answerChoice'), ac1 = cpuT.indexOf('export function fallbackAnswer');
const acBody = cpuT.slice(ac0, ac1);
const cpuKinds = new Set([...acBody.matchAll(/case '([A-Za-z]+)'/g)].map(m => m[1]));
// kinds whose CPU answer is a fixed default (not a function of the board): documented by reading answerChoice
const PURE_DEFAULT = { orderCards: 'identity order', pickPendingOrder: 'first pending item', multipleChoice: 'first non-cancel option unless prompt matches 진화 방법/조그레스 (easy: random)', confirmEffect: 'yes unless prompt regex (투항, own-security cost, optionalCost heuristic); easy: 60% random' };
R.cpu = { callSitesByKind: kindSites, kindsWithCpuCase: [...cpuKinds], kindsWithoutCpuCase: Object.keys(kindSites).filter(k => !cpuKinds.has(k)), pureDefaultKinds: PURE_DEFAULT,
  defaultKindSites: Object.entries(kindSites).filter(([k]) => PURE_DEFAULT[k]).reduce((n, [, v]) => n + v, 0), totalSites: Object.values(kindSites).reduce((a, b) => a + b, 0) };
console.log('ctx.choose call sites by kind:', JSON.stringify(kindSites));
console.log('kinds with an explicit Cpu.answerChoice case:', [...cpuKinds].join(', '));
console.log('kinds used by scripts but with NO CPU case (answer = null): ' + (R.cpu.kindsWithoutCpuCase.join(', ') || '(none)'));
console.log(`call sites whose CPU answer is a fixed default / prompt-regex guess: ${R.cpu.defaultKindSites} of ${R.cpu.totalSites} (${pct(R.cpu.defaultKindSites, R.cpu.totalSites)}) - ` + Object.entries(PURE_DEFAULT).map(([k, v]) => `${k}=${v}`).join(' | '));

// ---------------------------------------------------------------------------------------------------------------
// F. verification coverage
// ---------------------------------------------------------------------------------------------------------------
hr('F. verification: regression scripts and Q&A rulings');
const ID_RE = /\b([A-Z]{1,3}\d{0,2}-\d{2,3})\b/g;
const isReg = (f) => /^(qa-.*|test-.*)\.mjs$/.test(f);
const regFiles = [...fs.readdirSync(rel('scripts/qa')).filter(isReg).map(f => 'scripts/qa/' + f), ...fs.readdirSync(rel('scripts')).filter(f => isReg(f)).map(f => 'scripts/' + f)];
const idToFiles = {};
const citedQ = new Set();
for (const f of regFiles) {
  const t = fs.readFileSync(rel(f), 'utf8');
  for (const m of new Set([...t.matchAll(ID_RE)].map(m => m[1]))) if (S.CARDS[m]) (idToFiles[m] ||= []).push(f);
  for (const m of t.matchAll(/\bQ(\d{3,4})((?:\s*[\/,]\s*\d{3,4})*)/g)) { citedQ.add(+m[1]); for (const x of m[2].matchAll(/\d{3,4}/g)) citedQ.add(+x[0]); }
  for (const m of t.matchAll(/\bq:\s*(\d{3,4})\b/g)) citedQ.add(+m[1]);
}
const docFiles = fs.readdirSync(rel('docs')).filter(f => /^(verify|audit|qa-slice|rc|starter|fix|rule-oracle|ko-overrides|dual|ex13|measure|cpu-human)/.test(f) && f.endsWith('.md'));
const idToDocs = {};
for (const f of docFiles) { const t = fs.readFileSync(rel('docs/' + f), 'utf8'); for (const m of new Set([...t.matchAll(ID_RE)].map(m => m[1]))) if (S.CARDS[m]) (idToDocs[m] ||= []).push(f); }

// optional full qa run (or reuse a previous result): scripts whose run failed do not count as verification
let qaRun = null;
if (args['qa-json'] && fs.existsSync(String(args['qa-json']))) qaRun = JSON.parse(fs.readFileSync(String(args['qa-json']), 'utf8'));
if (args['run-qa']) qaRun = await runAllQa();
async function runAllQa() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'effqa-'));
  fs.mkdirSync(path.join(tmp, 'scripts/qa'), { recursive: true });
  for (const d of ['data', 'src']) fs.symlinkSync(rel(d), path.join(tmp, d), 'junction');
  for (const e of fs.readdirSync(rel('scripts'))) { if (e === 'qa') continue; const p = rel('scripts/' + e); if (fs.statSync(p).isDirectory()) fs.symlinkSync(p, path.join(tmp, 'scripts', e), 'junction'); else fs.copyFileSync(p, path.join(tmp, 'scripts', e)); }
  for (const e of fs.readdirSync(rel('scripts/qa'))) { const p = rel('scripts/qa/' + e); if (fs.statSync(p).isDirectory()) fs.symlinkSync(p, path.join(tmp, 'scripts/qa', e), 'junction'); else fs.copyFileSync(p, path.join(tmp, 'scripts/qa', e)); }
  const files = fs.readdirSync(rel('scripts/qa')).filter(f => /^qa-.*\.mjs$/.test(f)).sort();
  const out = {}; let i = 0;
  const runOne = (f) => new Promise(res => {
    const t0 = Date.now(); const p = spawn(process.execPath, [path.join(tmp, 'scripts/qa', f)], { cwd: tmp }); let buf = '';
    const add = d => { buf += d; if (buf.length > 100000) buf = buf.slice(-50000); }; p.stdout.on('data', add); p.stderr.on('data', add);
    const to = setTimeout(() => { p.kill(); out[f] = { timeout: true }; res(); }, 300000);
    p.on('close', code => { clearTimeout(to); if (out[f]) return res(); const ms = [...buf.matchAll(/pass(?:ed)?\D{0,3}(\d+)[^\n]*?fail(?:ed)?\D{0,3}(\d+)/gi)]; const l = ms[ms.length - 1]; out[f] = { code, ms: Date.now() - t0, pass: l ? +l[1] : null, fail: l ? +l[2] : null }; res(); });
  });
  await Promise.all(Array.from({ length: 6 }, async () => { while (i < files.length) await runOne(files[i++]); }));
  // cleanup: remove the junction links FIRST (rmdir on a junction removes only the link), then the copied files
  const unlinkLinks = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (fs.lstatSync(p).isSymbolicLink()) fs.rmdirSync(p); else if (e.isDirectory()) unlinkLinks(p); } };
  try { unlinkLinks(tmp); fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { console.log('(temp cleanup skipped: ' + e.message + ')'); }
  return out;
}
const qaOk = (f) => { if (!qaRun) return true; const r = qaRun[path.basename(f)]; return !r || (!r.timeout && r.code === 0 && !r.fail); };
if (qaRun) {
  const ent = Object.entries(qaRun); const bad = ent.filter(([f, r]) => !qaOk(f));
  R.qaRun = { scripts: ent.length, failing: bad.map(([f]) => f), scenariosPass: ent.reduce((n, [, r]) => n + (r.pass || 0), 0), scenariosFail: ent.reduce((n, [, r]) => n + (r.fail || 0), 0) };
  console.log(`qa run: ${ent.length} scripts, failing/timeout: ${bad.length}${bad.length ? ' (' + bad.map(b => b[0]).join(', ') + ')' : ''}; scenarios pass ${R.qaRun.scenariosPass} fail ${R.qaRun.scenariosFail} (counts parsed from "pass N ... fail M" lines; ${ent.filter(([, r]) => r.pass == null).length} scripts print no such line)`);
} else console.log('(qa scripts were not executed in this run; pass --run-qa or --qa-json=file to include pass/fail. "verified" below = a passing-or-unknown script NAMES the card)');
const verifiedId = (id) => (idToFiles[id] || []).some(qaOk);

// per-card status: worst segment decides
const cardSegs = {}; segs.forEach(s => (cardSegs[s.id] ||= []).push(s));
const manualCardSet = manualCards;
const partialCardSet = new Set([...droppedSegs.map(s => s.id), ...magnitudeRows.map(r => r.id)]);
const status = {}; const statusCards = { MANUAL: [], PARTIAL: [], AUTO_UNVERIFIED: [], AUTO_REVIEWED_DOC_ONLY: [], AUTO_VERIFIED: [] };
for (const id of Object.keys(cardSegs)) {
  let st;
  if (manualCardSet.has(id)) st = 'MANUAL';
  else if (partialCardSet.has(id)) st = 'PARTIAL';
  else if (verifiedId(id)) st = 'AUTO_VERIFIED';
  else if ((idToDocs[id] || []).length) st = 'AUTO_REVIEWED_DOC_ONLY';
  else st = 'AUTO_UNVERIFIED';
  status[id] = st; statusCards[st].push(id);
}
const nC = Object.keys(cardSegs).length;
R.cardStatus = Object.fromEntries(Object.entries(statusCards).map(([k, v]) => [k, v.length]));
R.cardStatus.total = nC;
R.cardStatusLists = { MANUAL: statusCards.MANUAL, PARTIAL: statusCards.PARTIAL, AUTO_UNVERIFIED: statusCards.AUTO_UNVERIFIED };
console.log(`cards with effect text: ${nC}`);
for (const k of Object.keys(statusCards)) console.log(`  ${k.padEnd(24)} ${String(statusCards[k].length).padStart(5)}  ${pct(statusCards[k].length, nC)}`);
console.log('  MANUAL  = >=1 segment still ships a manual fallback (noop / manualCost / manual condition / empty option / unknown op / empty script)');
console.log('  PARTIAL = engine-detected dropped printed sentence OR a printed DP/memory/draw amount missing from the compiled script');
console.log('  AUTO_VERIFIED = fully scripted AND named in >=1 regression script;  AUTO_REVIEWED_DOC_ONLY = named only in docs/(verify|audit|...)*.md review notes;  AUTO_UNVERIFIED = neither');
// same by segment
const segStatus = {}; for (const s of segs) { const st = (manualSet.has(s.id + '|' + s.tagStr + '|' + s.src) || s.cls === 'empty' || s.cls === 'throws') ? 'MANUAL' : ((s.dropped && s.dropped.length) || magnitudeRows.some(r => r.id === s.id && r.tag === s.tagStr)) ? 'PARTIAL' : verifiedId(s.id) ? 'AUTO_VERIFIED' : (idToDocs[s.id] || []).length ? 'AUTO_REVIEWED_DOC_ONLY' : 'AUTO_UNVERIFIED'; inc(segStatus, st); }
R.segmentStatus = segStatus;
console.log('segments:', Object.entries(segStatus).map(([k, v]) => `${k}=${v} (${pct(v, segs.length)})`).join('  '));
// bespoke vs rule/hook within unverified
const unvCls = {}; segs.filter(s => !verifiedId(s.id)).forEach(s => inc(unvCls, s.cls));
console.log('segments of cards NOT named by any regression script, by class:', JSON.stringify(unvCls));

// rulings
const rulings = JSON.parse(fs.readFileSync(rel('data/rulings/all.json'), 'utf8'));
const rByCard = {}; let rNoCard = 0;
for (const r of rulings) { const ids = new Set(); for (const s of [r.card, ...(r.cards || [])]) for (const m of String(s || '').matchAll(ID_RE)) ids.add(m[1]); if (!ids.size) rNoCard++; for (const id of ids) inc(rByCard, id); }
const rCards = Object.keys(rByCard);
const rKnown = rCards.filter(id => S.CARDS[id]), rMissing = rCards.filter(id => !S.CARDS[id]);
const rCovered = rKnown.filter(id => (idToFiles[id] || []).length), rUncovered = rKnown.filter(id => !(idToFiles[id] || []).length);
const rUncoveredRulings = rUncovered.reduce((n, id) => n + rByCard[id], 0);
const citedIds = rulings.filter(r => citedQ.has(r.id)).length;
R.rulings = { total: rulings.length, distinctCards: rCards.length, cardsInDb: rKnown.length, cardsMissingFromDb: rMissing, cardsWithRegressionScript: rCovered.length, cardsWithoutRegressionScript: rUncovered.length,
  rulingsOnCardsWithoutScript: rUncoveredRulings, rulingIdsCitedInScripts: citedIds, uncoveredCardsTop: rUncovered.sort((a, b) => rByCard[b] - rByCard[a]).slice(0, 80).map(id => id + ':' + rByCard[id]) };
console.log(`rulings: ${rulings.length} entries on ${rCards.length} distinct card ids (${rKnown.length} in DB, ${rMissing.length} missing from DB)`);
console.log(`  cards-with-rulings that have a regression script naming them: ${rCovered.length}/${rKnown.length} (${pct(rCovered.length, rKnown.length)}); WITHOUT: ${rUncovered.length} cards carrying ${rUncoveredRulings} rulings`);
console.log(`  ruling ids explicitly cited as Q#### / q: #### in qa scripts: ${citedIds}/${rulings.length} (${pct(citedIds, rulings.length)}) - lower bound for "this exact ruling has a scenario"`);
console.log('  biggest ruling-bearing cards with no regression script: ' + head(R.rulings.uncoveredCardsTop, 25));

// ---------------------------------------------------------------------------------------------------------------
// G. data gaps
// ---------------------------------------------------------------------------------------------------------------
hr('G. data gaps');
const noKo = cards.filter(c => !(c.effectKo || '').trim() && !(c.inheritedKo || '').trim() && !c.optionKo && ((c.effectEn || '').trim() || (c.inheritedEn || '').trim()));
R.dataGaps = { rulingCardsMissingFromDb: rMissing.map(id => id + ' (' + rByCard[id] + ' rulings)'), cardsWithEnglishButNoKoreanText: noKo.map(c => c.id) };
console.log('cards named by rulings but absent from data/cards_full.json:', R.dataGaps.rulingCardsMissingFromDb.join(', ') || '(none)');
console.log(`cards that have English effect text but NO Korean effect/inherited text (nothing for the compiler to read): ${noKo.length}${noKo.length ? ' -> ' + head(noKo.map(c => c.id)) : ''}`);

// ---------------------------------------------------------------------------------------------------------------
// H. documented structural gaps (counts only; the curated list lives in docs/effect-completeness-2026-10.md)
// ---------------------------------------------------------------------------------------------------------------
hr('H. "unresolved / still open" bullets in docs/audit-2026-09-*.md');
const gapRe = /unresolved|still open|not fixed|deferred|flagged|gaps|caveats|limits|not touched|inconclusive|open/i;
const docGaps = {};
for (const f of fs.readdirSync(rel('docs')).filter(f => /^audit-2026-09-.*\.md$/.test(f))) {
  const lines = fs.readFileSync(rel('docs/' + f), 'utf8').split(/\r?\n/); let on = false, n = 0;
  for (const ln of lines) { if (/^#{1,4}\s/.test(ln)) on = gapRe.test(ln) && !/^#\s/.test(ln); else if (on && /^\s*(?:[-*]|\d+\.|\|\s*[^-|\s])/.test(ln)) n++; }
  if (n) docGaps[f] = n;
}
R.docGaps = docGaps;
console.log(JSON.stringify(docGaps), 'total bullets/rows:', Object.values(docGaps).reduce((a, b) => a + b, 0));

// ---------------------------------------------------------------------------------------------------------------
// I. headless play sample
// ---------------------------------------------------------------------------------------------------------------
if (args.sample) {
  hr('I. headless play sample');
  const lib = await import(pathToFileURL(rel('scripts/qa/lib2.mjs')).href);
  const { world, fillOf, S: S2, E, Fx: Fx2 } = lib;
  const seed = Number(args.seed || 20261009);
  let a = seed >>> 0; const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pool = cardsWithText.filter(c => ['digimon', 'tamer', 'option', 'digitama'].includes(c.category));
  let sample = pool.slice();
  if (args.sample !== 'all') { const n = Number(args.sample); for (let i = sample.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sample[i], sample[j]] = [sample[j], sample[i]]; } sample = sample.slice(0, n); }
  const filler = fillOf(c => c.level === 3 && c.dp)[0], filler4 = fillOf(c => c.level === 4 && c.dp)[0] || filler;
  const MANUAL_LOG = /수동|자동 처리할 수 없|\(확인\)|처리하세요/;
  const res = { cards: sample.length, scenarios: 0, scenariosFired: 0, scenariosOwnFired: 0, ownFiredCards: new Set(), pendingResolved: 0, exercisedCards: 0, notExercised: [], throws: [], manualNotes: [], manualOnlyPending: [], noScriptPending: [], promptKinds: {}, manualPrompts: [], hung: [] };
  async function scenario(c, name, setup) {
    const W = world({ memory: 5 });
    const tag = `${c.id}/${name}`;
    const fired = { n: 0, own: 0 };
    // a slightly populated board so target/cost pickers have candidates: hands, trashes, a second digimon each side
    W.hand('p1', [filler, filler4, filler, filler4]); W.hand('p2', [filler, filler4, filler]); W.trash('p1', [filler, filler4, filler4]); W.trash('p2', [filler, filler4]);
    W.put('p2', [filler4]); W.put('p1', [filler4]);
    W.choose = ((orig) => async (k, o) => { inc(res.promptKinds, k); if (k === 'confirmEffect' && /수동/.test(String(o && o.prompt))) res.manualPrompts.push(tag + ': ' + String(o.prompt).slice(0, 90)); return orig(k, o); })(W.choose);
    W.drain = async () => { // lib2 drain + manualOnly / no-script bookkeeping
      let g = 0;
      while (g++ < 60) {
        const t = W.st.pending.find(x => !x.resolved); if (!t) break;
        try {
          if (t.schedFn) { t.schedFn(); S2.resolvePending(W.st, t.uid); continue; }
          if (t.manualOnly) { res.manualOnlyPending.push(tag + ': ' + String(t.note || t.text).slice(0, 80)); S2.resolvePending(W.st, t.uid); continue; }
          const specific = Fx2.lookupCardSpecific(t.cardId, t.tags, t.text, !!t.inherited);
          const script = specific || Fx2.compileToScript(t.text);
          fired.n++; if (t.cardId === c.id) fired.own++;
          if (!script || !script.length) { res.noScriptPending.push(tag + ': ' + t.cardId + ' ' + t.tags.join('/')); S2.resolvePending(W.st, t.uid); continue; }
          const ctx = { state: W.st, S: S2, E, self: t.player, opp: S2.opponentOf(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t, startAttack() {}, securityCheck: async () => {}, choose: W.choose };
          await Fx2.runScript(script, ctx);
        } catch (e) { W.errors.push(String((e && e.stack) || e).split('\n').slice(0, 2).join(' | ')); }
        S2.resolvePending(W.st, t.uid);
      }
    };
    const log0 = W.st.log.length;
    try { await setup(W); await W.drain(); }
    catch (e) { W.errors.push('scenario: ' + String((e && e.stack) || e).split('\n').slice(0, 2).join(' | ')); }
    res.scenarios++; if (fired.n) res.scenariosFired++; if (fired.own) { res.scenariosOwnFired++; res.ownFiredCards.add(c.id); } res.pendingResolved += fired.n;
    W.errors.forEach(e => res.throws.push(tag + ': ' + e.slice(0, 200)));
    for (const ent of W.st.log.slice(0, Math.max(0, W.st.log.length - log0 + 50))) { const m = String(ent.msg || ent); if (MANUAL_LOG.test(m) && !/지속 효과 — 별도|효과 트리거 대상일 수 있음/.test(m)) { res.manualNotes.push(tag + ': ' + m.slice(0, 120)); break; } }
    return W;
  }
  const tagsOf = (c) => { const t = new Set(); for (const src of ['effectKo', 'inheritedKo']) for (const sg of S.parseEffectSegments(src === 'effectKo' && c.optionKo ? S.optionView(c.id).effectKo : c[src] || '').segments) sg.tags.forEach(x => t.add(x)); return t; };
  for (const c of sample) {
    const tags = tagsOf(c), has = (re) => [...tags].some(t => re.test(t));
    const kinds = [];
    if (c.category === 'option') kinds.push(['use', async (W) => { await W.useOption('p1', c.id); }]);
    else {
      kinds.push(['play', async (W) => { await W.play('p1', c.id); }]);
      if (has(/진화 시/)) kinds.push(['evolve', async (W) => { const b = W.put('p1', [filler]); await W.evolve('p1', b.uid, c.id, 0); }]);
      if (has(/어택 시|어택 종료 시|서로의 턴|자신의 턴/)) kinds.push(['attack', async (W) => { const s = W.put('p1', [c.id]); W.put('p2', [filler]); await W.attack('p1', s.uid, null); }]);
      if (has(/소멸 시/)) kinds.push(['delete', async (W) => { const s = W.put('p1', [c.id]); S2.deleteStack(W.st, 'p1', s.uid, 'trash', null); await W.drain(); }]);
      if (has(/턴 개시|메인 페이즈 개시|턴 종료/)) kinds.push(['turn', async (W) => { W.put('p1', [filler]); W.put('p1', [c.id]); await W.newTurn('p1'); await W.newTurn('p2'); }]);
      if (has(/시큐리티/)) kinds.push(['security', async (W) => { const a = W.put('p1', [filler4]); W.sec('p2', [c.id, filler]); await W.attack('p1', a.uid, null); }]);
      if (has(/메인/) && (cardSegs[c.id] || []).some(s => s.tags.includes('메인') && (s.cls === 'bespoke' || s.cls === 'generic'))) kinds.push(['main', async (W) => { const s = W.put('p1', [c.id]); await W.fire('p1', s, 'use'); }]);
      if (c.inheritedKo && String(c.inheritedKo).trim()) kinds.push(['inherited', async (W) => { const s = W.put('p1', [filler, c.id]); W.put('p2', [filler]); await W.attack('p1', s.uid, null); await W.newTurn('p1'); }]);
    }
    if (!kinds.length) { res.notExercised.push(c.id); continue; }
    res.exercisedCards++;
    for (const [name, fn] of kinds) await scenario(c, name, fn);
  }
  const uniq = (a) => [...new Set(a.map(x => x.split(':')[0]))];
  R.sample = { seed, ...res, ownFiredCards: [...res.ownFiredCards].length, ownFiredNot: sample.filter(c => !res.ownFiredCards.has(c.id)).map(c => c.id), throwCards: uniq(res.throws), manualNoteCards: uniq(res.manualNotes), manualOnlyCards: uniq(res.manualOnlyPending), noScriptCards: uniq(res.noScriptPending).map(x => x.split('/')[0]) };
  console.log(`sampled ${res.cards} cards (seed ${seed}); ${res.exercisedCards} exercised in ${res.scenarios} headless scenarios (play/evolve/attack/delete/turn/security/main/inherited as the printed tags require)`);
  console.log(`  scenarios in which >=1 pending effect actually ran: ${res.scenariosFired}/${res.scenarios}; in which the sampled card's OWN effect ran: ${res.scenariosOwnFired}/${res.scenarios} (${res.ownFiredCards.size}/${res.cards} cards); pending effects resolved: ${res.pendingResolved}`);
  console.log(`  scenarios that THREW: ${res.throws.length} (${new Set(res.throws.map(x => x.split('/')[0])).size} cards)`);
  console.log(`  scenarios that logged a manual/"처리하세요" note: ${res.manualNotes.length} (${new Set(res.manualNotes.map(x => x.split('/')[0])).size} cards)`);
  console.log(`  manualOnly pending items: ${res.manualOnlyPending.length}; pending items with NO script: ${res.noScriptPending.length}; manual confirm prompts ("(수동)"): ${res.manualPrompts.length}`);
  console.log(`  prompt kinds raised: ${JSON.stringify(res.promptKinds)}`);
  const dynManual = new Set([...res.manualNotes, ...res.manualPrompts, ...res.manualOnlyPending, ...res.noScriptPending].map(x => x.split('/')[0]));
  R.sample.dynamicManualCards = [...dynManual]; R.sample.dynamicManualNotInStatic = [...dynManual].filter(id => !manualCards.has(id));
  R.sample.staticManualCardsNeverTriggeredDynamically = sample.length === pool.length ? [...manualCards].filter(id => !dynManual.has(id)) : null;
  console.log(`  cross-check: ${dynManual.size} cards showed a manual fallback at run time; not in the static list: ${R.sample.dynamicManualNotInStatic.join(', ') || '(none)'}; static-manual cards whose fallback was not hit by a scenario: ${R.sample.staticManualCardsNeverTriggeredDynamically ? R.sample.staticManualCardsNeverTriggeredDynamically.join(', ') || '(none)' : 'n/a (sample < all)'}`);
  console.log(`  cards with no scenario we could drive (e.g. pure 【카운터】/continuous-only): ${res.notExercised.length}`);
  for (const k of ['throws', 'manualNotes', 'manualOnlyPending', 'noScriptPending', 'manualPrompts']) res[k].slice(0, LIST).forEach(x => console.log(`   [${k}] ${x}`));
}

if (args.json) { fs.writeFileSync(String(args.json), JSON.stringify(R, null, 1)); console.log('\nwrote ' + args.json); }
process.exit(0);
