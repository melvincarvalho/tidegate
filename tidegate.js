// Tidegate — a personal, identity-anchored SEALED balance you can peg in and
// out of. The seal is the asset; peg-in mints into it, peg-out redeems from it.
//
// This library owns ONLY the sealed side of the peg. A consuming app (a game
// vault, a tavern) coordinates its own side and calls in. The balance is keyed
// to a decentralized identity (a did:nostr), so many apps share one trail.
//
// Isomorphic by construction: pure ESM, no environment globals (no window,
// document, localStorage, fs, http). The two environment-specific pieces —
// the `backend` (where state lives + how transitions are anchored) and the
// `signer` (who attests to a transition) — are INJECTED. That one seam buys us
// both swaps at once:
//   • local ledger  ↔  BlockTrails + nostr relays + testnet4   (dev ↔ chain)
//   • Node test signer  ↔  noskey in the browser                (Node ↔ browser)
//
// v0.0.1: the local-ledger backend and a stub signer only — no chain, no real
// crypto. Enough to round-trip peg-in/peg-out and pin the state machine before
// any Bitcoin exists. The real backend (2b) implements the same interface.

const isInt = (n) => Number.isInteger(n) && Number.isFinite(n);

// Coerce a caller-supplied amount to a positive integer of gold, or throw.
function amount(x) {
  const n = Math.trunc(Number(x));
  if (!isInt(n) || n <= 0) throw new Error('tidegate: amount must be a positive integer');
  return n;
}

export function createTidegate({ backend, signer } = {}) {
  if (!backend || typeof backend.balance !== 'function' || typeof backend.append !== 'function') {
    throw new Error('tidegate: a backend with balance()/append() is required');
  }

  // Apply a signed +/- delta to the sealed balance. `delta` is already a
  // signed integer; the sign is what distinguishes peg-in from peg-out.
  async function move(did, delta, sgn) {
    if (!did) throw new Error('tidegate: a did is required');
    const s = sgn || signer;
    if (!s || typeof s.sign !== 'function') throw new Error('tidegate: a signer is required');
    const prev = await backend.balance(did);
    const next = prev + delta;
    if (next < 0) throw new Error('tidegate: insufficient sealed balance');
    const t = { did, prev, delta, next };
    t.sig = await s.sign(transitionBytes(t)); // the signer attests to this transition
    return backend.append(did, t);            // resolves to the new balance
  }

  return {
    // Current sealed balance for an identity (0 if the trail is empty).
    balance: (did) => backend.balance(did),
    // Move gold INTO the seal (vault → sealed). Advances the trail by +amount.
    pegIn: (did, amt, sgn) => move(did, amount(amt), sgn),
    // Move gold OUT of the seal (sealed → vault). Advances the trail by -amount.
    pegOut: (did, amt, sgn) => move(did, -amount(amt), sgn),
    // Watch the balance; cb(newBalance) on each change. Returns an unsubscribe.
    subscribe: (did, cb) => backend.subscribe(did, cb),
  };
}

// A stable byte string for the transition the signer attests to. v0.0.1 encodes
// it plainly; the real backend hashes this with SHA-256 to derive the trail's
// key tweak (tᵢ = SHA256(stateᵢ) mod n). TextEncoder is available in Node and
// the browser, so this stays isomorphic.
export function transitionBytes(t) {
  return new TextEncoder().encode(`tidegate/1|${t.did}|${t.prev}|${t.delta}|${t.next}`);
}
