import L from 'leaflet';
import { TileKeys, getTileBlob, putTileBlob, tileKey, tileKeysReady } from './db.js';

/* Chart layer definitions + offline-first tile layer */
'use strict';

export const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/* Web-mercator bbox for a tile (EPSG:3857), used by the NOAA ArcGIS export endpoint */
export function tileBBox3857(z, x, y) {
  const ORIGIN = 20037508.342789244;
  const size = (2 * ORIGIN) / Math.pow(2, z);
  const xmin = -ORIGIN + x * size;
  const xmax = -ORIGIN + (x + 1) * size;
  const ymax = ORIGIN - y * size;
  const ymin = ORIGIN - (y + 1) * size;
  return xmin + ',' + ymin + ',' + xmax + ',' + ymax;
}

/* Credit links open outside the app: target=_blank goes to the browser on the web and to Safari
   from the iOS shell (NativeBridge), and never navigates the chart itself away. */
const link = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';

/* All available layers. urlFor(z,x,y) builds the network URL for one tile.

   `offline` says whether the source's terms let us keep its tiles on the device — in an area
   download or in the browse cache. An offline:false layer still shows live (the browser's own
   HTTP cache, which honours the server's headers, is all it gets), is never written to or read
   from IndexedDB, is left out of downloads, and has any copy an older build stored swept at
   launch (download.js sweepUnkeepableTiles); `offlineNote` is the download panel's reason line.
   The policies are quoted in docs/launch/data-sources.md. */
