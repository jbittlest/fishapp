/* Chart layer definitions + offline-first tile layer */
'use strict';

const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/* Web-mercator bbox for a tile (EPSG:3857), used by the NOAA ArcGIS export endpoint */
function tileBBox3857(z, x, y) {
  const ORIGIN = 20037508.342789244;
  const size = (2 * ORIGIN) / Math.pow(2, z);
  const xmin = -ORIGIN + x * size;
  const xmax = -ORIGIN + (x + 1) * size;
  const ymax = ORIGIN - y * size;
  const ymin = ORIGIN - (y + 1) * size;
  return xmin + ',' + ymin + ',' + xmax + ',' + ymax;
}

/* All available layers. urlFor(z,x,y) builds the network URL for one tile. */
const LAYERS = {
  ocean: {
    id: 'ocean', name: 'Ocean base', kind: 'base', maxNativeZoom: 13,
    attribution: 'Esri, GEBCO, NOAA',
    urlFor: (z, x, y) => `https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/${z}/${y}/${x}`,
  },
  sat: {
    id: 'sat', name: 'Satellite', kind: 'base', maxNativeZoom: 19,
    attribution: 'Esri, Maxar',
    urlFor: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  },
  street: {
    id: 'street', name: 'Street', kind: 'base', maxNativeZoom: 19,
    attribution: '© OpenStreetMap contributors',
    urlFor: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
  gmrt: {
    /* Seafloor relief BASE — GEBCO pre-cached tiles (~0.4s each). Cache tops out at z10;
       beyond that it upscales (soft) but shows INSTANTLY, so the map is never blank. The
       'reliefhi' overlay sharpens it when you zoom in. */
    id: 'gmrt', name: 'Seafloor relief', kind: 'base', maxNativeZoom: 10,
    attribution: 'GEBCO',
    urlFor: (z, x, y) =>
      'https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services/GEBCO_basemap_NCEI/MapServer/tile/' +
      z + '/' + y + '/' + x,
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
    id: 'reliefhi', name: 'Seafloor relief detail', kind: 'overlay', minZoom: 11, maxNativeZoom: 12, tilePx: 512,
    attribution: 'GMRT',
    urlFor: (z, x, y, px) =>
      'https://www.gmrt.org/services/mapserver/wms_merc?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=GMRT&STYLES=&SRS=EPSG:3857' +
      '&BBOX=' + tileBBox3857(z, x, y) + '&WIDTH=' + px + '&HEIGHT=' + px + '&FORMAT=image/png',
  },
  ncei: {
    /* NOAA coastal DEM hillshade — up to ~1-3 m resolution near US coasts.
       Transparent where there is no survey, so GMRT shows through underneath.
       On-demand renderer: render fresh to high zoom + 2x px for retina crispness. */
    id: 'ncei', name: 'Hi-res coastal relief', kind: 'overlay', minZoom: 11, maxNativeZoom: 19, tilePx: 512,
    attribution: 'NOAA NCEI',
    urlFor: (z, x, y, px) =>
      'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/exportImage' +
      '?bbox=' + tileBBox3857(z, x, y) +
      '&bboxSR=3857&imageSR=3857&size=' + px + ',' + px + '&format=png' +
      '&renderingRule=%7B%22rasterFunction%22%3A%22ColorHillshade%22%7D&f=image',
  },
  labels: {
    id: 'labels', name: 'Place labels', kind: 'overlay', maxNativeZoom: 18,
    attribution: '© CARTO, © OpenStreetMap',
    urlFor: (z, x, y) => `https://basemaps.cartocdn.com/light_only_labels/${z}/${x}/${y}.png`,
  },
  enc: {
    /* Vector nautical chart — depth contours + soundings stay crisp at any zoom.
       On-demand renderer: render fresh to high zoom + 2x px for retina. */
    id: 'enc', name: 'NOAA charts', kind: 'overlay', maxNativeZoom: 18, minZoom: 6, tilePx: 512,
    attribution: 'NOAA ENC',
    urlFor: (z, x, y, px) =>
      'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/MapServer/export' +
      '?bbox=' + tileBBox3857(z, x, y) +
      '&bboxSR=3857&imageSR=3857&size=' + px + ',' + px + '&format=png32&transparent=true&f=image',
  },
  seamark: {
    id: 'seamark', name: 'Seamarks', kind: 'overlay', maxNativeZoom: 18, minZoom: 9,
    attribution: '© OpenSeaMap',
    urlFor: (z, x, y) => `https://tiles.openseamap.org/seamark/${z}/${x}/${y}.png`,
  },
};

/*
 * Offline-first tile layer:
 *  1. look in IndexedDB
 *  2. else fetch from network and cache it (so every area you browse becomes offline-usable)
 *  3. else show an empty tile
 * maxNativeZoom lets Leaflet upscale downloaded tiles when zooming past the stored detail.
 */
const OfflineTileLayer = L.TileLayer.extend({
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
            if (b && b.type.indexOf('image') === 0 && b.size > 0) {
              putTileBlob(key, b);
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
    if (tileKeysReady && !TileKeys.has(key)) { fromNetwork(); return img; }

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

function makeLayer(layerId) {
  const def = LAYERS[layerId];
  return new OfflineTileLayer('', {
    layerDef: def,
    maxNativeZoom: def.maxNativeZoom,
    maxZoom: 20,
    minZoom: def.minZoom || 0,
    attribution: def.attribution,
    updateWhenIdle: false,      // start loading tiles DURING pan, not only after it stops
    updateWhenZooming: false,   // don't churn tiles mid zoom-animation
    keepBuffer: 2,              // small ring around the view — fewer tiles to load = the visible area fills faster
  });
}
