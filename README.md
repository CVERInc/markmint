# vectorize

> Convert PNG / JPG / WebP to clean SVG — in your browser. Open source, MIT, no upload required.
>
> ブラウザだけで PNG / JPG / WebP を SVG に変換するオープンソースツール。アップロード不要、MIT ライセンス。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Astro](https://img.shields.io/badge/Built%20with-Astro-BC52EE)](https://astro.build/)
[![Engine: VTracer](https://img.shields.io/badge/Engine-VTracer%20(WASM)-orange)](https://github.com/visioncortex/vtracer)

**Live demo:** _coming soon_ · **License:** MIT · **No server, no upload, no signup**

[**English**](#english) ・ [**日本語**](#日本語)

---

## English

### Why another raster-to-SVG tool?

Most online tracers either upload your image to a third-party server, lock the
good output behind a paywall, or are stuck on dated algorithms. `vectorize`:

- Runs **entirely in your browser** via WebAssembly — your image never leaves
  your machine.
- Uses [**VTracer**](https://github.com/visioncortex/vtracer), a modern Rust
  vectorizer that handles **color**, not just black and white.
- Ships with **four presets** (Logo / Sketch / Photo / Pixel art) so non-experts
  get good output without tuning knobs.
- Optionally post-processes with **SVGO** for tiny, clean output.
- Is **MIT-licensed**, self-hostable, forkable, and free forever.

### Features

- Drag-and-drop or click to choose a file
- Presets:
  - **Logo / Illustration** — flat colors, crisp edges
  - **Sketch / Line art** — high-contrast B/W tracing
  - **Photo** — many colors, smooth curves
  - **Pixel art** — preserves sharp pixel edges
- Optional SVGO pass (multipass, viewBox-preserving)
- Live preview with checkered background
- One-click download
- Dark mode (follows system)
- Zero telemetry

### Quick start (use online)

Open `https://vectorize.cver.net` (coming soon) and drag an image in.

### Self-host

```bash
git clone https://github.com/CVERInc/vectorize.git
cd vectorize
npm install
npm run dev        # http://localhost:4321
npm run build      # static output in dist/
```

Deploy `dist/` to any static host — Cloudflare Pages, Netlify, Vercel, GitHub
Pages, or your own nginx. **No server runtime is required.**

> The wasm bundle is loaded from the same origin, so configure your host to
> serve `.wasm` files with `Content-Type: application/wasm` (most platforms do
> this automatically).

### Tech stack

| Layer | Choice | Why |
|---|---|---|
| Engine | [VTracer](https://github.com/visioncortex/vtracer) (Rust → WASM via `wasm_vtracer`) | Modern color tracing, MIT |
| Framework | [Astro](https://astro.build/) + [Svelte](https://svelte.dev/) islands | Static-first, tiny initial bundle |
| Post-processing | [SVGO](https://svgo.dev/) (lazy-loaded) | The de-facto SVG optimizer |
| Icons | [Lucide](https://lucide.dev/) | Clean line icons, ISC |
| Deployment | Static (Cloudflare Pages, Netlify, …) | Zero infra |

### Project layout

```
vectorize/
├─ src/
│  ├─ components/Vectorizer.svelte    # main UI (drop zone, presets, preview)
│  ├─ lib/
│  │  ├─ vectorize.ts                 # wasm wrapper + canvas decode
│  │  ├─ presets.ts                   # logo / sketch / photo / pixel-art
│  │  ├─ svgo.ts                      # post-processing (lazy)
│  │  └─ format.ts                    # bytes / filename helpers
│  ├─ layouts/Layout.astro
│  └─ pages/index.astro
├─ public/favicon.svg
├─ astro.config.mjs
└─ package.json
```

### Privacy

`vectorize` does not collect, log, or transmit anything. The image is decoded
via the browser's Canvas API, traced by the WebAssembly module on the same
page, and rendered locally. There is no server backend.

### Roadmap

- [ ] Web Worker for tracing (keep UI responsive on large images)
- [ ] CLI: `npx @cver/vectorize input.png > out.svg`
- [ ] Batch mode (zip in → zip out)
- [ ] PWA (offline / install to desktop)
- [ ] Advanced tab: expose raw VTracer knobs (color precision, corner threshold, …)
- [ ] Side-by-side original vs output preview slider
- [ ] Japanese / Traditional Chinese UI translations

### Contributing

See [**CONTRIBUTING.md**](./CONTRIBUTING.md). Issues, PRs, and translations
welcome.

### License

[MIT](./LICENSE). Third-party engine attributions in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

---

## 日本語

### なぜまた別のラスター → SVG ツール？

オンラインのトレーサーの多くは、画像を第三者サーバーにアップロードするか、
良い出力を有料化するか、古いアルゴリズムのままです。`vectorize` は：

- **完全にブラウザ上で動作**（WebAssembly）— 画像は端末から出ません。
- [**VTracer**](https://github.com/visioncortex/vtracer)（Rust 製のモダンな
  ベクトル化エンジン）採用 — モノクロだけでなく **カラー** にも対応。
- **4 つのプリセット**（Logo / Sketch / Photo / Pixel art）付き — パラメータ
  調整なしで良い結果。
- 仕上げに **SVGO** で軽量化（オプション）。
- **MIT ライセンス**、セルフホスト可、フォーク自由、永久無料。

### 機能

- ドラッグ＆ドロップ、または クリックで選択
- プリセット：
  - **Logo / Illustration** — フラットカラー・くっきりエッジ
  - **Sketch / Line art** — ハイコントラストの白黒トレース
  - **Photo** — 多色・滑らかなカーブ
  - **Pixel art** — シャープなピクセルエッジを保持
- SVGO によるポストプロセス（任意）
- チェッカー背景付きプレビュー
- ワンクリックダウンロード
- ダークモード（システム連動）
- テレメトリなし

### 使い方（オンライン版）

`https://vectorize.cver.net` を開いて画像をドラッグするだけ（公開予定）。

### セルフホスト

```bash
git clone https://github.com/CVERInc/vectorize.git
cd vectorize
npm install
npm run dev        # http://localhost:4321
npm run build      # dist/ に静的出力
```

`dist/` を任意の静的ホスティング（Cloudflare Pages / Netlify / Vercel /
GitHub Pages / nginx）にデプロイすればOK。**サーバランタイムは不要**。

### プライバシー

`vectorize` は何も収集・記録・送信しません。画像は Canvas API でデコード、
同じページ上の WebAssembly モジュールでトレース、ローカルで描画されます。
バックエンドサーバは存在しません。

### ロードマップ

- [ ] Web Worker でトレース（大きな画像でも UI を止めない）
- [ ] CLI: `npx @cver/vectorize input.png > out.svg`
- [ ] バッチモード（zip in → zip out）
- [ ] PWA（オフライン / デスクトップアプリ化）
- [ ] 詳細タブ：VTracer の生パラメータを公開
- [ ] 元画像 vs 出力のスライダー比較
- [ ] 日本語 / 繁体字中国語 UI 翻訳

### 貢献

[**CONTRIBUTING.md**](./CONTRIBUTING.md) を参照。Issue、PR、翻訳、すべて
歓迎します。

### ライセンス

[MIT](./LICENSE)。同梱の third-party 表記は
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照。

---

Built by [CVER Inc.](https://cver.net)
