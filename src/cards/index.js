// Per-card bespoke scripts, one file per shard. Each shard exports
//   SCRIPTS: { 'CARD-ID::firstTag': [ ...ops ] }   (key = cardId + '::' + segment.tags[0])
//   OPS:     { opName: async (instr, ctx) => {} }   (custom ops used by that shard's scripts)
import * as s1 from './shard1.js';
import * as s2 from './shard2.js';
import * as s3 from './shard3.js';
import * as s4 from './shard4.js';
import * as s5 from './shard5.js';
import * as s6 from './shard6.js';
import * as s7 from './shard7.js';
import * as s8 from './shard8.js';
import * as s10 from './shard10.js';
import * as s11 from './shard11.js';
import * as s12 from './shard12.js';
import * as s13 from './shard13.js';
import * as s14 from './shard14.js';
import * as s15 from './shard15.js';
import * as s16 from './shard16.js';
import * as s17 from './shard17.js';
import * as s18 from './shard18.js';
import * as s19 from './shard19.js';
import * as s20 from './shard20.js';
import * as s21 from './shard21.js';
import * as s22 from './shard22.js';
import * as s23 from './shard23.js';
import * as s24 from './shard24.js';
import * as s31 from './shard31.js';
import * as s32 from './shard32.js';
import * as s34 from './shard34.js';
import * as s35 from './shard35.js';
import * as s36 from './shard36.js';
import * as s37 from './shard37.js';
import * as s38 from './shard38.js';
import * as s39 from './shard39.js';
import * as s41 from './shard41.js';
import * as s42 from './shard42.js';
import * as s43 from './shard43.js';
import * as s44 from './shard44.js';
import * as s45 from './shard45.js';
import * as s46 from './shard46.js';
import * as s47 from './shard47.js';
import * as s48 from './shard48.js';
import * as s49 from './shard49.js';
import * as s49b from './shard49b.js';
import * as s50 from './shard50.js';
import * as s51 from './shard51.js';
import * as s52 from './shard52.js';
import * as s53 from './shard53.js';
import * as s54 from './shard54.js';
import * as s61 from './shard61.js';

const shards = [s1, s2, s3, s4, s5, s6, s7, s8, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s31, s32, s34, s35, s36, s37, s38, s39, s41, s42, s43, s44, s45, s46, s47, s48, s49, s49b, s50, s51, s52, s53, s54, s61];
export const SCRIPTS = Object.assign({}, ...shards.map(s => s.SCRIPTS));
export const OPS = Object.assign({}, ...shards.map(s => s.OPS));
// Optional per-shard continuous/replacement/event hooks (consumed by state.js): { 'CARD-ID': [descriptor, ...] }.
// A shard that has none simply doesn't export HOOKS.
export const HOOKS = {};
for (const s of shards) for (const [id, list] of Object.entries(s.HOOKS || {})) HOOKS[id] = (HOOKS[id] || []).concat(list);
