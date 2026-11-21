[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Snowbow19/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Snowbow19/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-fast

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers exactly as
csv-reader does on every case (`{columns, rows, errors}`), but reads the text in
one pass with index-based field splitting instead of one character at a time.

`main.ts` is the harness driver: it reads every case from `/input/cases.json`,
answers each with `run` from `solve.js`, and writes `/output/answers.json`.

Built for the make.fun bounty
[Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121).
