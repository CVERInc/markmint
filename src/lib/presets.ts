import type { TracerConfig } from 'wasm_vtracer';

export type PresetId = 'logo' | 'sketch' | 'photo' | 'pixel-art';

/**
 * Full VTracer parameter set. We expose these directly so users can
 * fine-tune past the preset defaults.
 *
 * Numeric ranges come from the VTracer documentation:
 *   - filterSpeckle:    0+ (we clamp the slider to 0–16)
 *   - colorPrecision:   1–8
 *   - layerDifference:  0–255 (we clamp to 0–64; >64 rarely useful)
 *   - cornerThreshold:  0–180 (degrees)
 *   - lengthThreshold:  3.5–10.0
 *   - maxIterations:    1+ (kept fixed at preset value, niche knob)
 *   - spliceThreshold:  0–180 (degrees)
 *   - pathPrecision:    0–8 (decimal places)
 */
export interface TracerParams {
  colorMode: 0 | 1; // 0 = Color, 1 = Binary
  hierarchical: 0 | 1; // 0 = Stacked, 1 = Cutout
  pathSimplifyMode: 0 | 1 | 2; // 0 = Polygon, 1 = Spline, 2 = None
  filterSpeckle: number;
  colorPrecision: number;
  layerDifference: number;
  cornerThreshold: number;
  lengthThreshold: number;
  maxIterations: number;
  spliceThreshold: number;
  pathPrecision: number;
}

export interface PresetMeta {
  id: PresetId;
  label: string;
  description: string;
}

export const PRESETS: PresetMeta[] = [
  {
    id: 'logo',
    label: 'Logo',
    description: 'Flat colors, crisp edges — for icons, logos, flat illustrations.',
  },
  {
    id: 'sketch',
    label: 'Sketch',
    description: 'Black & white only, high contrast — for hand-drawn lines, comics.',
  },
  {
    id: 'photo',
    label: 'Photo',
    description: 'Many colors, smooth curves — for photographs and complex art.',
  },
  {
    id: 'pixel-art',
    label: 'Pixel',
    description: 'No smoothing, preserves sharp pixel edges — for 8/16-bit sprites.',
  },
];

export const PRESET_PARAMS: Record<PresetId, TracerParams> = {
  logo: {
    colorMode: 0,
    hierarchical: 0, // Stacked — more reliable layer separation for flat-color art
    pathSimplifyMode: 1,
    filterSpeckle: 4,
    // Logos are flat — fewer color buckets + bigger layer delta merges
    // anti-aliased edges (e.g. #040404 / #060606 / #080808 → one black layer).
    colorPrecision: 4,
    layerDifference: 32,
    cornerThreshold: 60,
    lengthThreshold: 4.0,
    maxIterations: 10,
    spliceThreshold: 45,
    pathPrecision: 2,
  },
  sketch: {
    colorMode: 1, // Binary
    hierarchical: 0,
    pathSimplifyMode: 1,
    filterSpeckle: 4,
    colorPrecision: 6,
    layerDifference: 16,
    cornerThreshold: 60,
    lengthThreshold: 4.0,
    maxIterations: 10,
    spliceThreshold: 45,
    pathPrecision: 2,
  },
  photo: {
    colorMode: 0,
    hierarchical: 0,
    pathSimplifyMode: 1,
    filterSpeckle: 10,
    colorPrecision: 8,
    layerDifference: 16,
    cornerThreshold: 180,
    lengthThreshold: 4.0,
    maxIterations: 10,
    spliceThreshold: 45,
    pathPrecision: 2,
  },
  'pixel-art': {
    colorMode: 0,
    hierarchical: 1,
    pathSimplifyMode: 0, // Polygon — no curves
    filterSpeckle: 0,
    colorPrecision: 8,
    layerDifference: 0,
    cornerThreshold: 0,
    lengthThreshold: 3.5,
    maxIterations: 1,
    spliceThreshold: 0,
    pathPrecision: 0,
  },
};

/**
 * Apply a full param set to a TracerConfig. Mutates in place.
 */
export function applyParams(config: TracerConfig, p: TracerParams): void {
  config.setColorMode(p.colorMode);
  config.setHierarchical(p.hierarchical);
  config.setPathSimplifyMode(p.pathSimplifyMode);
  config.setFilterSpeckle(p.filterSpeckle);
  config.setColorPrecision(p.colorPrecision);
  config.setLayerDifference(p.layerDifference);
  config.setCornerThreshold(p.cornerThreshold);
  config.setLengthThreshold(p.lengthThreshold);
  config.setMaxIterations(p.maxIterations);
  config.setSpliceThreshold(p.spliceThreshold);
  config.setPathPrecision(p.pathPrecision);
}

export function clonePreset(id: PresetId): TracerParams {
  return { ...PRESET_PARAMS[id] };
}

export function paramsEqual(a: TracerParams, b: TracerParams): boolean {
  return (
    a.colorMode === b.colorMode &&
    a.hierarchical === b.hierarchical &&
    a.pathSimplifyMode === b.pathSimplifyMode &&
    a.filterSpeckle === b.filterSpeckle &&
    a.colorPrecision === b.colorPrecision &&
    a.layerDifference === b.layerDifference &&
    a.cornerThreshold === b.cornerThreshold &&
    a.lengthThreshold === b.lengthThreshold &&
    a.maxIterations === b.maxIterations &&
    a.spliceThreshold === b.spliceThreshold &&
    a.pathPrecision === b.pathPrecision
  );
}
