const limit = 3500;
let database;

function open() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('obsidian-translations', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('translations', { keyPath: 'key' });
      store.createIndex('savedAt', 'savedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

async function transaction(mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('translations', mode);
    const result = work(tx.objectStore('translations'));
    tx.oncomplete = () => resolve(result());
    tx.onabort = () => reject(tx.error || new Error('无法访问本地缓存。'));
  });
}

export const cache = {
  read(keys) {
    return transaction('readonly', store => {
      const hits = new Map();
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result) hits.set(key, request.result.text);
        };
      }
      return () => hits;
    });
  },
  write(entries, canSave) {
    return transaction('readwrite', store => {
      if (!canSave()) return () => {};
      const savedAt = Date.now();
      for (const [key, text] of entries) store.put({ key, text, savedAt });
      const count = store.count();
      count.onsuccess = () => {
        let excess = count.result - limit;
        if (excess <= 0) return;
        const cursor = store.index('savedAt').openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result || excess-- <= 0) return;
          cursor.result.delete();
          cursor.result.continue();
        };
      };
      return () => {};
    });
  },
  count() {
    return transaction('readonly', store => {
      const request = store.count();
      return () => request.result;
    });
  },
  clear() {
    return transaction('readwrite', store => {
      store.clear();
      return () => {};
    });
  },
};
