# third-party material

code and data in this repo that came from elsewhere, with its license. the
full license texts live next to the vendored copies.

## react-native-body-highlighter (body figure art)

- used in: `packages/lift-core/src/body.ts` (`BODY_FIGURES`, the front/back
  muscle figure on the site and in the lift app), converted from
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
