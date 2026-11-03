// Turbopack rewrites MapLibre's `new URL('./maplibre-gl-worker.mjs', import.meta.url)`, so the worker 404s.
// Copy the self-contained worker into public/ and point MapLibre at it with setWorkerUrl().
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('maplibre-gl/package.json')) + '/dist';
const out = path.resolve(import.meta.dirname, '../public/vendor');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(
  path.join(dist, 'maplibre-gl-worker.mjs'),
  path.join(out, 'maplibre-gl-worker.mjs'),
);
