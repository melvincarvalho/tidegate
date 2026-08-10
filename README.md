# Tidegate

A personal, **identity-anchored sealed balance** you can peg gold in and out of.
The seal *is* the asset — peg-in mints into it, peg-out redeems from it — and
because it's keyed to a decentralized identity (a `did:nostr`), **many apps
share one trail**. A game vault pegs gold in; a tavern spends it; the balance is
the same, because it lives with the identity, not the app.

Isomorphic by design: pure ESM, no environment globals. It runs in a Node test
and in a browser tab from the same source.

## The four-function API

```js
import { createTidegate } from 'tidegate';
import { localBackend, localSigner } from 'tidegate/local';

const tg = createTidegate({
  backend: localBackend(),           // where state lives + how it's anchored
  signer: localSigner('npub…'),      // who attests to each transition
});

await tg.balance(did);               // current sealed balance (0 if empty)
await tg.pegIn(did, 100, signer?);   // vault → sealed  (trail += 100)
await tg.pegOut(did, 40, signer?);   // sealed → vault  (trail -= 40)
tg.subscribe(did, (b) => …);         // live balance; returns unsubscribe
```

`did` is the identity the trail belongs to. Amounts are positive integers of
gold. A per-call `signer` overrides the one passed to `createTidegate`.

## The seams — injected, so one abstraction covers every case

`createTidegate({ backend, signer })` — and the `backend` itself composes from a
**StateStore** and a **Committer**:

```js
import { createTidegate, trailBackend, noCommitter } from 'tidegate';
import { localStore } from 'tidegate/store';   // or podStore, memStore
import { keySigner } from 'tidegate/keys';

const tg = createTidegate({
  backend: trailBackend({ store: localStore(), committer: noCommitter }),
  signer: await keySigner(),
});
```

| Seam | What it decides | Options |
|---|---|---|
| **store** | WHERE the trail's state lives | `memStore` · `localStore` · **`podStore`** · … |
| **committer** | WHERE the commitment goes | `noCommitter` (off-chain trail) · testnet4 (later) |
| **signer** | WHO attests to each transition | `localSigner` (stub) · **`keySigner`** (real, below) |

### Where the trail lives — `store.js`, `pod.js`

BlockTrails pins **order** to Bitcoin (the commitment); the **state** is the
owner's to keep, anywhere they control. So the store is pluggable:

| Store | Durable | Cross-device / origin | Notes |
|---|---|---|---|
| `memStore()` | ✗ | ✗ | isomorphic; tests + demo |
| `localStore()` | ✗ (per browser) | ✗ | localStorage; simplest real store |
| **`podStore({ authFetch, base })`** | ✓ | ✓ | a Solid pod — WebID-owned, durable, portable |

`podStore` writes one JSON document per identity into the owner's pod via an
authenticated fetch (e.g. xlogin's `window.xlogin.authFetch`) — so clearing the
browser doesn't lose it, and apps on different origins read the same pod under
one WebID. It's *your* store, not the app's server.

### Signing — `keys.js`

`keySigner()` signs each transition with **BIP340 Schnorr** using a nostr private
key — the *same* key as your identity, the same primitive BlockTrails tweaks.
PoC pattern lifted from [xlogin](https://github.com/melvincarvalho/xlogin)'s
guest login: the key is **input once and kept in `localStorage`** (this browser
only), and noble is imported from esm.sh.

```js
import { keySigner } from 'tidegate/keys';
const signer = await keySigner();     // prompts for a 64-hex key once, then reuses it
createTidegate({ backend, signer });
```

Browser-targeted (localStorage + esm.sh). Node tests use `localSigner`. Raw keys
are just the easiest PoC — the `{ pubkey, sign }` shape is unchanged when this is
swapped for a NIP-07 signer or a bunker later.

That's also what keeps it **isomorphic**: a Node test wires the local backend
and a stub signer; a browser wires the real ones. No Node/browser fork.

## What BlockTrails gives us (2b)

[BlockTrails](https://blocktrails.org/) anchors a **linear state machine to
Bitcoin with keys + hashes** (secp256k1 — the curve nostr already uses):
`tᵢ = SHA256(stateᵢ) mod n`, `dᵢ = dᵢ₋₁ + tᵢ`, a new P2TR output per state;
spending it advances the trail. State lives off-chain (nostr relays); Bitcoin
holds the commitment and enforces ordering; apps validate client-side. Portability
isn't a transfer between trails — it's **one identity-anchored trail multiple
apps read and advance** under a shared token Profile.

## Status — v0.0.1

Local-ledger backend and a stub signer only: **no chain, no real crypto.** Enough
to round-trip peg-in/peg-out and pin the state machine before any Bitcoin exists.

- **2a (this):** the four-function API + local ledger. Round-trip proven.
- **2b:** the real backend — BlockTrails, nostr-relay state, testnet4 anchor,
  noskey signing, `confirmations: 0` (optimistic; a knob to harden later).
- **3:** consumers — a game vault (Tideholm) and a tavern peg against the trail.

```
npm test    # the round-trip, in Node against the local backend
```

## License

MIT
