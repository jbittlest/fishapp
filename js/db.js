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
  if (!_db) throw new Error('Offline storage is unavailable on this device');
  return _db.transaction(name, mode || 'readonly').objectStore(name);
}

/* Resolve on the request for reads, but on the TRANSACTION for writes.
   request.onsuccess only means "the value entered the transaction's snapshot" —
   QuotaExceededError is usually raised later, at commit, which fires
   transaction.onabort. Resolving early meant a spot could toast "saved 📌",
   draw its marker, and simply not be there on the next launch. */
function _req(request, waitForCommit) {
  return new Promise((resolve, reject) => {
    let value;
    request.onsuccess = () => { value = request.result; if (!waitForCommit) resolve(value); };
    request.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); reject(request.error); };
    if (waitForCommit) {
      const tx = request.transaction;
      if (!tx) { request.onsuccess = () => resolve(request.result); return; }
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error || new Error('write aborted (storage full?)'));
      tx.onerror = () => reject(tx.error || new Error('write failed'));
    }
  });
}

/* Every helper returns a REJECTED promise rather than throwing synchronously, so a
   caller's .catch() actually protects them when IndexedDB is unavailable (private
   browsing, storage disabled) — _store used to throw before any promise existed. */
function _safe(fn) {
  try { return fn(); } catch (e) { return Promise.reject(e); }
}
const idb = {
  get: (store, key) => _safe(() => _req(_store(store).get(key))),
  getAll: (store) => _safe(() => _req(_store(store).getAll())),
  put: (store, value, key) => _safe(() => _req(_store(store, 'readwrite').put(value, key), true)),
  del: (store, key) => _safe(() => _req(_store(store, 'readwrite').delete(key), true)),
  count: (store) => _safe(() => _req(_store(store).count())),
};

/* Tiles: keyed "layerId/z/x/y" -> Blob */
function tileKey(layerId, z, x, y) { return layerId + '/' + z + '/' + x + '/' + y; }
function getTileBlob(key) { return idb.get('tiles', key).catch(() => null); }
/* Let failures propagate. Swallowing them meant a download that hit the quota kept
   reporting success for every remaining tile, finished at 100%, and saved an area
   record for tiles that were never written — a blank chart 30 miles offshore. */
function putTileBlob(key, blob) {
  return idb.put('tiles', blob, key).then(
    () => { TileKeys.add(key); },
    (e) => { TileKeys.delete(key); throw e; }
  );
}

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
    let store;
    try { store = _store('tiles', 'readwrite'); } catch (e) { return resolve(); }
    const tx = store.transaction;
    /* Settle on the TRANSACTION, and always settle. This promise is awaited during
       boot; with only a cursor callback to resolve it, a torn-down transaction (iOS
       backgrounding the app mid-migration) left it pending forever and the splash
       screen never went away — on every launch, since the done-flag came after. */
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => resolve();
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const req = store.openKeyCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { TileKeys.delete(cur.key); store.delete(cur.key); cur.continue(); }
    };
    req.onerror = () => { /* tx handlers above will settle us */ };
  });
}

/* Bulk-delete tiles by exact key list (used when removing a downloaded area).
   Chunked: 30,000 synchronous delete() calls in one transaction is a long main-thread
   stall, and resolving on the last request rather than the commit meant the area
   record could be removed while its tiles survived — unreachable and unremovable. */
async function deleteTiles(keys, onProgress) {
  const CHUNK = 2000;
  let done = 0;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    await new Promise((resolve, reject) => {
      let store;
      try { store = _store('tiles', 'readwrite'); } catch (e) { return reject(e); }
      const tx = store.transaction;
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('tile delete aborted'));
      slice.forEach((k) => { TileKeys.delete(k); try { store.delete(k); } catch (e) {} });
    });
    done += slice.length;
    if (onProgress) onProgress(Math.min(done, keys.length), keys.length);
  }
}
