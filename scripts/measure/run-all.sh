#!/bin/sh
# Runs every experiment sequentially (approx. 1 h on 12 cores).  Raw per-game records -> $MEASURE_OUT/<exp>.json
cd "$(dirname "$0")/../.."
export PER=${PER:-3000}
for e in base levels levelsX mull breed mem atk comp starters; do node scripts/measure/run.mjs $e - 11 < /dev/null; done
node scripts/measure/run.mjs rand 30000 11 < /dev/null
