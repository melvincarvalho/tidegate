// Tidegate — a Solid pod StateStore. The trail lives in the OWNER's pod, one
// JSON document per identity, read/written with an authenticated fetch. That's
// durable and portable: clear your browser and it's still there, and apps on
// different origins read the same pod under one WebID — no shared-origin trick,
// no third-party network. It's your store, not the app's server.
//
// `authFetch` is an authenticated fetch (Solid-OIDC/DPoP) — e.g. xlogin's
// window.xlogin.authFetch. `base` is the container URL in the pod where trails
// are kept. Browser-targeted for real use; injectable so Node tests can pass a
// fake authFetch.
export function podStore({ authFetch, base } = {}) {
  if (typeof authFetch !== 'function') throw new Error('tidegate: podStore needs an authFetch');
  if (!base) throw new Error('tidegate: podStore needs a base container URL');
  const container = base.replace(/\/?$/, '/');
  const url = (did) => container + 'tidegate-' + encodeURIComponent(did) + '.json';

  return {
    async load(did) {
      const res = await authFetch(url(did));
      if (res.status === 404) return []; // no trail yet
      if (!res.ok) throw new Error('tidegate: pod load failed (' + res.status + ')');
      const txt = await res.text();
      try { return JSON.parse(txt || '[]'); } catch { return []; }
    },
    async save(did, trail) {
      const res = await authFetch(url(did), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(trail),
      });
      if (!res.ok) throw new Error('tidegate: pod save failed (' + res.status + ')');
    },
  };
}
