// exports the set of Q ids (as strings) that have a slice-3 scenario (Q-prefixed anywhere, plus bare 4-digit ids in the e/f template files)
import * as fs from 'fs';
export function builtSet() {
  const built = new Set(); const files = fs.readdirSync('scripts/qa').filter(f => /^qa-slice3/.test(f));
  for (const f of files) { const s = fs.readFileSync('scripts/qa/' + f, 'utf8'); for (const m of s.matchAll(/Q(\d{4})/g)) built.add(m[1]); if (/r2-[ef]\.mjs$/.test(f)) for (const m of s.matchAll(/\b(\d{4})\b/g)) built.add(m[1]); }
  return built;
}
