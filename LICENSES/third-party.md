# third-party material

code and data in this repo that came from elsewhere, with its license. the
full license texts live next to the vendored copies.

## react-native-body-highlighter (body figure art)

- used in: `packages/lift-core/src/body.ts` (`BODY_FIGURES`, the front/back
  muscle figure on the site), converted from
  `packages/lift-core/vendor/body-map/react-native-body-highlighter/`
- source: https://github.com/HichamELBSI/react-native-body-highlighter, npm
  `react-native-body-highlighter@3.2.0`
- license: MIT
- copyright (c) 2022 ELABBASSI Hicham
- license text: `packages/lift-core/vendor/body-map/react-native-body-highlighter/LICENSE`
- changes: paths normalized to absolute commands, rescaled, simplified below
  a quarter unit, and regrouped by our muscle regions (see
  `packages/lift-core/vendor/body-map/README.md`)

## free-exercise-db (exercise catalog)

- used in: `packages/lift-core/src/catalog/free-exercises.json`, built from
  `packages/lift-core/vendor/free-exercise-db/exercises.json`
- source: https://github.com/yuhonas/free-exercise-db
- license: Unlicense (public domain dedication)
- license text: `packages/lift-core/vendor/free-exercise-db/LICENSE.md`


## Hugeicons (activity icons)

- used in: `public/icons/activities/*.svg`, generated from `src/lib/activity-icons.ts`
  by `scripts/icons/build.mts`
- source: https://hugeicons.com, npm `@hugeicons/core-free-icons@4.4.0` (free set)
- license: MIT, copyright (c) Hugeicons
- license text: `public/icons/activities/LICENSE.md`
- changes: drawn at stroke width 2; `dumbbell.svg` has a straight bar.
  `hiking-boot.svg` is original.
