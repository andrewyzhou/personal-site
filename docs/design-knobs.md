# design knobs

A catalog of every design-tweakable value in the public-facing frontend, organized by area. All paths are relative to the repo root; line numbers are current as of this writing (they drift as files change — the selector/class names are the durable anchors).

## how colors work (read this first)

Colors are driven by CSS custom properties, not hardcoded per component. Two theme blocks in `src/app/globals.css` define every semantic color:

- **Dark mode (default)** — `:root` at `src/app/globals.css:40`
- **Light mode** — `.theme-light` at `src/app/globals.css:68`

To recolor the whole site, edit those two blocks. The variables you'll most often touch: `--theme-bg` (page background), `--theme-text` (default body text), `--theme-text-primary` (bright/emphasis text), `--theme-text-muted` (dim text), `--theme-divider`, the `--theme-highlight-*` set (link chips), the `--theme-card-bg` set (cards), and `--contrib-0..4` (GitHub graph cells).

Components reference these via Tailwind-looking utility classes that are actually remapped to the CSS vars in `src/app/globals.css` (block starting ~line 403):

| class | resolves to var | meaning |
|---|---|---|
| `text-off-white` | `--theme-text-primary` | bright text |
| `text-gray` | `--theme-text-muted` | dim/secondary text |
| `text-secondary` | `--theme-text` | default body text |
| `hover:text-off-white` | `--theme-text-primary` | hover bright |
| `hover:text-secondary` | `--theme-text` | hover default |
| `bg-off-white` | `--theme-text-primary` | solid fill |
| `card-bg` | `--theme-card-bg` | card fill |
| `card-bg-hover:hover` | `--theme-card-bg-hover` | card hover fill |
| `headshot-border` | `--theme-headshot-bg` | headshot frame |

So `text-gray` etc. never carry a literal color — change the value once in the theme block and every use follows.

**Spacing caveat:** the global reset `* { margin: 0; padding: 0 }` at `src/app/globals.css:18-22` is unlayered, so it overrides Tailwind's `p-*`/`m-*`/`space-y-*` utilities (Tailwind utilities live in a CSS layer and lose to unlayered rules). That means classes like `py-16`, `mb-8`, `mt-4`, `space-y-2`, `p-1` are **dead** — they render as zero. Real spacing is done with inline `style={{}}` attributes, and those are the knobs reported below. Exceptions that still work: **`gap-*` (flex/grid gap) is live** (it's the `gap` property, not margin), and an important-flagged class like `!p-5` wins over the reset.

---

## 1. Global theme & primitives — `src/app/globals.css`

### UI knobs (`:root`, line 43)
- `--ui-highlight-radius` → roundness of link-highlight pills AND calendar day/activity cells → `4px`

### Color tokens (`@theme`, lines 3-16)
- `4-8` → brand colors → off-black `#101010`, off-white `#EEEEEE`, secondary `#CCCCCC`, gray `#AAAAAA`, divider `#303030`
- `10-11` → `--font-sans` / `--font-serif` → Funnel Sans stack
- `14-15` → custom breakpoints → `activity` 1152px, `activity-stack` 768px

### Dark theme vars (`:root`, ~40-66) / Light theme vars (`.theme-light`, ~68-88)
- page background `--theme-bg` → `#101010` / `#EEEEEE`
- body text `--theme-text` → `#CCCCCC` / `#333333`
- bright text `--theme-text-primary` → `#EEEEEE` / `#101010`
- muted text `--theme-text-muted` → `#AAAAAA` / `#555555`
- divider `--theme-divider` → `#303030` / `#CFCFCF`
- link-chip backgrounds (`--theme-highlight-bg`, `-hover`, `-active`) → rgba white 0.08/0.15/0.18 (dark) vs rgba black 0.08/0.15/0.18 (light)
- card fills (`--theme-card-bg`, `--theme-card-bg-hover`) → rgba white 0.10/0.05 vs rgba black 0.08/0.05
- headshot frame `--theme-headshot-bg` → `#DCDCDC`
- scrollbar track/thumb/thumb-hover colors
- GitHub contribution levels `--contrib-0..4` (empty→max)

