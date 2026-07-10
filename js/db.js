/* IndexedDB storage: chart tiles, spots, tracks, downloaded areas */
'use strict';

const DB_NAME = 'fishapp';
const DB_VER = 3;
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles');
      if (!db.objectStoreNames.contains('spots')) db.createObjectStore('spots', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('areas')) db.createObjectStore('areas', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('catches')) db.createObjectStore('catches', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function _store(name, mode) {
  return _db.transaction(name, mode || 'readonly').objectStore(name);
}

function _req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* Generic helpers */
const idb = {
  get: (store, key) => _req(_store(store).get(key)),
  getAll: (store) => _req(_store(store).getAll()),
  put: (store, value, key) => _req(_store(store, 'readwrite').put(value, key)),
  del: (store, key) => _req(_store(store, 'readwrite').delete(key)),
  count: (store) => _req(_store(store).count()),
};

/* Tiles: keyed "layerId/z/x/y" -> Blob */
function tileKey(layerId, z, x, y) { return layerId + '/' + z + '/' + x + '/' + y; }
function getTileBlob(key) { return idb.get('tiles', key).catch(() => null); }
function putTileBlob(key, blob) { TileKeys.add(key); return idb.put('tiles', blob, key).catch(() => {}); }

/* In-memory index of which tile keys are stored offline. Lets the tile layer skip a
   per-tile IndexedDB read for the common case (browsing a not-downloaded area online):
   if a key isn't in this set, go straight to the network instead of doing an IDB miss. */
const TileKeys = new Set();
let tileKeysReady = false;
async function loadTileKeys() {
  try {
    const keys = await _req(_store('tiles').getAllKeys());
    keys.forEach((k) => TileKeys.add(k));
  } catch (e) { /* fall back to per-tile IDB reads */ }
  tileKeysReady = true;
}

/* Delete every cached tile whose key starts with a layer prefix, e.g. "gmrt/".
   Used to flush a layer's tiles when its data source changes. */
function deleteTilesByPrefix(prefix) {
  return new Promise((resolve) => {
    const store = _store('tiles', 'readwrite');
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const req = store.openKeyCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { TileKeys.delete(cur.key); store.delete(cur.key); cur.continue(); } else { resolve(); }
    };
    req.onerror = () => resolve();
  });
}

/* Bulk-delete tiles by exact key list (used when removing a downloaded area) */
function deleteTiles(keys, onProgress) {
  return new Promise((resolve) => {
    const store = _store('tiles', 'readwrite');
    let done = 0;
    if (!keys.length) return resolve();
    keys.forEach((k) => {
      TileKeys.delete(k);
      const r = store.delete(k);
      r.onsuccess = r.onerror = () => {
        done++;
        if (onProgress && done % 500 === 0) onProgress(done, keys.length);
        if (done === keys.length) resolve();
      };
    });
  });
}
