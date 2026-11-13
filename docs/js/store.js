// Stockage local d'Andréa : tout reste sur l'appareil (localStorage du navigateur).

export class Store {
  constructor(storage = globalThis.localStorage, prefix = "andrea.") {
    this.storage = storage;
    this.prefix = prefix;
  }

  get(key, fallback) {
    try {
      const raw = this.storage.getItem(this.prefix + key);
      return raw === null || raw === undefined ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  /** Renvoie false si l'écriture échoue (stockage plein ou navigation privée). */
  set(key, value) {
    try {
      this.storage.setItem(this.prefix + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  remove(key) {
    try {
      this.storage.removeItem(this.prefix + key);
    } catch {
      /* rien à faire */
    }
  }
}