### Cursor halo (lines ~96-149) — NEW
- `.cursor-halo-dot` (117) → resting size `26px`, background `var(--theme-text-primary)`, transition `0.18s`
- `.cursor-halo--visible` → resting strength → opacity `0.14`
- `.cursor-halo--active` → size over links/buttons → `40px`
- `.cursor-halo--visible.cursor-halo--active` → strength over links/buttons → opacity `0.2`
- behavior (what counts as interactive, hide-on-leave) → `src/components/CursorHalo.tsx`
- native cursor hiding scoped to fine pointers; text fields keep the caret cursor (rules at ~103-115)

### Golden logo (lines ~151-270 + component) — NEW
- component knobs at the top of `src/components/GoldenLogo.tsx`: `LETTERS` (letter x/y/size per layout, ~line 17), `LETTER_WEIGHT` (~32), `STROKE_WIDTH` + `LINE_BRIGHTNESS` (~44-45), `DOT_DUR` / `TRAIL_LENGTH` / `TRAIL_STEPS` / `TRAIL_MAX_ALPHA` (~51-61), `SPEED_MIN` / `SPEED_MAX` (~79-80)
- CSS side: `.golden-logo` color source (157), letterform font (~178), draw-on timing (~195-198), comet reveal transitions (~205-244)

### Link highlight chips (`.link-highlight` at ~276, `.link-highlight-active` at ~293)
- background → `var(--theme-highlight-bg)`; hover → color `--theme-text-primary` + bg `--theme-highlight-bg-hover` (~288)
- padding → `0px 2px 0.5px 2px` (active: `0px 4px 1px 4px`)
- horizontal margin → `1px` each side
- border-radius → `var(--ui-highlight-radius)`
- transition → `color/background 0.15s ease`

### Section divider (`.section-divider`, ~309)
- height `2px`, color `var(--theme-divider)`, vertical margin `2rem`

### Blog images (`.blog-figure` ~321, `.blog-gallery` ~325)
- figure margin `2rem 0`; gallery columns `repeat(auto-fit, minmax(240px, 1fr))`, gap `0.75rem`

### Animations (~351-373)
- `cursor-blink` keyframes; `.animate-cursor-blink` → `1s ease-in-out infinite`
- `content-enter` keyframes → fade + `translateY(8px)→0`; `.animate-content-enter` → `0.3s ease-out`

### Scrollbar (~379-394)
- width `6px`; track/thumb colors via theme vars; thumb radius `3px`

### Strava/activity calendar sizing (`.strava-calendar` ~458)
- calendar `min-width 300px`, `max-width 400px`
- `.calendar-day` aspect-ratio `1`, min-height `24px`
- `.calendar-day-number` font-size `0.75rem`, color muted, radius `4px`, `1px` highlight border
- `.calendar-activity` radius `4px`, background `--theme-highlight-bg` (hover `-hover`)

### Site container (`.site-container`, ~518)
- max-width → `1348px`
- padding → `48px 20px` mobile, `64px 64px` ≥768px

### Photos hover overlay / caption / nav buttons (~538-600)
- cover hover darken → `rgba(16,16,16,0.35)` (mirrored for light)
- caption padding `0.5rem 0.75rem` + gradient scrim
- nav buttons `44px` circles, font-size `1.75rem`, opacity `0.6` idle → `1` hover

---

## 2. Experience (tabbed section) — `src/components/Experience.tsx`

### Tab / section labels (lines 236-256)
- `237` → tab row → `flex flex-wrap gap-2` (gap live)
- `242` → tab base font → `font-sans text-3xl`
- `244-245` → **active** tab classes → `text-off-white font-medium link-highlight-active`
- `245-246` → **inactive** tab classes → `text-gray link-highlight`
- `247` → per-tab inline spacing → `padding: '0px 4px 1px 4px'`, `margin: '0 2px'`

### Bio view (lines 261-275)
- `262` → layout → `flex flex-col md:flex-row gap-8 md:gap-12`
- `264` → bio text column width → `md:w-3/5`
- `265` → "about me" heading → `font-bold text-off-white text-3xl`, `marginBottom: '1rem'`
- `272` → tabs column width → `md:w-2/5`

