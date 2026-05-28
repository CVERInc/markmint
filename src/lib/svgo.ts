// svgo 3.x ships a browser-only bundle at this path. The default entry
// pulls in Node `fs`/`os`/`path`, which we don't want in a browser build.
import { optimize, type Config } from 'svgo/dist/svgo.browser.js';

const DEFAULT_CONFIG: Config = {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,
          collapseGroups: false,
          // Keep explicit fills (even fill="#000000") so the Recolor UI
          // can detect them. Without this SVGO strips fills matching the
          // SVG default, leaving Recolor with nothing to remap.
          removeUselessStrokeAndFill: false,
        },
      },
    },
    'removeDimensions',
    'sortAttrs',
  ],
};

export function optimizeSvg(svg: string): string {
  try {
    const result = optimize(svg, DEFAULT_CONFIG);
    return result.data;
  } catch {
    return svg;
  }
}
