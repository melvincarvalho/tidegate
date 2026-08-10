// Tidegate — a nostr-key signer. PoC pattern lifted from xlogin's guest login:
// the private key lives in localStorage (input once, this browser only), and
// each transition is signed with Schnorr (BIP340) — the SAME key as your nostr
// identity, and the same secp256k1 primitive BlockTrails tweaks. So the signer
// that authorizes a peg is the identity the trail is keyed to.
//
// Browser-targeted: it imports @noble from esm.sh (as xlogin does) and uses
// localStorage. Node tests use the stub signer in ./local.js instead — the core
// library (tidegate.js) takes the signer as an injected dependency, so which
// one you wire in is the app's choice.
//
// Later this same module can front a NIP-07 signer (a browser extension, or
// xlogin's window.nostr) instead of a raw key — the { pubkey, sign } shape is
// unchanged. Raw keys are the easiest PoC, nothing more.

const STORAGE_KEY = 'tidegate-nostr-key';

let _noble = null;
async function noble() {
  if (_noble) return _noble;
  const [curves, hashes] = await Promise.all([
    import('https://esm.sh/@noble/curves@1.4.0/secp256k1'),
    import('https://esm.sh/@noble/hashes@1.4.0/sha256'),
  ]);
  const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  _noble = { schnorr: curves.schnorr, sha256: hashes.sha256, bytesToHex };
  return _noble;
}

function store() { try { return window.localStorage; } catch { return null; } }
function loadKey() { const s = store(); return s ? s.getItem(STORAGE_KEY) : null; }
function saveKey(hex) { const s = store(); if (s) s.setItem(STORAGE_KEY, hex); }

// PoC accepts a 64-hex secret only. (nsec bech32 decoding is a later nicety.)
function normalize(k) {
  return String(k || '').trim().toLowerCase();
}
const isHexKey = (h) => /^[0-9a-f]{64}$/.test(h);

// Forget the stored key (log out of the seal).
export function forgetKey() { const s = store(); if (s) s.removeItem(STORAGE_KEY); }

// A signer backed by a stored (or supplied) nostr private key. If none is
// stored and none is passed, `ask()` is called once to obtain it (default: a
// browser prompt); the key is then persisted to localStorage. Returns the
// { pubkey, sign } shape the tidegate core expects. Throws if the key isn't 64-hex.
export async function keySigner({ key, ask } = {}) {
  let hex = normalize(key || loadKey() || '');
  if (!isHexKey(hex)) {
    const asker = ask
      || (typeof window !== 'undefined' && window.prompt
        ? () => window.prompt('Paste your nostr private key (64-hex) to seal to the Tidegate.\nStored locally, in this browser only.')
        : null);
    hex = normalize(asker ? await asker() : '');
    if (!isHexKey(hex)) throw new Error('tidegate: a 64-hex nostr private key is required');
  }
  saveKey(hex);
  const { schnorr, sha256, bytesToHex } = await noble();
  const pubkey = bytesToHex(schnorr.getPublicKey(hex)); // x-only, = your nostr pubkey
  return {
    pubkey,
    // Sign the SHA-256 of the transition bytes with BIP340 Schnorr — a real,
    // verifiable signature by the identity's key. (2b anchors this on testnet4;
    // for now the local backend simply records it in the trail.)
    async sign(bytes) {
      return bytesToHex(schnorr.sign(sha256(bytes), hex));
    },
    forget: forgetKey,
  };
}