### Section blurb (lines 282-291)
- `282` → content wrapper top margin → `marginTop: '0.5rem'`
- `286` → blurb text → `text-gray text-lg leading-[1.35]`

### Two-column list/detail layout (lines 393-472) — work/research/teaching/projects/library/blog/photos
- `393` → column split container → `flex flex-col md:flex-row gap-4 md:gap-12`
- `395` → **list column width** → `md:w-1/2`; inline `gap: '0.4rem'` (row spacing knob)
- `430` → **detail column width** → `md:w-1/2` (so the split is 50/50)

**Item rows (the "incoming ml engineer"-style blocks, lines 396-426):**
- `400-404` → row state classes → selected `card-bg`, else `card-bg-hover`, base `rounded`
- `405` → row padding → `paddingTop 0.1rem, paddingBottom 0.35rem, paddingLeft/Right 0.5rem`
- `408` → **item title** → `text-off-white text-lg`
- `411` → year (right) → `font-semibold text-gray text-lg`
- `415` → second row top margin → `marginTop: '-0.25rem'`
- `416` → **company / period line** → `text-gray text-sm`
- `420` → location → `text-gray text-sm`

**Detail card (the "full card thing", lines 431-469):**
- `432` → card → `card-bg rounded-lg`, `padding '1rem', paddingLeft '1.25rem'`
- `433` → header row bottom margin → `marginBottom: '0.5rem'`
- `435` → detail title → `text-off-white text-lg font-bold`
- `443` → company (linked) → `text-secondary text-lg link-highlight`
- `449` → company (plain) → `text-secondary text-lg` (+`italic` for projects tab)
- `455-456` → period block → `marginLeft: '1rem'`, `font-semibold text-gray text-lg`
- `460` → location → `text-gray text-lg block`
- `466` → **body/description text** → `text-gray text-lg leading-[1.35]`

**Per-tab "see all →" links (lines 474-503):**
- `475`/`485`/`495` → wrapper top margin → `marginTop: '1.5rem'`
- link style → `text-gray hover:text-off-white text-lg`

### Coursework — semester grid view (lines 302-390)
- `305` → grid → `grid-cols-1 md:grid-cols-2 gap-6`
- `307-310` → semester card → `card-bg rounded-lg`, `padding '1rem', paddingLeft '1.25rem'`
- `312` → semester heading → `text-off-white text-lg font-bold`
- `342` → course `<li>` → `text-gray text-lg`
- `320` → course code emphasis → `text-off-white`
- `348-351` → expandable-course button → selected `card-bg`, else `card-bg-hover`; `padding '0.1rem 0.5rem', margin '-0.1rem -0.5rem'`
- `373` → expanded detail card → `card-bg rounded-lg`, `padding '1rem', paddingLeft '1.25rem', marginTop '1.5rem'`
- `376-379` → code/title/tag styles in detail
- `387` → footnote → `text-gray text-lg`, `marginTop '2rem'`

### Coursework detail body helper `courseDetail` (lines 161-183)
- `162` → wrapper → `flex flex-col gap-2`
- `163` → review line → `text-secondary text-lg italic`
- `166` → experience paragraphs → `text-gray text-lg leading-[1.35]`
- `171` → cheatsheet/links line → `text-gray text-lg`

---

## 3. Hero — `src/components/Hero.tsx`

- `110` → top-level split → `flex flex-col md:flex-row ... gap-8`
- `113` → headshot+name row → `flex items-center gap-6`
- `117` → **headshot/logo size** → `w-[110px] h-[178px]` (golden rectangle, matches the AZ mark)
- `126` → flip target → `<GoldenLogo layout="vertical" />` (draws in on each flip)
- `142` & `148` → **name font** ("hi, i'm" / "andrew") → `font-bold text-off-white text-6xl md:text-7xl`
- `143` & `149` → name letter-spacing → `-0.02em`
- school lines → `font-semibold text-off-white text-lg leading-[1.35]` (+`marginBottom: '0.5rem'` on line 2)
- `168` → **quote text** → `italic text-gray text-lg leading-[1.35] max-w-md`
- typing cursor → `w-[2px] h-[1.1em] bg-gray`