export const LAYERS = {
  ocean: {
    id: 'ocean', name: 'Ocean base', kind: 'base', maxNativeZoom: 13,
    // Esri terms: no tile harvesting except Esri Content Packages, and an ArcGIS subscription outside Esri software
    offline: false,
    offlineNote: "Ocean base isn't saved — Esri doesn't allow offline copies",
    attribution: 'Esri, GEBCO, NOAA, Garmin, and other contributors',
    urlFor: (z, x, y) => `https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/${z}/${y}/${x}`,
  },
  sat: {
    id: 'sat', name: 'Satellite', kind: 'base', maxNativeZoom: 19,
    // same Esri terms; the World Imagery item also says it is not for exporting tiles for offline use
    offline: false,
    offlineNote: "Satellite isn't saved — Esri doesn't allow offline copies",
    attribution: 'Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    urlFor: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  },
  street: {
    id: 'street', name: 'Street map', kind: 'base', maxNativeZoom: 19,
    // OSMF tile usage policy: "Offline use is not permitted" on tile.openstreetmap.org
    offline: false,
    offlineNote: "Street map isn't saved — OpenStreetMap doesn't allow offline copies",
    attribution: '© ' + link('https://www.openstreetmap.org/copyright', 'OpenStreetMap') + ' contributors',
    urlFor: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
  gmrt: {
    /* Seafloor relief BASE — GEBCO pre-cached tiles (~0.4s each). Cache tops out at z10;
       beyond that it upscales (soft) but shows INSTANTLY, so the map is never blank. The
       'reliefhi' overlay sharpens it when you zoom in. */
    id: 'gmrt', name: 'Seafloor relief (GEBCO)', kind: 'base', maxNativeZoom: 10,
    // the GEBCO grid is public domain; this item is owned by NOAA NCEI and sets no export restriction
    offline: true,
    attribution: 'GEBCO, NOAA NCEI',
    urlFor: (z, x, y) =>
      'https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services/GEBCO_basemap_NCEI/MapServer/tile/' +
      z + '/' + y + '/' + x,
  },
  bluetint: {
    /* NOAA BlueTopo / National Bathymetric Source — the real US survey grid, sharp to z17
       where GEBCO gives up at z10. Public domain, no key, CORS open.

       CRITICAL: this WMTS gridset is 512px with ONE tile at level 0, so the matrix level is
       (leaflet zoom - 1). Sending {z} is not merely offset — the server returns HTTP 400.

       The raw pixels are a green→yellow landcover-looking ramp at alpha 0.8. It is recoloured
       in the browser by the #lut-day / #lut-night SVG filter (see updateChartFilter in app.js);
       the 0.8 alpha is a feature, letting GEBCO underneath fill the coverage gaps and blend at
       the edges rather than ending at a hard rectangle. */
    id: 'bluetint', name: 'Seafloor relief (US)', kind: 'base',
    tileSize: 512, maxNativeZoom: 17, minBytes: 3000,
    offline: true,   // US Government work; the WMTS capabilities list Fees NONE, AccessConstraints NONE
    attribution: 'NOAA BlueTopo / National Bathymetric Source',
    urlFor: (z, x, y) =>
      'https://nowcoast.noaa.gov/geoserver/gwc/service/wmts/rest/bluetopo:bathymetry/' +
      'nbs_elevation/EPSG:3857/EPSG:3857:' + (z - 1) + '/' + y + '/' + x + '?format=image/png8',
  },
  blueshade: {
    /* The matching hillshade. True grayscale but very flat — measured p5..p95 of only
       0.68..0.74 over bay bottom — which is why a plain multiply just washes the chart grey
       instead of showing relief. It is recentred and amplified before an `overlay` blend so it
       carves the slopes and leaves flat bottom alone. */
    id: 'blueshade', name: 'Seafloor relief detail (US)', kind: 'overlay',
    tileSize: 512, minZoom: 11, maxNativeZoom: 14, minBytes: 3000,
    offline: true,   // same NOAA service as bluetint
    attribution: 'NOAA BlueTopo / National Bathymetric Source',   // identical text, so the credit shows once
    urlFor: (z, x, y) =>
      'https://nowcoast.noaa.gov/geoserver/gwc/service/wmts/rest/bluetopo:hillshade/' +
      'nbs_hillshade/EPSG:3857/EPSG:3857:' + (z - 1) + '/' + y + '/' + x + '?format=image/png8',
  },
  reliefhi: {
    /* Seafloor relief DETAIL — GMRT on-demand hillshade, sharp to z14. Opaque, so it
       replaces the soft GEBCO base wherever it loads. Only fetched at z>=11 (zoomed in),
       and it loads progressively ON TOP of the instant GEBCO base — so zooming in shows
       relief immediately, then sharpens over a couple seconds, then caches sharp. */
    /* maxNativeZoom capped at 12: GMRT's real data is only ~20-100 m resolution, so a z12
       512px tile (~19 m/px) already captures all of it. Capping here means zooming past z12
       REUSES the already-loaded tiles (upscaled) instead of re-fetching sharper ones that hold
       no new detail — so zoom-in is instant instead of re-rendering every level. */
    /* 512px map tiles (tileSize) rendered at 1024px (tilePx, 2x retina) = one request
       covers 4× the ground → ~4× fewer of these slow tiles per view. A 512 tile at
       (z,x,y) spans the same area as a standard 256 tile at (z-1,x,y), so bbox uses z-1. */
    id: 'reliefhi', name: 'Seafloor relief detail', kind: 'overlay', minZoom: 11, maxNativeZoom: 12, tileSize: 512, tilePx: 1024,
    offline: true,   // GMRT is CC BY 4.0: keeping copies is fine with the credit, which asks for a link and the citation
    attribution: link('https://www.gmrt.org/', 'GMRT') + ' (Ryan et al., 2009)',
    urlFor: (z, x, y, px) =>
      'https://www.gmrt.org/services/mapserver/wms_merc?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=GMRT&STYLES=&SRS=EPSG:3857' +
      '&BBOX=' + tileBBox3857(z - 1, x, y) + '&WIDTH=' + px + '&HEIGHT=' + px + '&FORMAT=image/png',
  },
  ncei: {
    /* NOAA coastal DEM hillshade — up to ~1-3 m resolution near US coasts.
       Transparent where there is no survey, so GMRT shows through underneath.
       On-demand renderer: render fresh to high zoom + 2x px for retina crispness. */
    id: 'ncei', name: 'Hi-res coastal relief', kind: 'overlay', minZoom: 11, maxNativeZoom: 19, tileSize: 512, tilePx: 1024,
    offline: true,   // US Government work
    attribution: 'NOAA NCEI',
    urlFor: (z, x, y, px) =>
      'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/exportImage' +
      '?bbox=' + tileBBox3857(z - 1, x, y) +
      '&bboxSR=3857&imageSR=3857&size=' + px + ',' + px + '&format=png' +
      '&renderingRule=%7B%22rasterFunction%22%3A%22ColorHillshade%22%7D&f=image',
  },
  labels: {
    /* RETIRED: CARTO now answers keyless requests with an "API KEY REQUIRED" watermark tile, and
       its basemap terms bar display on a moving vehicle (14.a(2)) and device caching past 30 days
       (9.c(2)), so a key would not make it usable on a boat either. It is never put on the map;
       the entry stays so the launch sweep (download.js) still removes its stored tiles and
       corrects the areas saved before then. */
    id: 'labels', name: 'Place labels', kind: 'overlay', maxNativeZoom: 18, retired: true,
    offline: false,
    attribution: '© CARTO, © OpenStreetMap',
    urlFor: (z, x, y) => `https://basemaps.cartocdn.com/light_only_labels/${z}/${x}/${y}.png`,
  },
  enc: {
    /* Vector nautical chart — depth contours + soundings stay crisp at any zoom.
       On-demand renderer: render fresh to high zoom + 2x px for retina. */
    id: 'enc', name: 'NOAA charts', kind: 'overlay', maxNativeZoom: 18, minZoom: 6, tileSize: 512, tilePx: 1024,
    offline: true,   // public domain (US Government work); NOAA also publishes these charts for offline use
    attribution: 'NOAA Office of Coast Survey',
    urlFor: (z, x, y, px) =>
      'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/MapServer/export' +
      '?bbox=' + tileBBox3857(z - 1, x, y) +
      '&bboxSR=3857&imageSR=3857&size=' + px + ',' + px + '&format=png32&transparent=true&f=image',
  },
  seamark: {
    id: 'seamark', name: 'Seamarks', kind: 'overlay', maxNativeZoom: 18, minZoom: 9,
    // volunteer-run with no published tile-server policy: live only until OpenSeaMap agrees to bulk copies
    offline: false,
    offlineNote: "Seamarks aren't saved — OpenSeaMap hasn't given permission for offline copies",
    attribution: '© ' + link('https://www.openseamap.org/', 'OpenSeaMap') + ' and ' +
      link('https://www.openstreetmap.org/copyright', 'OpenStreetMap') + ' contributors, CC BY-SA',
    urlFor: (z, x, y) => `https://tiles.openseamap.org/seamark/${z}/${x}/${y}.png`,
  },
};

/** The base a download saves in place of one whose terms forbid offline copies, and the layer the
 *  live map draws under such a base so those saved tiles show when the base cannot load: GEBCO is
 *  global, free to keep, and looks most like the Esri ocean base it usually stands in for. */
export const OFFLINE_BASE = 'gmrt';

/** May this layer's tiles be kept on the device (browse cache and area downloads)? */
export function canSaveOffline(id) {
  const def = LAYERS[id];
  return !!(def && def.offline);
}

/*
 * Offline-first tile layer:
 *  1. look in IndexedDB
 *  2. else fetch from network and cache it (so every area you browse becomes offline-usable) —
 *     only for layers whose terms allow it (`offline`); under a base that may not be stored,
 *     the GEBCO layer layers.js draws beneath it is what keeps a browsed area usable
 *  3. else show an empty tile
 * A layer that may not be stored skips step 1 too: a copy an older build (or the /classic/ app on
 * this origin) left in IndexedDB is never shown, and the launch sweep removes it.
 * maxNativeZoom lets Leaflet upscale downloaded tiles when zooming past the stored detail.
 */
export const OfflineTileLayer = L.TileLayer.extend({
  createTile: function (coords, done) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';   // decode off the main thread — smoother tile paint
    img.setAttribute('role', 'presentation');
    L.DomEvent.on(img, 'load', () => {
      if (img._objUrl) URL.revokeObjectURL(img._objUrl);
      done(null, img);
    });
    L.DomEvent.on(img, 'error', () => {
      img.src = EMPTY_TILE;
    });

    const def = this.options.layerDef;
    const key = tileKey(def.id, coords.z, coords.x, coords.y);

    const fromNetwork = () => {
      if (!navigator.onLine) { img.src = EMPTY_TILE; return; }
      const url = def.urlFor(coords.z, coords.x, coords.y, def.tilePx || 256);
      // Retry the slow on-demand render servers once before giving up to a blank tile,
      // so a transient timeout/500 doesn't leave a permanent hole in the map.
      const tryFetch = (attempt) =>
        fetch(url)
          .then((r) => (r.ok ? r.blob() : null))
          .then((b) => {
            /* `size > 0` is not enough for every source. BlueTopo serves TWO different
               fully-transparent blanks outside its survey coverage — 256 bytes and 2266 bytes,
               byte-identical at every zoom — so a naive small-file threshold lets the second
               one through and an area download quietly fills IndexedDB with nothing. Layers
               that have a known blank size declare minBytes. */
            if (b && b.type.indexOf('image') === 0 && b.size > (def.minBytes || 0)) {
              // a full store only costs this tile its offline copy — the chart still draws it
              if (def.offline) putTileBlob(key, b).catch(() => {});
              img._objUrl = URL.createObjectURL(b);
              img.src = img._objUrl;
            } else if (attempt < 1) {
              setTimeout(() => tryFetch(attempt + 1), 700);
            } else {
              img.src = EMPTY_TILE;
            }
          })
          .catch(() => {
            if (attempt < 1) setTimeout(() => tryFetch(attempt + 1), 700);
            else img.src = EMPTY_TILE;
          });
      tryFetch(0);
    };

    // Fast path: once the offline key index is loaded, a key that isn't in it is
    // definitely not stored — skip the IndexedDB read and hit the network straight away.
    // A layer that may not be kept never reads IndexedDB at all (see above).
    if (!def.offline || (tileKeysReady && !TileKeys.has(key))) { fromNetwork(); return img; }

    getTileBlob(key).then((blob) => {
      if (blob instanceof Blob) {
        img._objUrl = URL.createObjectURL(blob);
        img.src = img._objUrl;
        return;
      }
      fromNetwork();
    });
    return img;
  },
});

export function makeLayer(layerId) {
  const def = LAYERS[layerId];
  return new OfflineTileLayer('', {
    layerDef: def,
    tileSize: def.tileSize || 256,   // 512 for the on-demand render layers (enc/relief) — 4× fewer, bigger tiles
    maxNativeZoom: def.maxNativeZoom,
    maxZoom: 20,
    minZoom: def.minZoom || 0,
    attribution: def.attribution,
    updateWhenIdle: false,      // start loading tiles DURING pan, not only after it stops
    updateWhenZooming: false,   // don't churn tiles mid zoom-animation
    keepBuffer: 2,              // small ring around the view — fewer tiles to load = the visible area fills faster
  });
}
