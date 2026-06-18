/**
 * GrooveBox DB — IndexedDB wrapper
 * Stores: tracks (with audio blobs + cover art), playlists, favorites, settings
 */

const DB_NAME    = 'GrooveBoxDB';
const DB_VERSION = 2;

let db = null;

const DB = {
  async open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const d = e.target.result;

        if (!d.objectStoreNames.contains('tracks')) {
          const ts = d.createObjectStore('tracks', { keyPath: 'id' });
          ts.createIndex('name',    'name',    { unique: false });
          ts.createIndex('artist',  'artist',  { unique: false });
          ts.createIndex('addedAt', 'addedAt', { unique: false });
        }

        if (!d.objectStoreNames.contains('playlists')) {
          d.createObjectStore('playlists', { keyPath: 'id' });
        }

        if (!d.objectStoreNames.contains('settings')) {
          d.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      req.onsuccess  = (e) => { db = e.target.result; resolve(db); };
      req.onerror    = (e) => reject(e.target.error);
    });
  },

  // ---- TRACKS ----
  async saveTrack(track) {
    return this._write('tracks', track);
  },

  async getAllTracks() {
    return this._readAll('tracks');
  },

  async getTrack(id) {
    return this._read('tracks', id);
  },

  async deleteTrack(id) {
    return this._delete('tracks', id);
  },

  async updateTrack(id, updates) {
    const track = await this.getTrack(id);
    if (!track) return null;
    Object.assign(track, updates);
    return this._write('tracks', track);
  },

  // ---- PLAYLISTS ----
  async savePlaylists(playlists) {
    // Save all playlists atomically
    return new Promise((resolve, reject) => {
      const tx = db.transaction('playlists', 'readwrite');
      const store = tx.objectStore('playlists');
      // Clear old
      store.clear();
      for (const pl of playlists) store.put(pl);
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e.target.error);
    });
  },

  async getAllPlaylists() {
    return this._readAll('playlists');
  },

  // ---- SETTINGS ----
  async setSetting(key, value) {
    return this._write('settings', { key, value });
  },

  async getSetting(key, defaultValue = null) {
    const row = await this._read('settings', key);
    return row ? row.value : defaultValue;
  },

  // ---- GENERICS ----
  _write(store, data) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(data);
      req.onsuccess = () => resolve(data);
      req.onerror   = (e) => reject(e.target.error);
    });
  },

  _read(store, key) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror   = (e) => reject(e.target.error);
    });
  },

  _readAll(store) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror   = (e) => reject(e.target.error);
    });
  },

  _delete(store, key) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror   = (e) => reject(e.target.error);
    });
  },

  // ---- HELPERS ----
  generateId() {
    return `trk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  generatePlaylistId() {
    return `pl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  async blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  },

  async base64ToBlob(base64, mimeType) {
    const res  = await fetch(base64);
    return res.blob();
  },

  // Extract metadata from audio file using browser APIs + jsmediatags-like parsing
  async extractMetadata(file) {
    return new Promise((resolve) => {
      const meta = {
        name:   file.name.replace(/\.[^/.]+$/, ''),
        artist: 'Unknown Artist',
        album:  'Unknown Album',
        cover:  null,
        duration: 0,
      };

      // Try to get duration via audio element
      const url   = URL.createObjectURL(file);
      const audio = new Audio();
      audio.onloadedmetadata = () => {
        meta.duration = audio.duration;
        URL.revokeObjectURL(url);
        // Parse filename for artist — artist - title
        const m = meta.name.match(/^(.+?)\s*[-–—]\s*(.+)$/);
        if (m) {
          meta.artist = m[1].trim();
          meta.name   = m[2].trim();
        }
        resolve(meta);
      };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(meta); };
      audio.src = url;
    });
  }
};
