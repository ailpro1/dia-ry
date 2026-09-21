/* IndexedDB wrapper.
   Schema is versioned and additive only — old databases must keep opening for
   as long as the diary is kept, so never drop or repurpose an existing store. */

const DB_NAME = 'diary';
export const DEFAULT_NOTEBOOK = 'nb-diary';
const DB_VERSION = 2;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const tx = req.transaction;
      const from = ev.oldVersion;

      if (from < 1) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('by_date', 'date');
        notes.createIndex('by_updated', 'updatedAt');
        // sortKey = "<date>|<createdAt>" so the timeline has one total order.
        notes.createIndex('by_sort', 'sortKey');
        // Sparse: only pinned notes carry the field, so the index stays tiny.
        notes.createIndex('by_pinned', 'pinned');

        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('by_note', 'noteId');
        entries.createIndex('by_note_at', ['noteId', 'at']);

        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('by_note', 'noteId');
        photos.createIndex('by_entry', 'entryId');

        db.createObjectStore('settings', { keyPath: 'key' });
      }

      if (from < 2) {
        // Notebooks: a note now lives in one.
        const books = db.createObjectStore('notebooks', { keyPath: 'id' });
        books.createIndex('by_order', 'order');

        const notes = tx.objectStore('notes');
        notes.createIndex('by_notebook', 'notebookId');
        notes.createIndex('by_notebook_sort', ['notebookId', 'sortKey']);

        // Everything written before notebooks existed moves into one, so no
        // diary is ever stranded outside a shelf.
        const shelf = {
          id: DEFAULT_NOTEBOOK,
          name: 'diary',
          cover: { design: 'kraft', color: 'sand' },
          order: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        books.put(shelf);

        const cursor = notes.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          const note = c.value;
          if (!note.notebookId) {
            note.notebookId = DEFAULT_NOTEBOOK;
            c.update(note);
          }
          c.continue();
        };
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error('Database is open in another tab. Close it and retry.'));
  });
  return dbPromise;
}

function run(storeNames, mode, fn) {
  return open().then((database) => {
    const tx = database.transaction(storeNames, mode);
    const settled = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
    let work;
    try {
      work = Promise.resolve(fn(tx));
    } catch (err) {
      try { tx.abort(); } catch (_) {}
      return Promise.reject(err);
    }
    // A failure inside fn must roll the whole transaction back.
    work.catch(() => { try { tx.abort(); } catch (_) {} });
    return Promise.all([work, settled]).then(([value]) => value);
  });
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const db = {
  read: (stores, fn) => run(stores, 'readonly', fn),
  write: (stores, fn) => run(stores, 'readwrite', fn),
  req,

  get(store, key) {
    return run(store, 'readonly', (tx) => req(tx.objectStore(store).get(key)));
  },
  put(store, value) {
    return run(store, 'readwrite', (tx) => req(tx.objectStore(store).put(value)));
  },
  del(store, key) {
    return run(store, 'readwrite', (tx) => req(tx.objectStore(store).delete(key)));
  },
  all(store) {
    return run(store, 'readonly', (tx) => req(tx.objectStore(store).getAll()));
  },
  count(store) {
    return run(store, 'readonly', (tx) => req(tx.objectStore(store).count()));
  },
  index(store, name, query) {
    return run(store, 'readonly', (tx) =>
      req(tx.objectStore(store).index(name).getAll(query))
    );
  },
};

/** Ask the browser not to evict this origin. Best-effort; iOS may ignore it. */
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (_) {
    return null;
  }
}

export async function storageEstimate() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    return await navigator.storage.estimate();
  } catch (_) {
    return null;
  }
}