---

## 4. Currently — `src/components/Currently.tsx`

- `602` → "currently" heading → `font-bold text-off-white text-3xl`, `marginBottom: '0.5rem'`
- `605` → body text (the animated line) → `text-gray text-lg leading-[1.35]`
- `618` → **footer stats** → `text-off-white text-sm italic`, `marginTop: '0.5rem'`
- `595` → body cursor → `w-[2px] h-[1.1em] bg-off-white`

---

## 5. GitHub activity & activity calendar

### `src/components/GitHubActivity.tsx`
- `230` → "activity" heading → `font-bold text-off-white text-3xl`, `marginBottom: '0.5rem'`
- `238` → month-labels strip → `marginLeft: '1.75rem'`
- `242` → month label font → `text-gray text-xs`
- `245` → **month label horizontal step** → `left: weekIndex * 12px` (must match cell width + gap)
- `254-256` → day-labels column → `text-xs text-gray`, row height `h-[10px]`
- `263`/`265` → **grid gaps** → `gap-[2px]`
- `269` → **contribution cell** → `w-[10px] h-[10px] rounded-[2px] contrib-{level}`
- `281` → last-deployed line → `text-gray text-lg`, `marginTop: '0.5rem'`

### `src/components/ActivityCalendar.tsx`
- `16` → weekday header letters
- `1044` → **calendar card** → `card-bg rounded-lg ... !p-5` (live padding, 1.25rem)
- `176-180` / `229-234` / `306` → activity icon sizes → 16 / 18 / 24 px
- `184`/`399` → multi-item badge → `bg-gray text-off-black text-[10px]`, `w-3.5 h-3.5`
- `895` → month-nav label → `font-medium text-off-white text-sm min-w-[120px]`
- `909-920` → day-header spacing + both grids → `grid grid-cols-7 gap-1`
- `913` → day-header letter → `font-bold text-gray text-xs`
- `954-975` → stats row → `marginTop: '12px'`, text `text-gray text-sm`
- detail panels → headers `marginBottom: '24px'`; icon box `w-10 h-10`; stats grid `grid-cols-3 gap-3`; title `font-medium text-off-white text-base`

---

## 6. Contact & social links

### `src/components/Contact.tsx`
- `3` → wrapper alignment → `text-left md:text-right`
- `4` → "contact" heading → `font-bold text-off-white text-3xl`, `marginBottom: '0.5rem'`
- `7` → body text → `text-gray text-lg leading-[1.35]`
- `10` → email line → `text-off-white text-lg leading-[1.35]`, `marginTop: '0.5rem'`

### `src/components/SocialLinks.tsx`
- `29` → icon row → `flex items-center gap-2`, `marginTop: '1.5rem'`
- `33-37` → **social icon size** → `24px`, `opacity-60 hover:opacity-100`
- `42` → text links (resume/cv) → `text-gray text-lg link-highlight`
- `65-71` → theme-toggle icon → same treatment
- `15-23` → the social link list itself

---

## 7. Blog / library / photos index cards

### `src/components/blog/BlogIndex.tsx`
- `66` → tag-chip row → `gap-2`, `marginBottom: "2rem"`
- `69-85` → tag chip → `text-lg`; active `text-off-white link-highlight-active`, inactive `text-gray link-highlight`
- `97` → post list → `flex flex-col gap-2`
- `114` → **post card** → `card-bg rounded-lg`, `padding: "1rem 1.25rem"`
- `115` → card inner → `flex items-start gap-4`
- `120-125` → cover thumbnail → `88×88`, `rounded-md`
- `132` → post title → `text-off-white text-lg font-bold link-highlight`
- `136` → date → `text-gray text-sm`
- `139` → summary → `text-secondary text-base leading-[1.4]`, `marginTop: "0.5rem"`
- `144-149` → tag list `gap-1.5`, chips `text-xs`

