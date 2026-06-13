# markmint — Handoff (profile b → next)

> **Date:** 2026-06-01 · **From:** Claude (clikae profile b)
> **Status:** icon-studio milestone shipped & LIVE. All work merged to `main`
> and deployed to https://oss.cver.net/markmint/ . 187 unit tests, CI green.
> Read this top-to-bottom before touching code.

---

## 0. What markmint is
In-browser **logo / icon studio**: raster → clean recolorable SVG (VTracer→WASM
in a Web Worker), then edit + compose + export — 100% client-side, no upload.
Renamed from "vectorize" (that brand token is fully purged from code **and** the
local dir, which is now `~/Desktop/GitHub/markmint`). Repo `CVERInc/markmint`,
live `oss.cver.net/markmint/`, npm name `@cver/markmint` (NOT published).

## 1. ⚠️ CRITICAL constraints (don't relearn the hard way)
- **`astro build` / `astro dev` / `astro check` HANG at 0% CPU in the agent
  session** (any Node). DO NOT run them. Verify instead via:
  1. **Vitest** — `npm test` (pure `src/lib/*.ts`; 187 tests). Primary loop.
  2. **Svelte compile-check** (CJS works in-session):
     `node -e 'const{compile}=require("svelte/compiler");const fs=require("fs");const{warnings}=compile(fs.readFileSync("src/components/Studio.svelte","utf8"),{generate:"client",filename:"x.svelte"});console.log(warnings.length)'`
     — catches template/script structure + a11y; filter `css_unused` (12 are
     pre-existing dead selectors: `.result-preview*`, `.seg.compact`, etc.).
  3. **CI is the source of truth for "does it build"** — runs real
     `astro check` + `astro build` + `npm test`. `.astro` files can ONLY be
     verified by CI.
- **Node 22 via fnm:** `eval "$(fnm env)"; fnm use 22` before any tooling.
- **You cannot see runtime UI.** UX / visual / live behavior must be
  maintainer-verified. They actively click-test the live site each iteration.

## 2. ⚠️ The deploy / fix-forward workflow (important gotcha)
- CI (`.github/workflows/ci.yml`) runs on **PRs to main** and **push to main**.
  Deploy (`deploy-pages.yml`) runs on **push to main** → GitHub Pages.
- **After a PR merges, pushing more commits to a branch does NOT trigger CI**
  (no open PR; push trigger is main-only). So **every fix = a NEW PR → watch
  CI → merge → watch deploy.** That's why this session has PRs #1–#11.
- **Live has cache lag** (~10–40s). Verify with a cache-bust:
  `curl -s "https://oss.cver.net/markmint/?cb=$(date +%s)" -H "Cache-Control: no-cache" | grep -oE 'Studio\.[A-Za-z0-9_]+\.js'` and confirm the bundle hash changed.
- End commits with the `Co-Authored-By: Claude Opus 4.8 (1M context)` line.
- Branch from `main` for new work (feat/icon-studio is merged & even with main).

## 3. Cross-island state (works — confirmed at runtime)
Header (Astro `Layout.astro`) and the studio are separate islands. They share
state via Svelte stores in shared modules — singletons on the page:
- `lib/view-store.ts`: `previewView` ('svg'|'ascii') + `hasImage` (file loaded).
- `lib/i18n-store.ts`: `locale` + `t`.
The nav `[SVG|ASCII]` switch, the header language switcher, and the auto-hiding
hero all rely on this. It's proven (hero hides on drop), so the pattern is safe.

