// Tidegate — NIP-98 HTTP auth. The SAME nostr key that signs trail transitions
// (keys.js) also authenticates the writes that store the trail: each request
// carries a signed kind-27235 event proving it came from the identity, and the
// storage ACLs by that pubkey. One keypair — identity, transactions, and auth.
//
// This is the auth `podStore` wants: `podStore({ authFetch: nip98Fetch(), … })`.
// Reusable across the suite — wrap any fetch to make it nostr-authenticated.
//
// Browser-targeted: noble from esm.sh, the key from localStorage (shared with
// keys.js). Same shape as xlogin's NIP-98 authFetch, self-contained on the key.

const STORAGE_KEY = 'tidegate-nostr-key'; // shared with keys.js

let _noble = null;
async function noble() {
  if (_noble) return _noble;
  const [curves, hashes] = await Promise.all([
    import('https://esm.sh/@noble/curves@1.4.0/secp256k1'),
    import('https://esm.sh/@noble/hashes@1.4.0/sha256'),
  ]);
  const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const utf8 = (s) => new TextEncoder().encode(s);
  _noble = { schnorr: curves.schnorr, sha256: hashes.sha256, bytesToHex, utf8 };
  return _noble;
}

function loadKey() { try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; } }
const isHexKey = (h) => /^[0-9a-f]{64}$/.test(h);

// Sign a nostr event: id = sha256(canonical serialization), sig = schnorr(id).
// This is a plain nostr event, verifiable by any nostr library.
async function signEvent(unsigned, hex) {
  const { schnorr, sha256, bytesToHex, utf8 } = await noble();
  const pubkey = bytesToHex(schnorr.getPublicKey(hex));
  const e = {
    pubkey,
    created_at: unsigned.created_at,
    kind: unsigned.kind,
    tags: unsigned.tags || [],
    content: unsigned.content || '',
  };
  const ser = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
  const id = bytesToHex(sha256(utf8(ser)));
  const sig = bytesToHex(schnorr.sign(id, hex));
  return { id, ...e, sig };
}

// Build a NIP-98 `Authorization` header value for a request. Includes a
// `payload` tag (sha256 of the body) when there's a body, per the spec.
export async function nip98Header(url, method = 'GET', { key, body } = {}) {
  const hex = String(key || loadKey() || '').trim().toLowerCase();
  if (!isHexKey(hex)) throw new Error('tidegate: a 64-hex nostr key is required for NIP-98');
  const tags = [['u', url], ['method', String(method).toUpperCase()]];
  if (body != null) {
    const { sha256, bytesToHex, utf8 } = await noble();
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    tags.push(['payload', bytesToHex(sha256(utf8(raw)))]);
  }
  const evt = await signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  }, hex);
  const json = JSON.stringify(evt);
  const b64 = typeof btoa !== 'undefined'
    ? btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json, 'utf8').toString('base64');
  return 'Nostr ' + b64;
}

// A fetch that adds a NIP-98 header signed by the nostr key — a drop-in
// `authFetch` for podStore. `key` optional (defaults to the stored key).
export function nip98Fetch(opts = {}) {
  return async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const header = await nip98Header(url, method, { key: opts.key, body: init.body });
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', header);
    return fetch(url, { ...init, headers });
  };
}
