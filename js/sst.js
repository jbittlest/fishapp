/* Sea surface temperature overlay (NASA GIBS / GHRSST MUR, ~1 km daily).
   Online-only: date-specific tiles, so they aren't part of offline downloads.
   Use it to SEE temperature breaks; tap anywhere for the exact °F. */
'use strict';

const SST = {
  layer: null,
  date: null,
  on: false,
};

/* Most recent likely-available MUR date. The analysis lags ~1 day, so step back
   until we're confident; default to 2 days ago (UTC) which is reliably published. */
function sstDate(daysBack) {
  const d = new Date(Date.now() - (daysBack != null ? daysBack : 2) * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function sstEnable(on) {
  SST.on = on;
  const legend = document.getElementById('sst-legend');
  if (on) {
    if (!navigator.onLine) { toast('SST overlay needs internet'); }
    if (!SST.layer) {
      SST.date = sstDate(2);
      SST.layer = L.tileLayer(
        'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Surface_Temperature/default/' +
        SST.date + '/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png',
        {
          maxNativeZoom: 7, maxZoom: 20, opacity: 0.72,
          attribution: 'NASA GIBS · GHRSST MUR SST',
          className: 'sst-tiles',
        }
      );
    }
    SST.layer.addTo(window._map);
    SST.layer.setZIndex(4);          // above base/relief, below chart labels
    if (legend) {
      legend.querySelector('#sst-date').textContent = SST.date;
      legend.classList.remove('hidden');
    }
  } else {
    if (SST.layer) window._map.removeLayer(SST.layer);
    if (legend) legend.classList.add('hidden');
  }
}