### `src/components/library/LibraryIndex.tsx`
- `70-85` → tag-chip row/chips (same pattern as blog)
- `120` → section block → `marginBottom: "2.5rem"`
- `121` → section title → `text-off-white text-sm uppercase tracking-widest`, `opacity: 0.6`
- `124` → entry list → `flex flex-col gap-2`
- `148` → **entry card** → `card-bg rounded-lg`, `padding: "1rem 1.25rem"`
- `149-150` → card inner `gap-3`, icon offset `marginTop: "0.25rem"`
- `157` → title → `text-off-white text-lg font-bold link-highlight`
- `163` → creator/date → `text-gray text-sm`, `marginTop: "0.125rem"`
- `168` → summary → `text-secondary text-base leading-[1.4]`, `marginTop: "0.5rem"`
- `173-178` → tags `gap-1.5`, chips `text-xs`

### Photos index — `src/app/photos/page.tsx` + `src/components/photos/JustifiedLayout.tsx` + `PhotosetCover.tsx`
- page `23` → page title → `font-bold text-off-white text-6xl`, `letterSpacing: "-0.02em"` (same pattern on blog/library pages)
- page `26` → intro paragraph → `text-gray text-lg leading-[1.35] max-w-2xl`
- JustifiedLayout `18-19` → **row target heights** → desktop `260`, mobile `180` (switch at 640px, line 85)
- JustifiedLayout `20` → **gap between tiles** → `8` px
- JustifiedLayout `21-23` → per-row min/max `2`/`4`, trailing-row max upscale `1.5`
- PhotosetCover `21` → cover link → `rounded overflow-hidden`
- PhotosetCover `44` → hover caption → `text-off-white text-base` (overlay styling in globals.css §1)

---

## 8. MDX prose type scale — `src/components/mdx/components.tsx`

The shared type scale for all rendered MDX (library entries, bio, blog bodies).

- `9-12` → **h1** → `font-bold text-off-white text-3xl`; `marginTop: "2rem", marginBottom: "0.75rem", letterSpacing: "-0.01em"`
- `16-18` → **h2** → `font-bold text-off-white text-2xl`; `marginTop: "1.75rem", marginBottom: "0.5rem"`
- `23-25` → **h3** → `font-bold text-off-white text-xl`; `marginTop: "1.25rem", marginBottom: "0.5rem"`
- `30-32` → **p** → `text-gray text-lg leading-[1.55]`; `marginBottom: "1rem"`
- `41` → **a** → `text-off-white link-highlight`
- `47-56` → **ul/ol** → `text-gray text-lg leading-[1.55] list-disc/decimal list-inside`; `marginBottom: "1rem", paddingLeft: "0.5rem"`
- `60` → **li** → `marginBottom: "0.25rem"`
- `64-69` → **blockquote** → `card-bg rounded-lg text-secondary text-lg italic`; `padding: "1rem 1.25rem"`, left border `3px solid var(--theme-text-primary)`
- `74-76` → **strong** / **em**
- `79-85` → **hr** → `1px`, `var(--theme-divider)`, `margin: "2rem 0"`
- `89-95` → **inline code** → `font-mono text-off-white text-base`; bg `var(--theme-highlight-bg)`, radius `4px`
- `100-102` → **pre** → `card-bg rounded-lg font-mono text-secondary text-base`; `padding: "1rem 1.25rem"`, line-height 1.5

---

## 9. Favicon / brand assets

- `public/images/az-logo.svg` → static golden-ratio AZ mark, theme-adaptive (`prefers-color-scheme` CSS inside the SVG); regenerate with the scratch generator if the logo geometry/letters change
- `public/images/az-favicon.png` → 512×512 transparent raster of the same (light-mode colors)
- wired in `src/app/layout.tsx` metadata `icons`

## appendix: home-page section rhythm

Per-section vertical rhythm on the home page comes from `src/app/page.tsx` (the `activity-stack:` prefix maps to the 768px breakpoint). The activity heading sits at `page.tsx:120` (`text-3xl`, `marginBottom: '1rem'`); the activity/calendar split uses `activity-stack:w-3/5` / `activity-stack:w-2/5` with `gap-8 activity-stack:gap-12` (`page.tsx:124-133`). Per-`<section>` `py-*` classes are dead; section spacing is governed by `.section-divider` and the inline-styled gaps above.
