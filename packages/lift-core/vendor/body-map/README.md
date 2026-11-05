# body-map (vendored)

the front/back body figure in `src/body.ts` (`BODY_FIGURES`) is converted from
the male figure in react-native-body-highlighter.

- source: https://github.com/HichamELBSI/react-native-body-highlighter
  (npm: https://www.npmjs.com/package/react-native-body-highlighter)
- version: 3.2.0, from the published npm tarball
  (`react-native-body-highlighter-3.2.0.tgz`, sha256
  `ffa9e4e2286ea0dfc3ca48b9f46adf4cd4fff22a5728a6af678c25391ff130d0`), fetched 2026-11-04
- license: MIT, copyright (c) 2022 ELABBASSI Hicham, see
  `react-native-body-highlighter/LICENSE` (upstream file, unmodified). the art
  ships inside the package as plain path data under that same license; the
  package has no separate asset license or notice.

## files

`react-native-body-highlighter/` holds the upstream files byte-for-byte, renamed
with a `.txt` suffix so nothing lints, bundles or runs them:

| file here                   | upstream path in the tarball            | what it holds                     |
| --------------------------- | --------------------------------------- | --------------------------------- |
| `bodyFront.js.txt`          | `package/dist/assets/bodyFront.js`      | front muscle/part paths           |
| `bodyBack.js.txt`           | `package/dist/assets/bodyBack.js`       | back muscle/part paths            |
| `SvgMaleWrapper.js.txt`     | `package/dist/components/SvgMaleWrapper.js` | front/back silhouette outlines |
| `LICENSE`                   | `package/LICENSE`                       | mit license                       |

## conversion

`build-body-map.mjs` reads those files as text (it never imports them),
normalizes every path to absolute `M/L/C/Q/Z` (arcs become cubics), moves the
back view onto the front's coordinates, scales by 0.25, crops to the figure,
drops sub-0.25-unit detail, maps upstream slugs to our `MuscleRegion` ids and
rewrites the `@generated` block in `src/body.ts`.

upstream slug -> our regions:

| upstream                       | ours                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| chest                          | chest                                                       |
| deltoids (front view)          | front_delts + side_delts                                    |
| deltoids (back view)           | rear_delts + side_delts                                     |
| biceps / triceps               | biceps / triceps                                            |
| forearm                        | forearms                                                    |
| trapezius                      | traps                                                       |
| neck                           | neck                                                        |
| abs / obliques                 | abs / obliques                                              |
| upper-back                     | lats (the lat sweep), upper_back (teres/infraspinatus)      |
| lower-back                     | lower_back (erectors), obliques (the waist edge)            |
| gluteal                        | glutes (glute max), abductors (glute medius)                |
| quadriceps / hamstring         | quads / hamstrings                                          |
| adductors                      | adductors                                                   |
| calves                         | calves                                                      |
| tibialis, knees, ankles, feet, hands, head, hair | drawn, never shaded (`region: null`)      |

to update: replace the four files from a newer tarball, bump the version and
hash above, then run `node packages/lift-core/vendor/body-map/build-body-map.mjs`
and `npx vitest run packages/lift-core`.
