// Tidegate — the local-ledger backend + a stub signer. No chain, no relays, no
// real crypto: an in-memory trail per identity, for dev and tests. It defines
// the interface the real BlockTrails/nostr/testnet4 backend (2b) implements, so
// swapping to the chain never touches the four-function API or its tests.
//
// Isomorphic: pure ESM, no environment globals.

// An in-memory sealed-balance ledger keyed by identity. Each identity has a
// linear trail of signed transitions; the balance is the tip's `next`.
export function localBackend() {
  const balances = new Map();  // did -> integer balance
  const trails = new Map();    // did -> [transition]
  const subs = new Map();      // did -> Set<cb>

  return {
    async balance(did) {
      return balances.get(did) || 0;
    },
    // Append a signed transition and advance the tip. The real backend does the
    // same after the P2TR spend that anchors this transition confirms (or, with
    // confirmations: 0, is broadcast). Returns the new balance.
    async append(did, t) {
      balances.set(did, t.next);
      const trail = trails.get(did) || [];
      trail.push(t);
      trails.set(did, trail);
      const cbs = subs.get(did);
      if (cbs) for (const cb of cbs) cb(t.next);
      return t.next;
    },
    subscribe(did, cb) {
      const set = subs.get(did) || new Set();
      set.add(cb);
      subs.set(did, set);
      return () => set.delete(cb);
    },
    // Inspection, for tests: the full signed trail for an identity.
    trail(did) {
      return (trails.get(did) || []).slice();
    },
  };
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