## 4. What shipped this session (all live)
- **Test harness** (Vitest) + 187 tests across `lib/`; CI runs them.
- **Favicon/app-icon pack export** (`lib/ico.ts` hand-rolled ICO + `lib/icon-pack.ts`; fflate zip).
- **i18n foundation** (en/ja/zh-TW/es) — `lib/i18n.ts` + store + `LanguageSwitcher`. ⚠️ ONLY the hero tagline + nav are translated; **the Studio UI is still inline English** (see TODO #1).
- **Copy-as** SVG / React / Vue / data-URI (`lib/copy-as.ts`).
- **Undo/redo** (`lib/history.ts`, Cmd/Ctrl+Z) for shape edits.
- **One-click background removal** (`lib/background.ts`).
- **Outline / shadow / glow** SVG filters (`lib/effects.ts`).
- **Gradient v2** — radial, N-stop, savable presets (`lib/gradient.ts` + `lib/gradient-presets.ts`).
- **Export sizes** @1×/2×/3× zip (`lib/export-set.ts`).
- **SEO/OG + PWA** — meta, `public/og.svg`, `public/site.webmanifest`, `public/sw.js` (conservative offline SW: cache-first only for hashed `/_astro/`, network-first else).
- **Multi-image compose** — merge several traced images into one mark (`lib/compose-layers.ts`; layer strip add/remove/position).
- **ASCII art** (`lib/ascii.ts`) — render the mark to text; **measured** monospace cell ratio (no distortion); charset (standard/blocks/detailed) + invert + width; **before/after compare** (`AsciiCompare.svelte`); flicker-free (asciiArt persists, signature-guarded recompute).
- **Nav redesign** — `[SVG|ASCII]` big centered switch in the header (`NavViewSwitch.svelte`); language switcher moved to header (left of GitHub).
- **IA by mode** — ASCII is a focused full-width mode: left SVG controls + SVG/raster export row + editor toolbar hidden; **image source (filename+replace, add/remove image) persists in both modes**.
- **Hero auto-hides** once a file is loaded; **compare sliders default centered (50%)**.
- **CVER logo favicon** (`public/cver-logo-small.png` 100×100 + `cver-logo.png` 630×630) — consistent across cver.net OSS pages.
- CI hardened to Node 22 + silenced the Node-20 action deprecation.

## 5. Key files
- `components/Studio.svelte` — the whole studio (~2300 lines). Internal trace
  naming kept (`lib/trace.ts`, `traceImage`, `trace.worker.ts`).
- `components/`: CompareSlider (SVG before/after) · AsciiCompare (ASCII) ·
  NavViewSwitch · LanguageSwitcher · Hero.
- `lib/` — all pure engines above, each with a `*.test.ts`. Integration test:
  `lib/pipeline.test.ts` (chains the whole edit pipeline).
- `layouts/Layout.astro` — shell, header (3-zone grid), meta/manifest/SW reg.
- Edit pipeline (`Studio.buildFinalSvg()` / `displaySvg`):
  `compose-layers → injectOrigIdx → applyPathOverrides → applyColorGradients →
  removePaths → strip data-orig-idx → applyEffects → bakeBackdrop`. New render
  features slot into BOTH the display derivation and buildFinalSvg.

## 6. TODO — what I'd do next (priority order)
1. **Full Studio UI i18n string-swap** (biggest gap). The layer exists but the
   Studio's dozens of inline English strings aren't keyed. Extract → add keys to
   all 4 locales → wire `$t`. **zh-TW must be Traditional (identity); zh-TW/es
   need native review** — keep the maintainer in the loop, not a blind pass.
   CI's `astro check` type-checks `$t` keys.
2. **cver.net sync** (separate repo, deploys to prod on push): update
   `MARKMINT_*` i18n keys + `/oss` listing + detail page for the new features
   (multi-image, ASCII, effects, icon pack, copy-as); refresh GitHub topics.
3. **UX polish the maintainer may want** (observe/ask): mode-switch layout jump
   (2-col → full-width) could ease in; converting/loading states; hover feel.
4. Roadmap features: advanced trace controls UI (VTracer knobs), paste from
   clipboard + bundled sample logos, boolean ops, light theme + remembered
   settings.
5. **CLI + `npm publish @cver/markmint`** (needs a Node trace target + npm auth
   → maintainer).
6. Nits: raster `og.png` (some scrapers skip SVG OG); delete the 12 dead
   unused-CSS selectors in Studio; deeper a11y/keyboard audit (canvas + popover).

## 7. Guardrails (unchanged)
Stay lightweight (no server/upload/telemetry, Canvas-native, no heavy WASM);
export only the composed result; don't over-claim copy (evolve README +
cver.net as features land); keep internal trace/vectorize-verb code naming;
verify on CI + ask the maintainer for a look before stacking; deep-teal theme;
reply to the maintainer in Traditional Chinese.

---

## 8. Auto-guard 待辦（2026-06-10 追加）
全 CVER repo 在補「pre-push hook（本地）＋ CI 跑同一份 `scripts/test.sh`」的
auto-guard。已完成：tugtile · demodeck · sheersweep · clikae。markmint 當時卡住
（在 `feat/ascii-smooth-modes` 分支、2 個髒檔），沒做。回乾淨 main 後：

1. 建 `scripts/test.sh` ＋ `hooks/pre-push`（共用版），`chmod +x`。
2. `git config core.hooksPath hooks`
3. **在真實終端機（Node 22）`bash scripts/test.sh` 驗綠** —— astro check/build 在
   agent 沙箱會 hang（§1），別在沙箱驗。
4. `git add scripts hooks` → commit（作者 chodaict <x@cver.net>）。
5. push：本機 hook 跑 astro build（你的 mac OK）；若要從沙箱推就 `--no-verify`，靠 CI 把關。

`scripts/test.sh`（鏡射 `ci.yml`）：
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
npm run check
npm test
npm run build   # astro build — 真實終端機才跑得動
echo "✅ ALL GREEN"
```
`hooks/pre-push`：`exec bash "$(dirname "$0")/../scripts/test.sh"`
