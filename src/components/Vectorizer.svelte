<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Upload from '@lucide/svelte/icons/upload';
  import Download from '@lucide/svelte/icons/download';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import ImageIcon from '@lucide/svelte/icons/image';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Save from '@lucide/svelte/icons/save';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import MousePointer from '@lucide/svelte/icons/mouse-pointer';
  import Eraser from '@lucide/svelte/icons/eraser';
  import {
    PRESETS,
    PRESET_PARAMS,
    clonePreset,
    paramsEqual,
    type PresetId,
    type TracerParams,
  } from '~/lib/presets';
  import { decodeImage } from '~/lib/decode';
  import { formatBytes, stripExtension } from '~/lib/format';
  import {
    loadCustomPresets,
    addCustomPreset,
    removeCustomPreset,
    type CustomPreset,
  } from '~/lib/custom-presets';
  import {
    bakeBackdrop,
    DEFAULT_BACKDROP,
    backdropCss,
    backdropVisible,
    readViewBox,
    type BackdropOpts,
  } from '~/lib/backdrop';
  import { injectOrigIdx, removePaths } from '~/lib/punch-hole';
  import {
    parsePathList,
    applyPathOverrides,
    collectRemoved,
    setPathFill,
    setPathRemoved,
    bulkSetFill,
    bulkSetRemoved,
    type PathState,
    type PathInfo,
  } from '~/lib/path-state';
  import {
    applyColorGradients,
    shade,
    GRADIENT_PRESETS,
    type GradientSpec,
  } from '~/lib/gradient';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { WorkerRequest, WorkerResponse } from '~/lib/vectorize.worker';
  import CompareSlider from './CompareSlider.svelte';

  type Status = 'idle' | 'converting' | 'done' | 'error';

  let file = $state<File | null>(null);
  let previewUrl = $state<string | null>(null);
  let pixelsCache = $state<{ buffer: ArrayBuffer; width: number; height: number } | null>(null);

  let preset = $state<PresetId>('logo');
  let params = $state<TracerParams>(clonePreset('logo'));
  let advancedOpen = $state(false);
  let livePreview = $state(true);
  let optimize = $state(true);

  let svg = $state<string | null>(null);
  let outputBytes = $state(0);
  let durationMs = $state(0);
  let status = $state<Status>('idle');
  let errorMessage = $state<string | null>(null);
  let dragOver = $state(false);

  let customPresets = $state<CustomPreset[]>([]);
  let newPresetName = $state('');

  let backdrop = $state<BackdropOpts>({ ...DEFAULT_BACKDROP });
  let pathStates = $state<Map<number, PathState>>(new Map());
  // Per-color-group gradient fills, keyed by the group's original fill hex.
  let colorGradients = $state<Map<string, GradientSpec>>(new Map());
  let expandedGroups = $state<Set<string>>(new Set());
  let hoveredPathIdx = $state<number | null>(null);
  let speckleThreshold = $state(0);
  let specklePreviewing = $state(false);
  let specklePreviewTimer: ReturnType<typeof setTimeout> | null = null;
  let pathBBoxes = $state<Map<number, { w: number; h: number; x: number; y: number }>>(new Map());

  function specklePreviewOn() {
    if (specklePreviewTimer) {
      clearTimeout(specklePreviewTimer);
      specklePreviewTimer = null;
    }
    specklePreviewing = true;
  }
  function specklePreviewOffSoon() {
    if (specklePreviewTimer) clearTimeout(specklePreviewTimer);
    specklePreviewTimer = setTimeout(() => {
      specklePreviewing = false;
      specklePreviewTimer = null;
    }, 600);
  }

  // Measure all paths once when taggedSvg changes, caching their bounding boxes.
  $effect(() => {
    if (taggedSvg && typeof document !== 'undefined') {
      const wrapper = document.createElement('div');
      wrapper.style.position = 'fixed';
      wrapper.style.left = '-99999px';
      wrapper.style.width = '1px';
      wrapper.style.height = '1px';
      wrapper.style.visibility = 'hidden';
      wrapper.innerHTML = taggedSvg;
      const svgEl = wrapper.querySelector('svg');
      if (svgEl) {
        document.body.appendChild(wrapper);
        const paths = Array.from(svgEl.querySelectorAll('path[data-orig-idx]')) as SVGPathElement[];
        const nextBBoxes = new Map<number, { w: number; h: number; x: number; y: number }>();
        for (const p of paths) {
          const idxAttr = p.getAttribute('data-orig-idx');
          if (idxAttr) {
            const idx = parseInt(idxAttr, 10);
            try {
              const bb = p.getBBox();
              nextBBoxes.set(idx, { w: bb.width, h: bb.height, x: bb.x, y: bb.y });
            } catch {
              nextBBoxes.set(idx, { w: 0, h: 0, x: 0, y: 0 });
            }
          }
        }
        pathBBoxes = nextBBoxes;
        wrapper.remove();
      } else {
        pathBBoxes = new Map();
      }
    } else {
      pathBBoxes = new Map();
    }
  });

  const autoHiddenIdxs = $derived.by(() => {
    const set = new Set<number>();
    if (speckleThreshold > 0) {
      for (const [idx, box] of pathBBoxes) {
        if (box.w * box.h <= speckleThreshold) {
          set.add(idx);
        }
      }
    }
    return set;
  });

  function setHoveredOrigIdx(origIdx: number | null) {
    hoveredPathIdx = origIdx;
  }

  // Tagged SVG (with data-orig-idx on every <path>) so we can refer to
  // paths by their original index even after some are merged away.
  const taggedSvg = $derived(svg ? injectOrigIdx(svg) : null);
  const pathList = $derived(taggedSvg ? parsePathList(taggedSvg) : []);

  // Group paths by original fill color for the Layers panel.
  interface PathGroup {
    color: string;
    paths: PathInfo[];
  }
  const groupedPaths = $derived.by<PathGroup[]>(() => {
    const groups = new Map<string, PathInfo[]>();
    for (const p of pathList) {
      const list = groups.get(p.originalFill) ?? [];
      list.push(p);
      groups.set(p.originalFill, list);
    }
    return [...groups.entries()].map(([color, paths]) => ({ color, paths }));
  });

  // Display pipeline:
  //  1. Apply per-path fill overrides
  //  2. Punch / hide paths marked as removed
  const withOverrides = $derived(
    taggedSvg ? applyPathOverrides(taggedSvg, pathStates, autoHiddenIdxs, specklePreviewing) : null,
  );
  const removedIdxs = $derived(collectRemoved(pathStates));
  const displaySvg = $derived.by(() => {
    if (!withOverrides) return null;
    const withGradients =
      colorGradients.size > 0
        ? applyColorGradients(withOverrides, colorGradients, pathList)
        : withOverrides;
    return removedIdxs.length > 0 ? removePaths(withGradients, removedIdxs) : withGradients;
  });

  // Reset per-path state whenever the source SVG changes (new trace).
  let lastSvgRef = $state<string | null>(null);
  $effect(() => {
    if (svg !== lastSvgRef) {
      lastSvgRef = svg;
      pathStates = new Map();
      colorGradients = new Map();
      expandedGroups = new Set();
      hoveredPathIdx = null;
      speckleThreshold = 0;
    }
  });

  // Bidirectional hover sync: highlight the canvas path when hovering a
  // Layers row, and vice versa.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const idx = hoveredPathIdx;
    const wraps = document.querySelectorAll('.result-preview svg path, .svg-layer svg path');
    wraps.forEach((p) => {
      const pidx = parseInt((p as Element).getAttribute('data-orig-idx') ?? '-1', 10);
      if (pidx === idx) {
        (p as SVGElement).setAttribute('data-hovered', 'true');
      } else {
        (p as SVGElement).removeAttribute('data-hovered');
      }
    });
  });

  let worker: Worker | null = null;
  let pendingId = 0;
  let lastId = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const presetLabel = $derived(PRESETS.find((p) => p.id === preset)?.label ?? '');
  const modified = $derived(!paramsEqual(params, PRESET_PARAMS[preset]));

  const detailLevel = $derived(deriveDetail(params));

  function deriveDetail(p: TracerParams): number {
    const fromSpeckle = Math.round(((12 - Math.min(12, p.filterSpeckle)) * 9) / 12 + 1);
    return Math.max(1, Math.min(10, fromSpeckle));
  }

  function setDetail(d: number) {
    params.filterSpeckle = Math.round(((10 - d) * 12) / 9);
    params.colorPrecision = Math.max(1, Math.min(8, Math.round(2 + ((d - 1) * 6) / 9)));
  }

  onMount(() => {
    customPresets = loadCustomPresets();
    worker = new Worker(new URL('../lib/vectorize.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== lastId) return;
      if (e.data.type === 'done') {
        svg = e.data.svg;
        outputBytes = new TextEncoder().encode(e.data.svg).length;
        durationMs = e.data.durationMs;
        status = 'done';
      } else {
        errorMessage = e.data.message;
        status = 'error';
      }
    };
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (worker) worker.terminate();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });

  function selectPreset(id: PresetId) {
    preset = id;
    params = clonePreset(id);
    schedule();
  }

  function loadCustomPreset(p: CustomPreset) {
    params = { ...p.params };
    schedule();
  }

  function saveCurrentAsPreset() {
    const name = newPresetName.trim();
    if (!name) return;
    customPresets = addCustomPreset(name, params);
    newPresetName = '';
  }

  function deleteCustomPreset(name: string) {
    customPresets = removeCustomPreset(name);
  }

  function resetToPreset() {
    params = clonePreset(preset);
    schedule();
  }

  function togglePathRemoved(origIdx: number) {
    const cur = pathStates.get(origIdx);
    pathStates = setPathRemoved(pathStates, origIdx, !cur?.removed);
  }
  function setPathColor(origIdx: number, color: string) {
    pathStates = setPathFill(pathStates, origIdx, color);
  }
  function clearPathColor(origIdx: number) {
    pathStates = setPathFill(pathStates, origIdx, undefined);
  }
  function bulkColor(originalFill: string, color: string) {
    pathStates = bulkSetFill(pathStates, pathList, originalFill, color);
  }
  function bulkRemove(originalFill: string, removed: boolean) {
    pathStates = bulkSetRemoved(pathStates, pathList, originalFill, removed);
  }

  // ── Gradient fills (per color group) ──────────────────────────────
  function setColorGradient(key: string, spec: GradientSpec | undefined) {
    const next = new Map(colorGradients);
    if (spec) next.set(key, spec);
    else next.delete(key);
    colorGradients = next;
  }
  function toggleGroupGradient(key: string, baseFill: string) {
    if (colorGradients.has(key)) {
      setColorGradient(key, undefined);
    } else {
      setColorGradient(key, {
        stops: [
          { color: baseFill, offset: 0 },
          { color: shade(baseFill, 0.55), offset: 100 },
        ],
        angle: 90,
      });
    }
  }
  function setGradientStop(key: string, i: number, color: string) {
    const cur = colorGradients.get(key);
    if (!cur) return;
    const stops = cur.stops.map((s, idx) => (idx === i ? { ...s, color } : s));
    setColorGradient(key, { ...cur, stops });
  }
  function setGradientAngle(key: string, angle: number) {
    const cur = colorGradients.get(key);
    if (!cur) return;
    setColorGradient(key, { ...cur, angle });
  }
  function applyGradientPreset(key: string, a: string, b: string, angle: number) {
    setColorGradient(key, {
      stops: [
        { color: a, offset: 0 },
        { color: b, offset: 100 },
      ],
      angle,
    });
  }

  function resetAllPaths() {
    pathStates = new Map();
    colorGradients = new Map();
    speckleThreshold = 0;
  }
  function runSmartClean() {
    speckleThreshold = 30;
    if (params.filterSpeckle < 6) {
      params.filterSpeckle = 6;
    }
    if (params.colorMode === 0 && params.layerDifference < 24) {
      params.layerDifference = 24;
    }
  }
  function toggleGroup(color: string) {
    const next = new Set(expandedGroups);
    if (next.has(color)) next.delete(color);
    else next.add(color);
    expandedGroups = next;
  }

  let activeTool = $state<'select' | 'eraser'>('select');
  let selectedPathIdx = $state<number | null>(null);
  let popoverPosition = $state<{ x: number; y: number } | null>(null);

  function handlePathClick(origIdx: number, event?: MouseEvent) {
    if (activeTool === 'eraser') {
      togglePathRemoved(origIdx);
    } else {
      // Select mode: Open popover
      if (selectedPathIdx === origIdx) {
        selectedPathIdx = null;
        popoverPosition = null;
      } else {
        selectedPathIdx = origIdx;
        if (event) {
          popoverPosition = { x: event.clientX, y: event.clientY };
        } else {
          popoverPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        }
      }
    }
  }

  function handleMarqueeSelect(box: { x: number; y: number; w: number; h: number }) {
    if (typeof document === 'undefined') return;
    const compareContainer = document.querySelector('.compare');
    const svgEl = compareContainer?.querySelector('.svg-layer svg') as SVGSVGElement | null;
    if (!compareContainer || !svgEl) return;

    const vbAttr = svgEl.getAttribute('viewBox');
    if (!vbAttr) return;
    const vbParts = vbAttr.trim().split(/[\s,]+/).map(Number);
    if (vbParts.length !== 4) return;
    const [vbX, vbY, vbW, vbH] = vbParts;

    const svgRect = svgEl.getBoundingClientRect();
    const containerRect = compareContainer.getBoundingClientRect();

    const relativeX = box.x - (svgRect.left - containerRect.left);
    const relativeY = box.y - (svgRect.top - containerRect.top);

    const scaleX = vbW / svgRect.width;
    const scaleY = vbH / svgRect.height;

    const selX = vbX + relativeX * scaleX;
    const selY = vbY + relativeY * scaleY;
    const selW = box.w * scaleX;
    const selH = box.h * scaleY;

    const toRemove: number[] = [];
    for (const [idx, pathBox] of pathBBoxes) {
      const intersects = (
        pathBox.x < selX + selW &&
        pathBox.x + pathBox.w > selX &&
        pathBox.y < selY + selH &&
        pathBox.y + pathBox.h > selY
      );
      if (intersects) {
        toRemove.push(idx);
      }
    }

    if (toRemove.length > 0) {
      let nextStates = pathStates;
      for (const idx of toRemove) {
        nextStates = setPathRemoved(nextStates, idx, true);
      }
      pathStates = nextStates;
    }
  }

  $effect(() => {
    JSON.stringify(params);
    optimize;
    schedule();
  });

  function schedule() {
    if (!livePreview || !pixelsCache || !worker) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runConvert(), 350);
  }

  async function pickFile(f: File) {
    if (!/^image\/(png|jpe?g|webp|bmp)$/i.test(f.type)) {
      errorMessage = `Unsupported file type: ${f.type || 'unknown'}`;
      status = 'error';
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    file = f;
    previewUrl = URL.createObjectURL(f);
    svg = null;
    errorMessage = null;
    status = 'idle';

    try {
      const decoded = await decodeImage(f);
      pixelsCache = {
        buffer: decoded.data.buffer.slice(0),
        width: decoded.width,
        height: decoded.height,
      };
      if (livePreview) runConvert();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      status = 'error';
    }
  }

  function onFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) pickFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) pickFile(f);
  }

  function runConvert() {
    if (!pixelsCache || !worker) return;
    errorMessage = null;
    status = 'converting';
    lastId = ++pendingId;
    const clone = pixelsCache.buffer.slice(0);
    const req: WorkerRequest = {
      id: lastId,
      pixels: clone,
      width: pixelsCache.width,
      height: pixelsCache.height,
      params: { ...params },
      optimize,
    };
    worker.postMessage(req, [clone]);
  }

  // Bake all edits (recolor / hide / punch-hole / backdrop) into one clean SVG.
  function buildFinalSvg(): string | null {
    if (!svg) return null;
    const tagged = injectOrigIdx(svg);
    const overridden = applyPathOverrides(tagged, pathStates);
    // Gradients need data-orig-idx, so apply before the strip below.
    const gradiented =
      colorGradients.size > 0
        ? applyColorGradients(overridden, colorGradients, pathList)
        : overridden;
    const removed = removedIdxs.length > 0 ? removePaths(gradiented, removedIdxs) : gradiented;
    // Strip the data-orig-idx attrs from the final output (clean SVG)
    const cleaned = removed.replace(/\sdata-orig-idx="\d+"/g, '');
    return bakeBackdrop(cleaned, backdrop);
  }

  function saveBlob(blob: Blob, ext: string) {
    if (!file) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stripExtension(file.name)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Raster export: render the composed SVG to a canvas via the browser's own
  // image pipeline (no extra WASM) and read it back with toBlob. Single
  // direction only — we export the traced/composed result, never transcode
  // an arbitrary upload.
  type RasterFmt = 'png' | 'webp' | 'jpeg';
  const RASTER_MIME: Record<RasterFmt, string> = {
    png: 'image/png',
    webp: 'image/webp',
    jpeg: 'image/jpeg',
  };

  let downloadFormat = $state<'svg' | RasterFmt>('svg');
  let rasterSize = $state<number>(512); // longest edge in px (0 = source resolution)
  let exporting = $state(false);

  async function rasterize(finalSvg: string, fmt: RasterFmt): Promise<Blob> {
    const vb = readViewBox(finalSvg);
    const ar = vb && vb.h > 0 ? vb.w / vb.h : 1;
    const longest =
      rasterSize > 0
        ? rasterSize
        : Math.max(pixelsCache?.width ?? 512, pixelsCache?.height ?? 512);
    const w = ar >= 1 ? longest : Math.max(1, Math.round(longest * ar));
    const h = ar >= 1 ? Math.max(1, Math.round(longest / ar)) : longest;

    // Give the SVG explicit pixel dims so the <img> rasterizes at full res.
    const sized = finalSvg.replace(
      /<svg([^>]*)>/i,
      (_m, attrs: string) =>
        `<svg${attrs.replace(/\s(?:width|height)\s*=\s*"[^"]*"/gi, '')} width="${w}" height="${h}">`,
    );

    const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not render SVG'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not available');
      // JPEG has no alpha — flatten transparency onto white instead of black.
      if (fmt === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Export failed'))),
          RASTER_MIME[fmt],
          fmt === 'jpeg' ? 0.92 : undefined,
        ),
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function download() {
    if (!svg || !file || exporting) return;
    const finalSvg = buildFinalSvg();
    if (!finalSvg) return;
    if (downloadFormat === 'svg') {
      saveBlob(new Blob([finalSvg], { type: 'image/svg+xml' }), 'svg');
      return;
    }
    exporting = true;
    try {
      const blob = await rasterize(finalSvg, downloadFormat);
      saveBlob(blob, downloadFormat === 'jpeg' ? 'jpg' : downloadFormat);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      status = 'error';
    } finally {
      exporting = false;
    }
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (debounceTimer) clearTimeout(debounceTimer);
    file = null;
    previewUrl = null;
    pixelsCache = null;
    svg = null;
    outputBytes = 0;
    durationMs = 0;
    errorMessage = null;
    status = 'idle';
    pathStates = new Map();
    expandedGroups = new Set();
    hoveredPathIdx = null;
  }
</script>

<section class="vectorizer">
  {#if !file}
    <label
      class="dropzone"
      class:drag-over={dragOver}
      ondragover={(e) => {
        e.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={onDrop}
    >
      <input type="file" accept="image/png,image/jpeg,image/webp,image/bmp" onchange={onFileInput} hidden />
      <Upload size={40} strokeWidth={1.5} />
      <p class="dropzone-title">Drop an image here, or click to choose</p>
      <p class="dropzone-hint">PNG · JPG · WebP · BMP — converted locally in your browser, nothing is uploaded.</p>
    </label>
  {:else}
    <div class="workspace">
      <!-- LEFT: controls -->
      <aside class="controls">
        <div class="file-row">
          {#if previewUrl}
            <img class="thumb" src={previewUrl} alt="" />
          {/if}
          <div class="file-meta">
            <div class="file-name">{file.name}</div>
            <div class="file-size">{formatBytes(file.size)}</div>
          </div>
          <button class="ghost icon-btn" type="button" onclick={reset} aria-label="Choose different file">
            <RefreshCw size={16} />
          </button>
        </div>

        <div class="card">
          <div class="card-row">
            <span class="card-label">Preset</span>
            <fieldset class="seg">
              <div class="seg-buttons">
                {#each PRESETS as p}
                  <button
                    type="button"
                    class:on={preset === p.id}
                    title={p.description}
                    onclick={() => selectPreset(p.id)}
                  >{p.label}</button>
                {/each}
              </div>
            </fieldset>
          </div>
          {#if customPresets.length > 0}
            <div class="custom-presets">
              {#each customPresets as cp}
                <fieldset class="seg">
                  <div class="seg-buttons">
                    <button type="button" onclick={() => loadCustomPreset(cp)} title={cp.name}>{cp.name}</button>
                    <button type="button" class="seg-x" onclick={() => deleteCustomPreset(cp.name)} aria-label="Delete {cp.name}">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </fieldset>
              {/each}
            </div>
          {/if}

          <div class="slider tight">
            <div class="slider-head">
              <label for="detail">Detail level</label>
              <span class="value">{detailLevel} / 10</span>
            </div>
            <input
              id="detail"
              type="range"
              min="1"
              max="10"
              step="1"
              value={detailLevel}
              oninput={(e) => setDetail(Number((e.target as HTMLInputElement).value))}
            />
            <div class="slider-hint"><span>Coarse</span><span>Fine</span></div>
          </div>

          <div class="slider tight">
            <div class="slider-head">
              <label for="speckle-filter">Speckle Filter (Noise Clean)</label>
              <span class="value">
                {#if speckleThreshold === 0}
                  Off
                {:else}
                  {speckleThreshold} px²
                  {#if autoHiddenIdxs.size > 0}
                    <span class="speckle-count" class:active={specklePreviewing}>
                      − {autoHiddenIdxs.size}
                    </span>
                  {/if}
                {/if}
              </span>
            </div>
            <input
              id="speckle-filter"
              type="range"
              min="0"
              max="400"
              step="2"
              bind:value={speckleThreshold}
              oninput={specklePreviewOn}
              onpointerdown={specklePreviewOn}
              onpointerup={specklePreviewOffSoon}
              onpointercancel={specklePreviewOffSoon}
              onfocus={specklePreviewOn}
              onblur={specklePreviewOffSoon}
              onmouseenter={specklePreviewOn}
              onmouseleave={specklePreviewOffSoon}
            />
            <div class="slider-hint">
              <span>Keep all</span>
              <span>{specklePreviewing && autoHiddenIdxs.size > 0 ? 'Red = will be removed' : 'Aggressive clean'}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-row">
            <span class="card-label">Aspect</span>
            <div class="seg-buttons">
              <button type="button" class:on={backdrop.aspect === 'original'} onclick={() => (backdrop.aspect = 'original')}>Original</button>
              <button type="button" class:on={backdrop.aspect === 'square'} onclick={() => (backdrop.aspect = 'square')}>Square</button>
            </div>
          </div>

          <div class="card-row">
            <span class="card-label">Backdrop</span>
            <div class="color-pick">
              <input type="color" bind:value={backdrop.color} aria-label="Backdrop color" />
              <input
                type="text"
                class="hex"
                maxlength="9"
                bind:value={backdrop.color}
              />
            </div>
          </div>

          <div class="slider-grid three">
            <div class="slider tight">
              <div class="slider-head">
                <label for="bd-alpha">Alpha</label>
                <span class="value">{backdrop.alpha}%</span>
              </div>
              <input id="bd-alpha" type="range" min="0" max="100" step="1" bind:value={backdrop.alpha} />
            </div>
            <div class="slider tight">
              <div class="slider-head">
                <label for="bd-radius">Radius</label>
                <span class="value">{backdrop.radius}%</span>
              </div>
              <input id="bd-radius" type="range" min="0" max="50" step="1" bind:value={backdrop.radius} />
            </div>
            <div class="slider tight">
              <div class="slider-head">
                <label for="bd-padding">Padding</label>
                <span class="value">{backdrop.padding}%</span>
              </div>
              <input id="bd-padding" type="range" min="0" max="30" step="1" bind:value={backdrop.padding} />
            </div>
          </div>

          {#if pathList.length > 0}
            <div class="layers">
              <div class="card-row" style="justify-content: space-between; width: 100%;">
                <span class="card-label">Layers</span>
                <div class="layer-header-actions" style="display: flex; gap: 0.375rem;">
                  <button class="tiny-btn primary-tiny" type="button" onclick={runSmartClean} title="Clean small noise paths and group near colors">
                    <span>🧹 Smart Clean</span>
                  </button>
                  {#if pathStates.size > 0 || speckleThreshold > 0}
                    <button class="tiny-btn" type="button" onclick={resetAllPaths}>
                      <RotateCcw size={11} />
                      <span>Reset all</span>
                    </button>
                  {/if}
                </div>
              </div>
              {#each groupedPaths as group (group.color)}
                {@const expanded = expandedGroups.has(group.color)}
                {@const allRemoved = group.paths.every((p) => pathStates.get(p.origIdx)?.removed)}
                {@const groupFill = group.paths[0]
                  ? (pathStates.get(group.paths[0].origIdx)?.fill ?? group.color)
                  : group.color}
                {@const grad = colorGradients.get(group.color)}
                <div class="layer-group">
                  <div class="group-row">
                    <button
                      class="expand-btn"
                      type="button"
                      onclick={() => toggleGroup(group.color)}
                      aria-label={expanded ? 'Collapse' : 'Expand'}
                    >
                      <ChevronRight size={12} class={expanded ? 'rotated' : ''} />
                    </button>
                    <label
                      class="layer-swatch"
                      class:hidden={allRemoved}
                      style:background={allRemoved
                        ? undefined
                        : grad
                          ? `linear-gradient(${grad.angle + 90}deg, ${grad.stops[0].color}, ${grad.stops[grad.stops.length - 1].color})`
                          : groupFill}
                    >
                      <input
                        type="color"
                        value={groupFill}
                        oninput={(e) => bulkColor(group.color, (e.target as HTMLInputElement).value)}
                        disabled={allRemoved || !!grad}
                        aria-label="Recolor all {group.paths.length} paths of {group.color}"
                      />
                    </label>
                    <span class="layer-meta">{group.paths.length} path{group.paths.length === 1 ? '' : 's'}</span>
                    <button
                      class="grad-toggle"
                      class:on={!!grad}
                      type="button"
                      disabled={allRemoved}
                      onclick={() => toggleGroupGradient(group.color, groupFill)}
                      aria-label={grad ? 'Remove gradient' : 'Add gradient fill'}
                      title={grad ? 'Remove gradient' : 'Gradient fill'}
                    >
                      <span class="grad-chip"></span>
                    </button>
                    <button
                      class="layer-hide"
                      class:on={allRemoved}
                      type="button"
                      onclick={() => bulkRemove(group.color, !allRemoved)}
                      aria-label={allRemoved ? 'Show group' : 'Hide group'}
                    >
                      <EyeOff size={11} />
                    </button>
                  </div>
                  {#if grad}
                    <div class="grad-editor">
                      <label class="grad-stop" style:background={grad.stops[0].color}>
                        <input
                          type="color"
                          value={grad.stops[0].color}
                          oninput={(e) => setGradientStop(group.color, 0, (e.target as HTMLInputElement).value)}
                          aria-label="Gradient start color"
                        />
                      </label>
                      <input
                        class="grad-angle-range"
                        type="range"
                        min="0"
                        max="360"
                        step="15"
                        value={grad.angle}
                        oninput={(e) => setGradientAngle(group.color, +(e.target as HTMLInputElement).value)}
                        aria-label="Gradient angle"
                      />
                      <label class="grad-stop" style:background={grad.stops[grad.stops.length - 1].color}>
                        <input
                          type="color"
                          value={grad.stops[grad.stops.length - 1].color}
                          oninput={(e) => setGradientStop(group.color, grad.stops.length - 1, (e.target as HTMLInputElement).value)}
                          aria-label="Gradient end color"
                        />
                      </label>
                      <div class="grad-presets">
                        {#each GRADIENT_PRESETS as gp (gp.name)}
                          <button
                            type="button"
                            class="grad-preset"
                            style:background={`linear-gradient(${gp.angle + 90}deg, ${gp.a}, ${gp.b})`}
                            onclick={() => applyGradientPreset(group.color, gp.a, gp.b, gp.angle)}
                            title={gp.name}
                            aria-label="Apply {gp.name} gradient"
                          ></button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  {#if expanded}
                    <ul class="layer-children">
                      {#each group.paths as p (p.origIdx)}
                        {@const st = pathStates.get(p.origIdx)}
                        {@const removed = st?.removed ?? false}
                        {@const fill = st?.fill ?? p.originalFill}
                        <li
                          class:hovered={hoveredPathIdx === p.origIdx}
                          class:removed
                          onmouseenter={() => (hoveredPathIdx = p.origIdx)}
                          onmouseleave={() => (hoveredPathIdx = null)}
                        >
                          <label class="layer-swatch small" class:hidden={removed} style:background={removed ? undefined : fill}>
                            <input
                              type="color"
                              value={fill}
                              oninput={(e) => setPathColor(p.origIdx, (e.target as HTMLInputElement).value)}
                              disabled={removed}
                              aria-label="Recolor path {p.origIdx}"
                            />
                          </label>
                          <span class="layer-meta path-meta">Path {p.origIdx}</span>
                          <button
                            class="layer-hide small"
                            class:on={removed}
                            type="button"
                            onclick={() => togglePathRemoved(p.origIdx)}
                            aria-label={removed ? 'Show path' : 'Hide path'}
                          >
                            <EyeOff size={11} />
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/each}
              <p class="hint">Click on canvas to remove a path. Use ▶ to recolor individual paths.</p>
            </div>
          {/if}
        </div>

        <details class="advanced" bind:open={advancedOpen}>
          <summary>
            <ChevronDown size={16} class="chev" />
            <span>Advanced settings</span>
            {#if modified}
              <span class="badge">modified</span>
            {/if}
          </summary>
          <div class="sliders">
            <div class="modes">
              <fieldset class="seg">
                <legend>Color mode</legend>
                <div class="seg-buttons">
                  <button type="button" class:on={params.colorMode === 0} onclick={() => (params.colorMode = 0)}>Color</button>
                  <button type="button" class:on={params.colorMode === 1} onclick={() => (params.colorMode = 1)}>Binary</button>
                </div>
              </fieldset>

              <fieldset class="seg">
                <legend>Curves</legend>
                <div class="seg-buttons">
                  <button type="button" class:on={params.pathSimplifyMode === 0} onclick={() => (params.pathSimplifyMode = 0)}>Polygon</button>
                  <button type="button" class:on={params.pathSimplifyMode === 1} onclick={() => (params.pathSimplifyMode = 1)}>Spline</button>
                  <button type="button" class:on={params.pathSimplifyMode === 2} onclick={() => (params.pathSimplifyMode = 2)}>None</button>
                </div>
              </fieldset>
            </div>

            <div class="slider tight">
              <div class="slider-head">
                <label for="filter-speckle">Filter speckle</label>
                <span class="value">{params.filterSpeckle}</span>
              </div>
              <input id="filter-speckle" type="range" min="0" max="16" step="1" bind:value={params.filterSpeckle} />
            </div>

            <div class="slider tight">
              <div class="slider-head">
                <label for="color-precision">Color precision</label>
                <span class="value">{params.colorPrecision}</span>
              </div>
              <input id="color-precision" type="range" min="1" max="8" step="1" bind:value={params.colorPrecision} disabled={params.colorMode === 1} />
            </div>

            <div class="slider tight">
              <div class="slider-head">
                <label for="corner-threshold">Corners</label>
                <span class="value">{params.cornerThreshold}°</span>
              </div>
              <input id="corner-threshold" type="range" min="0" max="180" step="1" bind:value={params.cornerThreshold} />
            </div>

            <div class="slider tight">
              <div class="slider-head">
                <label for="splice-threshold">Smoothness</label>
                <span class="value">{params.spliceThreshold}°</span>
              </div>
              <input id="splice-threshold" type="range" min="0" max="180" step="1" bind:value={params.spliceThreshold} />
            </div>

            <div class="slider tight">
              <div class="slider-head">
                <label for="layer-difference">Layer split</label>
                <span class="value">{params.layerDifference}</span>
              </div>
              <input id="layer-difference" type="range" min="0" max="64" step="1" bind:value={params.layerDifference} disabled={params.colorMode === 1} />
            </div>

            <div class="slider tight">
              <div class="slider-head">
                <label for="path-precision">Output decimals</label>
                <span class="value">{params.pathPrecision}</span>
              </div>
              <input id="path-precision" type="range" min="0" max="8" step="1" bind:value={params.pathPrecision} />
            </div>

            <div class="advanced-actions">
              {#if modified}
                <button class="ghost tiny-btn" type="button" onclick={resetToPreset}>
                  <RotateCcw size={12} />
                  <span>Reset to "{presetLabel}"</span>
                </button>
              {/if}
              <div class="save-preset">
                <input
                  type="text"
                  placeholder="Save as preset…"
                  maxlength="32"
                  bind:value={newPresetName}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveCurrentAsPreset();
                    }
                  }}
                />
                <button class="ghost tiny-btn" type="button" onclick={saveCurrentAsPreset} disabled={!newPresetName.trim()}>
                  <Save size={12} />
                  <span>Save</span>
                </button>
              </div>
            </div>
          </div>
        </details>

        <div class="toggles-row">
          <label class="toggle small">
            <input type="checkbox" bind:checked={livePreview} />
            <span>Live preview</span>
          </label>
          <label class="toggle small">
            <input type="checkbox" bind:checked={optimize} />
            <span>SVGO</span>
          </label>
          {#if !livePreview}
            <button class="primary" type="button" onclick={runConvert} disabled={status === 'converting' || !pixelsCache}>
              {#if status === 'converting'}
                <Loader2 size={14} class="spin" />
                <span>Tracing…</span>
              {:else}
                <ImageIcon size={14} />
                <span>Convert</span>
              {/if}
            </button>
          {/if}
        </div>
      </aside>

      <!-- RIGHT: preview -->
      <div class="preview-pane">
        {#if errorMessage}
          <div class="error" role="alert">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        {/if}

        {#if displaySvg}
          <div class="result">
            <div class="result-header">
              <div class="size-compare">
                <span>{formatBytes(file.size)}</span>
                <span class="arrow">→</span>
                <span class="output-size">{formatBytes(outputBytes)}</span>
                {#if durationMs > 0}
                  <span class="dot">·</span>
                  <span class="duration">{durationMs.toFixed(0)}ms</span>
                {/if}
                {#if status === 'converting'}
                  <span class="dot">·</span>
                  <Loader2 size={14} class="spin muted" />
                {/if}
              </div>
              <div class="result-actions">
                <label class="export-select" title="Output format">
                  <select bind:value={downloadFormat} aria-label="Output format">
                    <option value="svg">SVG</option>
                    <option value="png">PNG</option>
                    <option value="webp">WebP</option>
                    <option value="jpeg">JPG</option>
                  </select>
                </label>
                {#if downloadFormat !== 'svg'}
                  <label class="export-select" title="Pixel size (longest edge)">
                    <select bind:value={rasterSize} aria-label="Pixel size">
                      <option value={0}>Source</option>
                      <option value={1024}>1024px</option>
                      <option value={512}>512px</option>
                      <option value={256}>256px</option>
                      <option value={128}>128px</option>
                    </select>
                  </label>
                {/if}
                <button class="primary" type="button" onclick={download} disabled={exporting}>
                  {#if exporting}
                    <Loader2 size={16} class="spin" />
                  {:else}
                    <Download size={16} />
                  {/if}
                  <span>Download</span>
                </button>
              </div>
            </div>
            <div class="editor-toolbar">
              <div class="tool-group">
                <button
                  type="button"
                  class="tool-btn"
                  class:active={activeTool === 'select'}
                  onclick={() => { activeTool = 'select'; selectedPathIdx = null; popoverPosition = null; }}
                  title="Select mode: click shape to inspect/recolor/isolate"
                >
                  <MousePointer size={14} />
                  <span>Select Shape</span>
                </button>
                <button
                  type="button"
                  class="tool-btn"
                  class:active={activeTool === 'eraser'}
                  onclick={() => { activeTool = 'eraser'; selectedPathIdx = null; popoverPosition = null; }}
                  title="Eraser mode: click or drag-select to delete paths"
                >
                  <Eraser size={14} />
                  <span>Eraser Tool</span>
                </button>
              </div>

              <div class="hide-actions">
                {#if removedIdxs.length > 0}
                  <span class="hide-count">{removedIdxs.length} hidden</span>
                  <button type="button" class="tiny-btn" onclick={resetAllPaths}>
                    <RotateCcw size={11} />
                    <span>Restore all</span>
                  </button>
                {:else}
                  <span class="hide-hint">
                    {activeTool === 'select' ? 'Click shape to inspect' : 'Click/drag box to delete'}
                  </span>
                {/if}
              </div>
            </div>

            {#if previewUrl}
              <CompareSlider
                originalUrl={previewUrl}
                svg={displaySvg}
                {backdrop}
                {activeTool}
                onPathClick={handlePathClick}
                onPathHover={setHoveredOrigIdx}
                onMarqueeSelect={handleMarqueeSelect}
              />
            {/if}

            {#if selectedPathIdx !== null && popoverPosition}
              {@const pathInfo = pathList.find((p) => p.origIdx === selectedPathIdx)}
              {#if pathInfo}
                {@const state = pathStates.get(selectedPathIdx)}
                {@const currentFill = state?.fill ?? pathInfo.originalFill}
                {@const group = groupedPaths.find((g) => g.paths.some((p) => p.origIdx === selectedPathIdx))}
                {@const pathCount = group ? group.paths.length : 1}
                <div class="popover-backdrop" onclick={() => { selectedPathIdx = null; popoverPosition = null; }} role="presentation"></div>
                <div
                  class="popover glass"
                  style:left="{popoverPosition.x}px"
                  style:top="{popoverPosition.y - 10}px"
                >
                  <div class="popover-arrow"></div>
                  <div class="popover-header">
                    <span class="popover-title">Shape #{selectedPathIdx}</span>
                    <button type="button" class="popover-close" onclick={() => { selectedPathIdx = null; popoverPosition = null; }}>×</button>
                  </div>
                  <div class="popover-body">
                    <div class="popover-row">
                      <span class="popover-label">Color</span>
                      <div class="color-pick small">
                        <input
                          type="color"
                          value={currentFill}
                          oninput={(e) => setPathColor(selectedPathIdx, (e.target as HTMLInputElement).value)}
                          aria-label="Recolor shape #{selectedPathIdx}"
                        />
                        <span class="popover-color-hex">{currentFill}</span>
                        {#if state?.fill}
                          <button type="button" class="tiny-btn" onclick={() => clearPathColor(selectedPathIdx)}>Reset</button>
                        {/if}
                      </div>
                    </div>
                    <div class="popover-row actions">
                      <button
                        type="button"
                        class="tiny-btn popover-action-btn"
                        onclick={() => { togglePathRemoved(selectedPathIdx); selectedPathIdx = null; popoverPosition = null; }}
                      >
                        <EyeOff size={11} />
                        <span>Hide Shape</span>
                      </button>
                      <button
                        type="button"
                        class="tiny-btn popover-action-btn"
                        onclick={() => {
                          let nextStates = pathStates;
                          for (const p of pathList) {
                            if (p.origIdx !== selectedPathIdx) {
                              nextStates = setPathRemoved(nextStates, p.origIdx, true);
                            } else {
                              nextStates = setPathRemoved(nextStates, p.origIdx, false);
                            }
                          }
                          pathStates = nextStates;
                          selectedPathIdx = null;
                          popoverPosition = null;
                        }}
                        title="Hide all other shapes"
                      >
                        <span>Isolate</span>
                      </button>
                      <button
                        type="button"
                        class="tiny-btn popover-action-btn"
                        onclick={() => {
                          if (group) {
                            expandedGroups = new Set([group.color]);
                          }
                          selectedPathIdx = null;
                          popoverPosition = null;
                        }}
                        title="Expand layers to this color group"
                      >
                        <span>Show in Layers ({pathCount})</span>
                      </button>
                    </div>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        {:else}
          <div class="placeholder">
            {#if status === 'converting'}
              <Loader2 size={32} class="spin muted" />
              <p>Tracing…</p>
            {:else}
              <ImageIcon size={32} strokeWidth={1.5} class="muted" />
              <p>Adjust settings on the left to see the SVG output.</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .vectorizer {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  /* ─── Drop zone ─── */
  .dropzone {
    border: 1.5px dashed var(--border);
    border-radius: 12px;
    padding: 3rem 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    color: var(--text);
  }
  .dropzone:hover,
  .dropzone.drag-over {
    border-color: var(--accent);
    background: var(--accent-bg);
  }
  .dropzone-title {
    margin: 0;
    font-weight: 500;
  }
  .dropzone-hint {
    margin: 0;
    font-size: 0.875rem;
    color: var(--muted);
  }

  /* ─── Two-column workspace ─── */
  .workspace {
    display: grid;
    grid-template-columns: minmax(340px, 420px) minmax(0, 1fr);
    gap: 1.25rem;
    align-items: start;
  }
  @media (max-width: 880px) {
    .workspace {
      grid-template-columns: 1fr;
    }
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }
  .preview-pane {
    position: sticky;
    top: 1rem;
    min-width: 0;
  }
  @media (max-width: 880px) {
    .preview-pane {
      position: static;
    }
  }

  /* ─── File row ─── */
  .file-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .thumb {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 6px;
    background: #f0f0f0;
    flex-shrink: 0;
  }
  .file-meta {
    flex: 1;
    min-width: 0;
  }
  .file-name {
    font-weight: 500;
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-size {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .icon-btn {
    padding: 0.4rem !important;
  }

  /* ─── Card ─── */
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.875rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
  }
  .card-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .card-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--muted);
    min-width: 56px;
  }

  /* ─── Custom presets row ─── */
  .custom-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-top: -0.25rem;
  }
  .seg-x {
    padding-left: 0.4rem !important;
    padding-right: 0.4rem !important;
    color: var(--muted);
  }
  .seg-x:hover {
    color: #dc2626 !important;
  }

  /* ─── Segmented buttons ─── */
  .seg {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .seg.compact {
    gap: 0;
  }
  .seg legend {
    padding: 0;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .seg-buttons {
    display: flex;
  }
  .seg-buttons button {
    padding: 0.35rem 0.7rem;
    font-family: inherit;
    font-size: 0.8125rem;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .seg-buttons button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .seg-buttons button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .seg-buttons button:not(:first-child) {
    margin-left: -1px;
  }
  .seg-buttons button.on {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
    position: relative;
    z-index: 1;
  }

  /* ─── Color picker ─── */
  .color-pick {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-left: auto;
  }
  .color-pick input[type='color'] {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }
  .color-pick .hex {
    width: 88px;
    padding: 0.3rem 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    text-transform: lowercase;
  }
  .color-pick .hex:focus {
    outline: none;
    border-color: var(--accent);
  }

  /* ─── Sliders ─── */
  .slider {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .slider.tight {
    gap: 0.2rem;
  }
  .slider-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.875rem;
  }
  .slider-grid.three {
    grid-template-columns: 1fr 1fr 1fr;
  }
  @media (max-width: 520px) {
    .slider-grid.three {
      grid-template-columns: 1fr;
    }
  }
  .slider-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .slider-head label {
    font-size: 0.8125rem;
    font-weight: 500;
  }
  .slider-head .value {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--muted);
  }
  .slider input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .slider-hint {
    display: flex;
    justify-content: space-between;
    font-size: 0.6875rem;
    color: var(--muted);
  }

  /* ─── Layers panel ─── */
  .layers {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  .layer-group {
    display: flex;
    flex-direction: column;
  }
  .group-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
  }
  .expand-btn {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--muted);
    display: flex;
    align-items: center;
    width: 16px;
    height: 16px;
  }
  .expand-btn :global(svg) {
    transition: transform 0.15s;
  }
  .expand-btn :global(.rotated) {
    transform: rotate(90deg);
  }
  .layer-swatch {
    position: relative;
    width: 24px;
    height: 24px;
    border-radius: 5px;
    border: 1px solid var(--border);
    cursor: pointer;
    overflow: hidden;
    transition: transform 0.1s;
    flex-shrink: 0;
  }
  .layer-swatch.small {
    width: 20px;
    height: 20px;
  }
  .layer-swatch:hover {
    transform: scale(1.08);
  }
  .layer-swatch.hidden {
    cursor: not-allowed;
    background:
      linear-gradient(45deg, #d4d4d8 25%, transparent 25%),
      linear-gradient(-45deg, #d4d4d8 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #d4d4d8 75%),
      linear-gradient(-45deg, transparent 75%, #d4d4d8 75%),
      #fff;
    background-size: 6px 6px;
    background-position: 0 0, 0 3px, 3px -3px, -3px 0, 0 0;
  }
  .layer-swatch.hidden::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(to top right, transparent 47%, #dc2626 48%, #dc2626 52%, transparent 53%);
  }
  .layer-swatch input[type='color'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  /* ── Gradient controls ─────────────────────────────────────── */
  .grad-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
  }
  .grad-toggle:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .grad-toggle:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .grad-toggle.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent) inset;
  }
  .grad-chip {
    width: 13px;
    height: 13px;
    border-radius: 3px;
    background: linear-gradient(135deg, #ff6a00, #ee0979);
  }
  .grad-editor {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    padding: 0.45rem 0.5rem 0.45rem 1.75rem;
  }
  .grad-stop {
    position: relative;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    border: 1px solid var(--border);
    overflow: hidden;
    cursor: pointer;
    flex-shrink: 0;
  }
  .grad-stop input[type='color'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .grad-angle-range {
    flex: 1 1 60px;
    min-width: 50px;
    accent-color: var(--accent);
  }
  .grad-presets {
    display: flex;
    gap: 0.3rem;
  }
  .grad-preset {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    border: 1px solid var(--border);
    padding: 0;
    cursor: pointer;
  }
  .grad-preset:hover {
    border-color: var(--accent);
    transform: scale(1.08);
  }
  .layer-meta {
    flex: 1;
    font-size: 0.8125rem;
    color: var(--text);
  }
  .path-meta {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--muted);
  }
  .layer-hide {
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .layer-hide.small {
    padding: 0.15rem 0.4rem;
  }
  .layer-hide:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .layer-hide.on {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .layer-children {
    list-style: none;
    margin: 0;
    padding: 0 0 0 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .layer-children li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0.4rem;
    border-radius: 6px;
    transition: background 0.1s;
  }
  .layer-children li.hovered {
    background: var(--accent-bg);
  }
  .layer-children li.removed .path-meta {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .hint {
    margin: 0.25rem 0 0;
    font-size: 0.6875rem;
    color: var(--muted);
    font-style: italic;
  }
  .muted-hint {
    font-size: 0.8125rem;
    color: var(--muted);
    font-style: italic;
  }

  /* ─── Advanced ─── */
  .advanced {
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .advanced summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.875rem;
    cursor: pointer;
    user-select: none;
    list-style: none;
    font-weight: 500;
    font-size: 0.875rem;
  }
  .advanced summary::-webkit-details-marker {
    display: none;
  }
  .advanced summary :global(.chev) {
    transition: transform 0.15s;
  }
  .advanced[open] summary :global(.chev) {
    transform: rotate(180deg);
  }
  .badge {
    margin-left: auto;
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: var(--accent-bg);
    color: var(--accent);
  }
  .sliders {
    padding: 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .modes {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .advanced-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  .save-preset {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }
  .save-preset input {
    padding: 0.3rem 0.5rem;
    font-family: inherit;
    font-size: 0.8125rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    min-width: 0;
    width: 130px;
  }
  .save-preset input:focus {
    outline: none;
    border-color: var(--accent);
  }

  /* ─── Toggles row ─── */
  .toggles-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0 0.25rem;
    flex-wrap: wrap;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text);
    cursor: pointer;
    user-select: none;
  }
  .toggle.small {
    font-size: 0.8125rem;
  }
  .toggle input[type='checkbox'] {
    appearance: none;
    -webkit-appearance: none;
    width: 34px;
    height: 18px;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid var(--border);
    border-radius: 999px;
    position: relative;
    outline: none;
    cursor: pointer;
    transition: background-color 0.2s, border-color 0.2s;
    flex-shrink: 0;
  }
  .toggle input[type='checkbox']::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    background: #ffffff;
    border-radius: 50%;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .toggle input[type='checkbox']:checked {
    background-color: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .toggle input[type='checkbox']:checked::after {
    transform: translateX(16px);
    background: var(--accent-fg);
  }
  .toggle input[type='checkbox']:focus-visible {
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.2);
  }

  /* ─── Buttons ─── */
  button.primary,
  button.ghost {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 1rem;
    border-radius: 8px;
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-fg);
  }
  button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  button.primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  button.ghost {
    background: transparent;
    border-color: var(--border);
    color: var(--text);
  }
  button.ghost:hover:not(:disabled) {
    border-color: var(--accent);
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .tiny-btn {
    padding: 0.25rem 0.55rem !important;
    font-size: 0.75rem !important;
    border-radius: 6px !important;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .tiny-btn:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .tiny-btn.primary-tiny {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .tiny-btn.primary-tiny:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .tiny-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  :global(.muted) {
    color: var(--muted);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ─── Error / Placeholder ─── */
  .error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.875rem;
    border-radius: 8px;
    background: #fef2f2;
    color: #991b1b;
    border: 1px solid #fecaca;
    font-size: 0.875rem;
    margin-bottom: 0.75rem;
  }
  .placeholder {
    border: 1px dashed var(--border);
    border-radius: 10px;
    padding: 4rem 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    color: var(--muted);
    font-size: 0.875rem;
    text-align: center;
  }

  /* ─── Result ─── */
  .result {
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.02);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.625rem 0.875rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    gap: 0.625rem;
    flex-wrap: wrap;
  }
  .result-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .export-select {
    display: inline-flex;
  }
  .export-select select {
    appearance: none;
    -webkit-appearance: none;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .export-select select:hover {
    border-color: var(--accent);
  }
  .export-select select:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
  .size-compare {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8125rem;
    color: var(--muted);
    flex-wrap: wrap;
  }
  .output-size {
    color: var(--text);
    font-weight: 500;
  }
  .arrow,
  .dot {
    color: var(--muted);
  }
  .duration {
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }
  .svg-view-wrap {
    display: flex;
    flex-direction: column;
  }
  .hide-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    font-size: 0.75rem;
    color: var(--muted);
    gap: 0.5rem;
  }
  .hide-count {
    color: var(--text);
    font-weight: 500;
  }
  .hide-hint {
    font-style: italic;
  }
  .hide-actions {
    display: flex;
    gap: 0.375rem;
  }
  .speckle-count {
    display: inline-block;
    margin-left: 0.35rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    font-size: 0.7rem;
    font-weight: 600;
    transition: background 0.15s;
  }
  .speckle-count.active {
    background: #ef4444;
    color: white;
  }
  /* Speckle-preview: paths the slider would remove flash red instead of
     vanishing, so the user can see exactly what they're about to delete. */
  :global(svg path[data-preview-remove='1']) {
    animation: speckle-pulse 0.9s ease-in-out infinite alternate;
  }
  @keyframes speckle-pulse {
    from { opacity: 0.55; }
    to { opacity: 1; }
  }
  .result-preview.clickable :global(path) {
    cursor: pointer;
    transition: opacity 0.1s;
  }
  .result-preview.clickable :global(path:hover),
  .result-preview :global(path[data-hovered='true']) {
    opacity: 0.55;
  }
  .result-preview {
    padding: 1.5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 240px;
    background:
      linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
      linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
      linear-gradient(-45deg, transparent 75%, #f0f0f0 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
  .result-preview.has-bg {
    background: var(--bg-color);
    background-size: auto;
    background-position: 0 0;
    border-radius: var(--bg-radius);
    padding: calc(1.5rem + var(--bg-padding));
  }
  .result-preview.square {
    aspect-ratio: 1 / 1;
    max-height: 560px;
    max-width: 560px;
    margin: 0 auto;
  }
  .result-preview.square :global(svg) {
    max-height: 100%;
    width: 100%;
    height: 100%;
  }
  .result-preview :global(svg) {
    display: block;
    width: 100%;
    height: auto;
    max-width: 100%;
    max-height: 560px;
  }

  /* ─── Editor Toolbar ─── */
  .editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    font-size: 0.75rem;
    gap: 0.75rem;
    flex-wrap: wrap;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .tool-group {
    display: flex;
    gap: 2px;
    background: rgba(255, 255, 255, 0.05);
    padding: 2px;
    border-radius: 6px;
    border: 1px solid var(--border);
  }
  .tool-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.6rem;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .tool-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.05);
  }
  .tool-btn.active {
    background: var(--accent);
    color: var(--accent-fg);
  }

  /* ─── Popover ─── */
  .popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: transparent;
  }
  .popover {
    position: fixed;
    z-index: 1000;
    transform: translate(-50%, -100%);
    width: 240px;
    padding: 0.625rem;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
    animation: popover-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes popover-in {
    from {
      opacity: 0;
      transform: translate(-50%, -90%) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -100%) scale(1);
    }
  }
  .popover-arrow {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%) rotate(45deg);
    width: 12px;
    height: 12px;
    background: inherit;
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    z-index: -1;
  }
  .popover-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.25rem;
  }
  .popover-title {
    font-weight: 600;
    font-size: 0.75rem;
    color: var(--text);
  }
  .popover-close {
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }
  .popover-close:hover {
    color: var(--text);
  }
  .popover-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .popover-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.75rem;
  }
  .popover-row.actions {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
  }
  .popover-label {
    color: var(--muted);
    font-weight: 500;
  }
  .popover-color-hex {
    font-family: var(--font-mono);
    color: var(--text);
  }
  .popover-action-btn {
    flex: 1;
    justify-content: center;
    white-space: nowrap;
    padding: 0.25rem 0.4rem !important;
  }
</style>
