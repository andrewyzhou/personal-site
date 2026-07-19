# design knobs

A catalog of every design-tweakable value in the public-facing frontend, organized by area. All paths are relative to the repo root; line numbers are current as of this writing (they drift as files change — the selector/class names are the durable anchors).

## how colors work (read this first)

Colors are driven by CSS custom properties, not hardcoded per component. Two theme blocks in [`src/app/globals.css`](../src/app/globals.css) define every semantic color:

- **Dark mode (default)** — `:root` at [`src/app/globals.css:40`](../src/app/globals.css#L40)
- **Light mode** — `.theme-light` at [`src/app/globals.css:68`](../src/app/globals.css#L68)

To recolor the whole site, edit those two blocks. The variables you'll most often touch: `--theme-bg` (page background), `--theme-text` (default body text), `--theme-text-primary` (bright/emphasis text), `--theme-text-muted` (dim text), `--theme-divider`, the `--theme-highlight-*` set (link chips), the `--theme-card-bg` set (cards), and `--contrib-0..4` (GitHub graph cells).

Components reference these via Tailwind-looking utility classes that are actually remapped to the CSS vars in [`src/app/globals.css`](../src/app/globals.css) (block starting at [~403](../src/app/globals.css#L403)):

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

**Spacing caveat:** the global reset `* { margin: 0; padding: 0 }` at [`src/app/globals.css:18-22`](../src/app/globals.css#L18) is unlayered, so it overrides Tailwind's `p-*`/`m-*`/`space-y-*` utilities (Tailwind utilities live in a CSS layer and lose to unlayered rules). That means classes like `py-16`, `mb-8`, `mt-4`, `space-y-2`, `p-1` are **dead** — they render as zero. Real spacing is done with inline `style={{}}` attributes, and those are the knobs reported below. Exceptions that still work: **`gap-*` (flex/grid gap) is live** (it's the `gap` property, not margin), and an important-flagged class like `!p-5` wins over the reset.

---

## 1. Global theme & primitives — [`src/app/globals.css`](../src/app/globals.css)

### UI knobs ([`:root`, line 43](../src/app/globals.css#L43))
- `--ui-highlight-radius` → roundness of link-highlight pills AND calendar day/activity cells → `4px`

### Color tokens ([`@theme`, lines 3-16](../src/app/globals.css#L3))
- [`4-8`](../src/app/globals.css#L4) → brand colors → off-black `oklch(17.3% 0 0)`, off-white `oklch(94.9% 0 0)`, secondary `oklch(84.5% 0 0)`, gray `oklch(73.8% 0 0)`, divider `oklch(30.9% 0 0)`
- [`10-11`](../src/app/globals.css#L10) → `--font-sans` / `--font-serif` → Funnel Sans stack
- [`14-15`](../src/app/globals.css#L14) → custom breakpoints → `activity` 1152px, `activity-stack` 768px

### Dark theme vars ([`:root`, ~40-66](../src/app/globals.css#L40)) / Light theme vars ([`.theme-light`, ~68-88](../src/app/globals.css#L68))
- page background `--theme-bg` → `oklch(17.3% 0 0)` / `oklch(94.9% 0 0)`
- body text `--theme-text` → `oklch(84.5% 0 0)` / `oklch(32.1% 0 0)`
- bright text `--theme-text-primary` → `oklch(94.9% 0 0)` / `oklch(17.3% 0 0)`
- muted text `--theme-text-muted` → `oklch(73.8% 0 0)` / `oklch(45.0% 0 0)`
- divider `--theme-divider` → `oklch(30.9% 0 0)` / `oklch(85.5% 0 0)`
- link-chip backgrounds (`--theme-highlight-bg`, `-hover`, `-active`) → rgba white 0.08/0.15/0.18 (dark) vs rgba black 0.08/0.15/0.18 (light)
- card fills (`--theme-card-bg`, `--theme-card-bg-hover`) → rgba white 0.10/0.05 vs rgba black 0.08/0.05
- headshot frame `--theme-headshot-bg` → `oklch(89.4% 0 0)`
- scrollbar track/thumb/thumb-hover colors
- GitHub contribution levels `--contrib-0..4` (empty→max)

### Cursor halo ([lines ~96-149](../src/app/globals.css#L96)) — NEW
- `.cursor-halo-dot` ([117](../src/app/globals.css#L117)) → resting size `26px`, background `var(--theme-text-primary)`, transition `0.18s`
- `.cursor-halo--visible` → resting strength → opacity `0.14`
- `.cursor-halo--active` → size over links/buttons → `40px`
- `.cursor-halo--visible.cursor-halo--active` → strength over links/buttons → opacity `0.2`
- behavior (what counts as interactive, hide-on-leave) → [`src/components/CursorHalo.tsx`](../src/components/CursorHalo.tsx)
- native cursor hiding scoped to fine pointers; text fields keep the caret cursor (rules at [~103-115](../src/app/globals.css#L103))

### Golden logo ([lines ~151-270](../src/app/globals.css#L151) + component) — NEW
- component knobs at the top of [`src/components/GoldenLogo.tsx`](../src/components/GoldenLogo.tsx): `LETTERS` ([~17](../src/components/GoldenLogo.tsx#L17)), `LETTER_WEIGHT` ([~32](../src/components/GoldenLogo.tsx#L32)), `STROKE_WIDTH` + `LINE_BRIGHTNESS` ([~44-45](../src/components/GoldenLogo.tsx#L44)), `DOT_DUR` / `TRAIL_LENGTH` / `TRAIL_STEPS` / `TRAIL_MAX_ALPHA` ([~51-61](../src/components/GoldenLogo.tsx#L51)), `SPEED_MIN` / `SPEED_MAX` ([~79-80](../src/components/GoldenLogo.tsx#L79))
- CSS side: `.golden-logo` color source ([157](../src/app/globals.css#L157)), letterform font ([~178](../src/app/globals.css#L178)), draw-on timing ([~195-198](../src/app/globals.css#L195)), comet reveal transitions ([~205-244](../src/app/globals.css#L205))

### Link highlight chips ([`.link-highlight` ~276](../src/app/globals.css#L276), [`.link-highlight-active` ~293](../src/app/globals.css#L293))
- background → `var(--theme-highlight-bg)`; hover → color `--theme-text-primary` + bg `--theme-highlight-bg-hover` ([~288](../src/app/globals.css#L288))
- padding → `0px 2px 0.5px 2px` (active: `0px 4px 1px 4px`)
- horizontal margin → `1px` each side
- border-radius → `var(--ui-highlight-radius)`
- transition → `color/background 0.15s ease`

### Section divider ([`.section-divider` ~309](../src/app/globals.css#L309))
- height `2px`, color `var(--theme-divider)`, vertical margin `2rem`

### Blog images ([`.blog-figure` ~321](../src/app/globals.css#L321), [`.blog-gallery` ~325](../src/app/globals.css#L325))
- figure margin `2rem 0`; gallery columns `repeat(auto-fit, minmax(240px, 1fr))`, gap `0.75rem`

### Animations ([~351-373](../src/app/globals.css#L351))
- `cursor-blink` keyframes; `.animate-cursor-blink` → `1s ease-in-out infinite`
- `content-enter` keyframes → fade + `translateY(8px)→0`; `.animate-content-enter` → `0.3s ease-out`

### Scrollbar ([~379-394](../src/app/globals.css#L379))
- width `6px`; track/thumb colors via theme vars; thumb radius `3px`

### Strava/activity calendar sizing ([`.strava-calendar` ~458](../src/app/globals.css#L458))
- calendar `min-width 300px`, `max-width 400px`
- `.calendar-day` aspect-ratio `1`, min-height `24px`
- `.calendar-day-number` font-size `0.75rem`, color muted, radius `4px`, `1px` highlight border
- `.calendar-activity` radius `4px`, background `--theme-highlight-bg` (hover `-hover`)

### Site container ([`.site-container` ~518](../src/app/globals.css#L518))
- max-width → `1348px`
- padding → `48px 20px` mobile, `64px 64px` ≥768px

### Photos hover overlay / caption / nav buttons ([~538-600](../src/app/globals.css#L538))
- cover hover darken → `oklch(17.3% 0 0 / 0.35)` (mirrored for light)
- caption padding `0.5rem 0.75rem` + gradient scrim
- nav buttons `44px` circles, font-size `1.75rem`, opacity `0.6` idle → `1` hover

---

## 2. Experience (tabbed section) — [`src/components/Experience.tsx`](../src/components/Experience.tsx)

### Tab / section labels ([lines 236-256](../src/components/Experience.tsx#L236))
- [`237`](../src/components/Experience.tsx#L237) → tab row → `flex flex-wrap gap-2` (gap live)
- [`242`](../src/components/Experience.tsx#L242) → tab base font → `font-sans text-3xl`
- [`244-245`](../src/components/Experience.tsx#L244) → **active** tab classes → `text-off-white font-medium link-highlight-active`
- [`245-246`](../src/components/Experience.tsx#L245) → **inactive** tab classes → `text-gray link-highlight`
- [`247`](../src/components/Experience.tsx#L247) → per-tab inline spacing → `padding: '0px 4px 1px 4px'`, `margin: '0 2px'`

### Bio view ([lines 261-275](../src/components/Experience.tsx#L261))
- [`262`](../src/components/Experience.tsx#L262) → layout → `flex flex-col md:flex-row gap-8 md:gap-12`
- [`264`](../src/components/Experience.tsx#L264) → bio text column width → `md:w-3/5`
- [`265`](../src/components/Experience.tsx#L265) → "about me" heading → `font-bold text-off-white text-3xl`, `marginBottom: '1rem'`
- [`272`](../src/components/Experience.tsx#L272) → tabs column width → `md:w-2/5`

### Section blurb ([lines 282-291](../src/components/Experience.tsx#L282))
- [`282`](../src/components/Experience.tsx#L282) → content wrapper top margin → `marginTop: '0.5rem'`
- [`286`](../src/components/Experience.tsx#L286) → blurb text → `text-gray text-lg leading-[1.35]`

### Two-column list/detail layout ([lines 393-472](../src/components/Experience.tsx#L393)) — work/research/teaching/projects/library/blog/photos
- [`393`](../src/components/Experience.tsx#L393) → column split container → `flex flex-col md:flex-row gap-4 md:gap-12`
- [`395`](../src/components/Experience.tsx#L395) → **list column width** → `md:w-1/2`; inline `gap: '0.4rem'` (row spacing knob)
- [`430`](../src/components/Experience.tsx#L430) → **detail column width** → `md:w-1/2` (so the split is 50/50)

**Item rows (the "incoming ml engineer"-style blocks, lines 396-426):**
- [`400-404`](../src/components/Experience.tsx#L400) → row state classes → selected `card-bg`, else `card-bg-hover`, base `rounded`
- [`405`](../src/components/Experience.tsx#L405) → row padding → `paddingTop 0.1rem, paddingBottom 0.35rem, paddingLeft/Right 0.5rem`
- [`408`](../src/components/Experience.tsx#L408) → **item title** → `text-off-white text-lg`
- [`411`](../src/components/Experience.tsx#L411) → year (right) → `font-semibold text-gray text-lg`
- [`415`](../src/components/Experience.tsx#L415) → second row top margin → `marginTop: '-0.25rem'`
- [`416`](../src/components/Experience.tsx#L416) → **company / period line** → `text-gray text-sm`
- [`420`](../src/components/Experience.tsx#L420) → location → `text-gray text-sm`

**Detail card (the "full card thing", lines 431-469):**
- [`432`](../src/components/Experience.tsx#L432) → card → `card-bg rounded-lg`, `padding '1rem', paddingLeft '1.25rem'`
- [`433`](../src/components/Experience.tsx#L433) → header row bottom margin → `marginBottom: '0.5rem'`
- [`435`](../src/components/Experience.tsx#L435) → detail title → `text-off-white text-lg font-bold`
- [`443`](../src/components/Experience.tsx#L443) → company (linked) → `text-secondary text-lg link-highlight`
- [`449`](../src/components/Experience.tsx#L449) → company (plain) → `text-secondary text-lg` (+`italic` for projects tab)
- [`455-456`](../src/components/Experience.tsx#L455) → period block → `marginLeft: '1rem'`, `font-semibold text-gray text-lg`
- [`460`](../src/components/Experience.tsx#L460) → location → `text-gray text-lg block`
- [`466`](../src/components/Experience.tsx#L466) → **body/description text** → `text-gray text-lg leading-[1.35]`

**Per-tab "see all →" links ([lines 474-503](../src/components/Experience.tsx#L474)):**
- [`475`/`485`/`495`](../src/components/Experience.tsx#L475) → wrapper top margin → `marginTop: '1.5rem'`
- link style → `text-gray hover:text-off-white text-lg`

### Coursework — semester grid view ([lines 302-390](../src/components/Experience.tsx#L302))
- [`305`](../src/components/Experience.tsx#L305) → grid → `grid-cols-1 md:grid-cols-2 gap-6`
- [`307-310`](../src/components/Experience.tsx#L307) → semester card → `card-bg rounded-lg`, `padding '1rem', paddingLeft '1.25rem'`
- [`312`](../src/components/Experience.tsx#L312) → semester heading → `text-off-white text-lg font-bold`
- [`342`](../src/components/Experience.tsx#L342) → course `<li>` → `text-gray text-lg`
- [`320`](../src/components/Experience.tsx#L320) → course code emphasis → `text-off-white`
- [`348-351`](../src/components/Experience.tsx#L348) → expandable-course button → selected `card-bg`, else `card-bg-hover`; `padding '0.1rem 0.5rem', margin '-0.1rem -0.5rem'`
- [`373`](../src/components/Experience.tsx#L373) → expanded detail card → `card-bg rounded-lg`, `padding '1rem', paddingLeft '1.25rem', marginTop '1.5rem'`
- [`376-379`](../src/components/Experience.tsx#L376) → code/title/tag styles in detail
- [`387`](../src/components/Experience.tsx#L387) → footnote → `text-gray text-lg`, `marginTop '2rem'`

### Coursework detail body helper `courseDetail` ([lines 161-183](../src/components/Experience.tsx#L161))
- [`162`](../src/components/Experience.tsx#L162) → wrapper → `flex flex-col gap-2`
- [`163`](../src/components/Experience.tsx#L163) → review line → `text-secondary text-lg italic`
- [`166`](../src/components/Experience.tsx#L166) → experience paragraphs → `text-gray text-lg leading-[1.35]`
- [`171`](../src/components/Experience.tsx#L171) → cheatsheet/links line → `text-gray text-lg`

---

## 3. Hero — [`src/components/Hero.tsx`](../src/components/Hero.tsx)

- [`110`](../src/components/Hero.tsx#L110) → top-level split → `flex flex-col md:flex-row ... gap-8`
- [`113`](../src/components/Hero.tsx#L113) → headshot+name row → `flex items-center gap-6`
- [`117`](../src/components/Hero.tsx#L117) → **headshot/logo size** → `w-[110px] h-[178px]` (golden rectangle, matches the AZ mark)
- [`126`](../src/components/Hero.tsx#L126) → flip target → `<GoldenLogo layout="vertical" />` (draws in on each flip)
- [`142` & `148`](../src/components/Hero.tsx#L142) → **name font** ("hi, i'm" / "andrew") → `font-bold text-off-white text-6xl md:text-7xl`
- [`143` & `149`](../src/components/Hero.tsx#L143) → name letter-spacing → `-0.02em`
- school lines → `font-semibold text-off-white text-lg leading-[1.35]` (+`marginBottom: '0.5rem'` on line 2)
- [`168`](../src/components/Hero.tsx#L168) → **quote text** → `italic text-gray text-lg leading-[1.35] max-w-md`
- typing cursor → `w-[2px] h-[1.1em] bg-gray`

---

## 4. Currently — [`src/components/Currently.tsx`](../src/components/Currently.tsx)

- [`602`](../src/components/Currently.tsx#L602) → "currently" heading → `font-bold text-off-white text-3xl`, `marginBottom: '0.5rem'`
- [`605`](../src/components/Currently.tsx#L605) → body text (the animated line) → `text-gray text-lg leading-[1.35]`
- [`618`](../src/components/Currently.tsx#L618) → **footer stats** → `text-off-white text-sm italic`, `marginTop: '0.5rem'`
- [`595`](../src/components/Currently.tsx#L595) → body cursor → `w-[2px] h-[1.1em] bg-off-white`

---

## 5. GitHub activity & activity calendar

### [`src/components/GitHubActivity.tsx`](../src/components/GitHubActivity.tsx)
- [`230`](../src/components/GitHubActivity.tsx#L230) → "activity" heading → `font-bold text-off-white text-3xl`, `marginBottom: '0.5rem'`
- [`238`](../src/components/GitHubActivity.tsx#L238) → month-labels strip → `marginLeft: '1.75rem'`
- [`242`](../src/components/GitHubActivity.tsx#L242) → month label font → `text-gray text-xs`
- [`245`](../src/components/GitHubActivity.tsx#L245) → **month label horizontal step** → `left: weekIndex * 12px` (must match cell width + gap)
- [`254-256`](../src/components/GitHubActivity.tsx#L254) → day-labels column → `text-xs text-gray`, row height `h-[10px]`
- [`263`/`265`](../src/components/GitHubActivity.tsx#L263) → **grid gaps** → `gap-[2px]`
- [`269`](../src/components/GitHubActivity.tsx#L269) → **contribution cell** → `w-[10px] h-[10px] rounded-[2px] contrib-{level}`
- [`281`](../src/components/GitHubActivity.tsx#L281) → last-deployed line → `text-gray text-lg`, `marginTop: '0.5rem'`

### [`src/components/ActivityCalendar.tsx`](../src/components/ActivityCalendar.tsx)
- [`16`](../src/components/ActivityCalendar.tsx#L16) → weekday header letters
- [`1044`](../src/components/ActivityCalendar.tsx#L1044) → **calendar card** → `card-bg rounded-lg ... !p-5` (live padding, 1.25rem)
- [`176-180` / `229-234` / `306`](../src/components/ActivityCalendar.tsx#L176) → activity icon sizes → 16 / 18 / 24 px
- [`184`/`399`](../src/components/ActivityCalendar.tsx#L184) → multi-item badge → `bg-gray text-off-black text-[10px]`, `w-3.5 h-3.5`
- [`895`](../src/components/ActivityCalendar.tsx#L895) → month-nav label → `font-medium text-off-white text-sm min-w-[120px]`
- [`909-920`](../src/components/ActivityCalendar.tsx#L909) → day-header spacing + both grids → `grid grid-cols-7 gap-1`
- [`913`](../src/components/ActivityCalendar.tsx#L913) → day-header letter → `font-bold text-gray text-xs`
- [`954-975`](../src/components/ActivityCalendar.tsx#L954) → stats row → `marginTop: '12px'`, text `text-gray text-sm`
- detail panels → headers `marginBottom: '24px'`; icon box `w-10 h-10`; stats grid `grid-cols-3 gap-3`; title `font-medium text-off-white text-base`

---

## 6. Contact & social links

### [`src/components/Contact.tsx`](../src/components/Contact.tsx)
- [`3`](../src/components/Contact.tsx#L3) → wrapper alignment → `text-left md:text-right`
- [`4`](../src/components/Contact.tsx#L4) → "contact" heading → `font-bold text-off-white text-3xl`, `marginBottom: '0.5rem'`
- [`7`](../src/components/Contact.tsx#L7) → body text → `text-gray text-lg leading-[1.35]`
- [`10`](../src/components/Contact.tsx#L10) → email line → `text-off-white text-lg leading-[1.35]`, `marginTop: '0.5rem'`

### [`src/components/SocialLinks.tsx`](../src/components/SocialLinks.tsx)
- [`29`](../src/components/SocialLinks.tsx#L29) → icon row → `flex items-center gap-2`, `marginTop: '1.5rem'`
- [`33-37`](../src/components/SocialLinks.tsx#L33) → **social icon size** → `24px`, `opacity-60 hover:opacity-100`
- [`42`](../src/components/SocialLinks.tsx#L42) → text links (resume/cv) → `text-gray text-lg link-highlight`
- [`65-71`](../src/components/SocialLinks.tsx#L65) → theme-toggle icon → same treatment
- [`15-23`](../src/components/SocialLinks.tsx#L15) → the social link list itself

---

## 7. Blog / library / photos index cards

### [`src/components/blog/BlogIndex.tsx`](../src/components/blog/BlogIndex.tsx)
- [`66`](../src/components/blog/BlogIndex.tsx#L66) → tag-chip row → `gap-2`, `marginBottom: "2rem"`
- [`69-85`](../src/components/blog/BlogIndex.tsx#L69) → tag chip → `text-lg`; active `text-off-white link-highlight-active`, inactive `text-gray link-highlight`
- [`97`](../src/components/blog/BlogIndex.tsx#L97) → post list → `flex flex-col gap-2`
- [`114`](../src/components/blog/BlogIndex.tsx#L114) → **post card** → `card-bg rounded-lg`, `padding: "1rem 1.25rem"`
- [`115`](../src/components/blog/BlogIndex.tsx#L115) → card inner → `flex items-start gap-4`
- [`120-125`](../src/components/blog/BlogIndex.tsx#L120) → cover thumbnail → `88×88`, `rounded-md`
- [`132`](../src/components/blog/BlogIndex.tsx#L132) → post title → `text-off-white text-lg font-bold link-highlight`
- [`136`](../src/components/blog/BlogIndex.tsx#L136) → date → `text-gray text-sm`
- [`139`](../src/components/blog/BlogIndex.tsx#L139) → summary → `text-secondary text-base leading-[1.4]`, `marginTop: "0.5rem"`
- [`144-149`](../src/components/blog/BlogIndex.tsx#L144) → tag list `gap-1.5`, chips `text-xs`

### [`src/components/library/LibraryIndex.tsx`](../src/components/library/LibraryIndex.tsx)
- [`70-85`](../src/components/library/LibraryIndex.tsx#L70) → tag-chip row/chips (same pattern as blog)
- [`120`](../src/components/library/LibraryIndex.tsx#L120) → section block → `marginBottom: "2.5rem"`
- [`121`](../src/components/library/LibraryIndex.tsx#L121) → section title → `text-off-white text-sm uppercase tracking-widest`, `opacity: 0.6`
- [`124`](../src/components/library/LibraryIndex.tsx#L124) → entry list → `flex flex-col gap-2`
- [`148`](../src/components/library/LibraryIndex.tsx#L148) → **entry card** → `card-bg rounded-lg`, `padding: "1rem 1.25rem"`
- [`149-150`](../src/components/library/LibraryIndex.tsx#L149) → card inner `gap-3`, icon offset `marginTop: "0.25rem"`
- [`157`](../src/components/library/LibraryIndex.tsx#L157) → title → `text-off-white text-lg font-bold link-highlight`
- [`163`](../src/components/library/LibraryIndex.tsx#L163) → creator/date → `text-gray text-sm`, `marginTop: "0.125rem"`
- [`168`](../src/components/library/LibraryIndex.tsx#L168) → summary → `text-secondary text-base leading-[1.4]`, `marginTop: "0.5rem"`
- [`173-178`](../src/components/library/LibraryIndex.tsx#L173) → tags `gap-1.5`, chips `text-xs`

### Photos index — [`src/app/photos/page.tsx`](../src/app/photos/page.tsx) + [`src/components/photos/JustifiedLayout.tsx`](../src/components/photos/JustifiedLayout.tsx) + `PhotosetCover.tsx`
- page [`23`](../src/app/photos/page.tsx#L23) → page title → `font-bold text-off-white text-6xl`, `letterSpacing: "-0.02em"` (same pattern on blog/library pages)
- page [`26`](../src/app/photos/page.tsx#L26) → intro paragraph → `text-gray text-lg leading-[1.35] max-w-2xl`
- JustifiedLayout [`18-19`](../src/components/photos/JustifiedLayout.tsx#L18) → **row target heights** → desktop `260`, mobile `180` (switch at 640px, line 85)
- JustifiedLayout [`20`](../src/components/photos/JustifiedLayout.tsx#L20) → **gap between tiles** → `8` px
- JustifiedLayout [`21-23`](../src/components/photos/JustifiedLayout.tsx#L21) → per-row min/max `2`/`4`, trailing-row max upscale `1.5`
- PhotosetCover [`21`](../src/components/photos/PhotosetCover.tsx#L21) → cover link → `rounded overflow-hidden`
- PhotosetCover [`44`](../src/components/photos/PhotosetCover.tsx#L44) → hover caption → `text-off-white text-base` (overlay styling in globals.css §1)

---

## 8. MDX prose type scale — [`src/components/mdx/components.tsx`](../src/components/mdx/components.tsx)

The shared type scale for all rendered MDX (library entries, bio, blog bodies).

- [`9-12`](../src/components/mdx/components.tsx#L9) → **h1** → `font-bold text-off-white text-3xl`; `marginTop: "2rem", marginBottom: "0.75rem", letterSpacing: "-0.01em"`
- [`16-18`](../src/components/mdx/components.tsx#L16) → **h2** → `font-bold text-off-white text-2xl`; `marginTop: "1.75rem", marginBottom: "0.5rem"`
- [`23-25`](../src/components/mdx/components.tsx#L23) → **h3** → `font-bold text-off-white text-xl`; `marginTop: "1.25rem", marginBottom: "0.5rem"`
- [`30-32`](../src/components/mdx/components.tsx#L30) → **p** → `text-gray text-lg leading-[1.55]`; `marginBottom: "1rem"`
- [`41`](../src/components/mdx/components.tsx#L41) → **a** → `text-off-white link-highlight`
- [`47-56`](../src/components/mdx/components.tsx#L47) → **ul/ol** → `text-gray text-lg leading-[1.55] list-disc/decimal list-inside`; `marginBottom: "1rem", paddingLeft: "0.5rem"`
- [`60`](../src/components/mdx/components.tsx#L60) → **li** → `marginBottom: "0.25rem"`
- [`64-69`](../src/components/mdx/components.tsx#L64) → **blockquote** → `card-bg rounded-lg text-secondary text-lg italic`; `padding: "1rem 1.25rem"`, left border `3px solid var(--theme-text-primary)`
- [`74-76`](../src/components/mdx/components.tsx#L74) → **strong** / **em**
- [`79-85`](../src/components/mdx/components.tsx#L79) → **hr** → `1px`, `var(--theme-divider)`, `margin: "2rem 0"`
- [`89-95`](../src/components/mdx/components.tsx#L89) → **inline code** → `font-mono text-off-white text-base`; bg `var(--theme-highlight-bg)`, radius `4px`
- [`100-102`](../src/components/mdx/components.tsx#L100) → **pre** → `card-bg rounded-lg font-mono text-secondary text-base`; `padding: "1rem 1.25rem"`, line-height 1.5

---

## 9. Favicon / brand assets

- [`public/images/az-logo.svg`](../public/images/az-logo.svg) → static golden-ratio AZ mark, theme-adaptive (`prefers-color-scheme` CSS inside the SVG); regenerate with the scratch generator if the logo geometry/letters change
- [`public/images/az-favicon.png`](../public/images/az-favicon.png) → 512×512 transparent raster of the same (light-mode colors)
- wired in [`src/app/layout.tsx`](../src/app/layout.tsx) metadata `icons`

## appendix: home-page section rhythm

Per-section vertical rhythm on the home page comes from [`src/app/page.tsx`](../src/app/page.tsx) (the `activity-stack:` prefix maps to the 768px breakpoint). The activity heading sits at [`page.tsx:120`](../src/app/page.tsx#L120) (`text-3xl`, `marginBottom: '1rem'`); the activity/calendar split uses `activity-stack:w-3/5` / `activity-stack:w-2/5` with `gap-8 activity-stack:gap-12` ([`page.tsx:124-133`](../src/app/page.tsx#L124)). Per-`<section>` `py-*` classes are dead; section spacing is governed by `.section-divider` and the inline-styled gaps above.
