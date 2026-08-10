// Tidegate — the stub signer, plus a convenience in-memory backend. No chain,
// no real crypto: for dev, tests, and the browser demo. Isomorphic.

import { trailBackend } from './tidegate.js';
import { memStore } from './store.js';

// An in-memory backend = the StateStore seam with a memStore and no committer.
// Kept as a one-liner for the demo and tests; new code composes
// trailBackend({ store, committer }) directly (see store.js / pod.js).
export function localBackend() {
  return trailBackend({ store: memStore() });
}

// A stub signer that exercises the interface without real crypto. The browser
// wires noskey here; a Node test can wire a privkey signer; 2b swaps in real
// secp256k1 signing over the SHA-256 of the transition bytes.
export function localSigner(pubkey = 'local') {
  return {
    pubkey,
    async sign(bytes) {
      return 'localsig:' + fnv1a(bytes);
    },
  };
}

// A tiny non-cryptographic hash — enough to give the stub signature something
// deterministic to stand on. NOT security; the real signer uses secp256k1.
function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
