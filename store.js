// Tidegate — StateStores. Where a trail's state (its signed transition list)
// lives. A store is just { load(did) -> trail[], save(did, trail) }; compose it
// into a backend with trailBackend({ store, committer }). Interchangeable, so an
// app (or the owner) picks where the trail lives: memory, this browser, a pod
// (pod.js), a server. The commitment pins order to Bitcoin; the state is the
// owner's to keep, anywhere they control.

// In-memory — isomorphic, ephemeral. For tests and the browser demo.
export function memStore() {
  const m = new Map();
  return {
    async load(did) { return (m.get(did) || []).slice(); },
    async save(did, trail) { m.set(did, trail.slice()); },
  };
}

// localStorage-backed — durable within one browser. `storage` defaults to
// window.localStorage; pass a fake (getItem/setItem/removeItem) to test in Node.
// Caveat: per-browser, per-origin, and lost if cleared — use a pod for
// durability across devices and app origins.
export function localStore({ storage, prefix = 'tidegate-trail:' } = {}) {
  const s = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!s) throw new Error('tidegate: localStore needs a storage (window.localStorage)');
  const key = (did) => prefix + did;
  return {
    async load(did) {
      try { return JSON.parse(s.getItem(key(did)) || '[]'); } catch { return []; }
    },
    async save(did, trail) {
      s.setItem(key(did), JSON.stringify(trail));
    },
  };
}
