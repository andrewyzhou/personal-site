# free-exercise-db (vendored)

- source: https://github.com/yuhonas/free-exercise-db
- file: `dist/exercises.json`, kept byte-for-byte as published upstream
  (https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json)
- commit: `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` (2026-09-27), fetched 2026-11-04
- license: Unlicense (public domain), see `LICENSE.md` (upstream file, unmodified)

`scripts/build-free-exercises.mjs` slims this into `src/catalog/free-exercises.json`.
to update: download a newer `dist/exercises.json` over this one, bump the commit
above, then run `node packages/lift-core/scripts/build-free-exercises.mjs`.
