'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map as MlMap, Popup } from 'maplibre-gl';
import type { CheckIn } from '@ariforce/contracts';
import { kindLabel, timeIST } from './format';

/**
 * Check-in points only (no tracks). Vector tiles: OpenFreeMap "positron" (OpenStreetMap data,
 * OpenMapTiles schema; free incl. commercial, no key; attribution is shown by MapLibre automatically).
 */
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

/** Adapted from parked #9 WIP. MapLibre cannot parse oklch()/color-mix(); resolve a CSS token through the cascade, then to rgb via canvas. */
function tokenRgb(name: string, fallback: string) {
  try {
    const probe = document.createElement('span');
    probe.style.color = `var(${name}, ${fallback})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    c.fillStyle = fallback;
    c.fillStyle = resolved;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return fallback;
  }
}

function toGeoJSON(points: CheckIn[], placeOf: (c: CheckIn) => string): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [p.location.lng, p.location.lat] },
      properties: {
        id: p.id,
        outside: p.inFence === false,
        punch: p.kind === 'punch_in' || p.kind === 'punch_out',
        title: placeOf(p),
        sub: `${kindLabel(p.kind)} · ${timeIST(p.capturedAt)}${p.distanceM !== null ? ` · ${Math.round(p.distanceM)} m from tagged location` : ''}`,
      },
    })),
  };
}

type Props = {
  points: CheckIn[];
  placeOf: (c: CheckIn) => string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  label: string;
};

export function CheckInMap({
  points,
  placeOf,
  selectedId,
  onSelect,
  className = '',
  label,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const popup = useRef<Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const placeRef = useRef(placeOf);
  placeRef.current = placeOf;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let disposed = false;
    (async () => {
      const ml = await import('maplibre-gl');
      ml.setWorkerUrl('/vendor/maplibre-gl-worker.mjs');
      if (disposed || !el.current) return;
      const m = new ml.Map({
        container: el.current,
        style: MAP_STYLE,
        center: [88.3639, 22.5726],
        zoom: 10.5,
        attributionControl: { compact: true },
        cooperativeGestures: window.matchMedia('(pointer: coarse)').matches,
        fadeDuration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200,
      });
      m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.current = m;
      popup.current = new ml.Popup({ closeButton: false, offset: 10, maxWidth: '260px' });
      m.on('error', (e) => {
        if (!m.isStyleLoaded() && /style|fetch/i.test(String(e.error?.message))) setFailed(true);
      });
      m.on('load', () => {
        const primary = tokenRgb('--primary', '#0b1f4d');
        const accent = tokenRgb('--accent-600', '#008ba1');
        const warn = tokenRgb('--warning', '#d08a1f');
        m.addSource('pts', {
          type: 'geojson',
          data: toGeoJSON(pointsRef.current, placeRef.current),
        });
        m.addLayer({
          id: 'pts',
          type: 'circle',
          source: 'pts',
          paint: {
            'circle-radius': [
              'case',
              ['boolean', ['feature-state', 'sel'], false],
              8,
              ['get', 'punch'],
              5,
              6,
            ],
            'circle-color': ['case', ['get', 'outside'], warn, ['get', 'punch'], primary, accent],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': ['case', ['boolean', ['feature-state', 'sel'], false], 3, 1.5],
          },
        });
        const show = (id: string, at: [number, number]) => {
          const f = toGeoJSON(pointsRef.current, placeRef.current).features.find(
            (x: FeatureCollection['features'][number]) => x.properties?.id === id,
          );
          if (!f) return;
          const node = document.createElement('div');
          node.className = 'text-[13px] leading-snug';
          const t = document.createElement('p');
          t.className = 'font-medium';
          t.textContent = String(f.properties?.title);
          const s = document.createElement('p');
          s.className = 'text-muted-foreground';
          s.textContent = String(f.properties?.sub);
          node.append(t, s);
          popup.current!.setLngLat(at).setDOMContent(node).addTo(m);
        };
        m.on('click', 'pts', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const id = String(f.properties?.id);
          show(id, (f.geometry as Point).coordinates as [number, number]);
          onSelectRef.current?.(id);
        });
        m.on('mouseenter', 'pts', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'pts', () => (m.getCanvas().style.cursor = ''));
        (m as unknown as { __afShow: typeof show }).__afShow = show;
        setReady(true);
      });
    })().catch(() => setFailed(true));
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Data changes: replace source data and fit to the points.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource('pts') as GeoJSONSource | undefined)?.setData(toGeoJSON(points, placeRef.current));
    popup.current?.remove();
    if (points.length) {
      const lngs = points.map((p) => p.location.lng);
      const lats = points.map((p) => p.location.lat);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      m.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 48, maxZoom: 15, duration: reduced ? 0 : 400 },
      );
    }
  }, [points, ready]);

  // Selection from the table highlights the pin.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.removeFeatureState({ source: 'pts' });
    if (!selectedId) return;
    const p = points.find((x) => x.id === selectedId);
    if (!p) return;
    m.setFeatureState({ source: 'pts', id: selectedId }, { sel: true });
    (m as unknown as { __afShow?: (id: string, at: [number, number]) => void }).__afShow?.(
      selectedId,
      [p.location.lng, p.location.lat],
    );
  }, [selectedId, points, ready]);

  return (
    <div className={`relative overflow-hidden rounded-lg border bg-muted ${className}`}>
      <div
        ref={el}
        className="size-full"
        role="region"
        aria-label={label}
        data-testid="check-in-map"
        data-ready={ready}
      />
      {failed && (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
          Map tiles couldn&apos;t load. The table below has every check-in.
        </p>
      )}
    </div>
  );
}

export function MapLegend() {
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="Map legend"
    >
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-2.5 rounded-full bg-[var(--accent-600)] ring-1 ring-white"
        />{' '}
        Visit inside fence
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full bg-warning ring-1 ring-white" /> Outside
        fence
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-primary ring-1 ring-white" /> Punch in /
        out
      </li>
    </ul>
  );
}
