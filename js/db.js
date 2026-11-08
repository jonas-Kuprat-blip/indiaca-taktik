// Minimaler IndexedDB-Wrapper
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('indiaca-taktik', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('boards', { keyPath: 'id' });
      d.createObjectStore('templates', { keyPath: 'id' });
      d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(
    (d) =>
      new Promise((res, rej) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req ? req.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      })
  );
}

export const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const put = (store, value, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export const getMeta = (key) => tx('meta', 'readonly', (s) => s.get(key));
export const setMeta = (key, value) => put('meta', value, key);
