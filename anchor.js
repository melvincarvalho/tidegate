// Tidegate — the browser committer (#140): anchor a signed trail tip to
// Bitcoin (testnet4) as a BlockTrails state advance, non-custodially.
//
// The key never leaves the browser: it is the same nostr key keys.js already
// keeps in localStorage for signing pegs. The server never sees key material —
// it only receives the resulting commitment (txid/address/seq) to stamp onto
// the stored trail.
//
// Division of labour (mirrors tideholm's tools/tidegate-anchor.js):
//   * crypto  — the `blocktrails` reference library, browser entry via esm.sh
//     (scalar tweak, chained derivation, BIP-341 sighash, Schnorr): a
//     BlockTrails verifier accepts what we write.
//   * network — mempool.space/testnet4 (UTXO fetch, fees, broadcast; CORS ok).
//
// Conventions (identical to the CLI tool — the two must agree byte-for-byte):
//   * state string, literal key order:
//       {"app":"tideholm","did":"<did>","seq":<n>,"tip":"sha256:<hex>"}
//     tip = sha256 of the CANONICAL trail: exactly the signed fields
//     (did,prev,delta,next,sig,pubkey,at) in fixed key order — operator
//     stamps (commitment) excluded, so anchoring never changes the tip it
//     anchored.
//   * even-Y base: the chain derives from 02||x of the x-only nostr pubkey,
//     the privkey parity-normalized to match — the trail is derivable and
//     verifiable from the npub alone.
//   * the float: an anchor spending the BASE address carves a small float
//     (default 10k sat) into the trail and returns change to base; tip-to-tip
//     anchors forward the whole float. Amounts are irrelevant to the proof.
//   * deterministic: UTXOs sorted by (txid, vout); signing aux = 0 — so a
//     previewed/signed tx is byte-identical when broadcast.
//
// Prior anchor states need no side file in the browser: the trail is
// append-only, so each stamped entry k reconstructs its state from the prefix
// trail[0..k]. That is the whole recovery story: npub + trail ⇒ every address.

const BT_URL = 'https://esm.sh/blocktrails@0.0.11/src/browser.js';
const HASHES_URL = 'https://esm.sh/@noble/hashes@1.4.0/sha256';
const API = 'https://mempool.space/testnet4/api';
const APP = 'tideholm';
const DUST = 546;
const DEFAULT_FLOAT = 10000;
const STORAGE_KEY = 'tidegate-nostr-key'; // shared with keys.js

let _mods = null;
async function mods() {
  if (_mods) return _mods;
  const [bt, hashes] = await Promise.all([import(BT_URL), import(HASHES_URL)]);
  _mods = { bt, sha256: hashes.sha256 };
  return _mods;
}

const hexOf = (did) => {
  const h = String(did).trim().toLowerCase().replace(/^did:nostr:/, '');
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('tidegate: a did:nostr (64-hex) identity is required');
  return h;
};

// sha256 of a string → hex, via the same noble build the signatures use.
async function sha256hex(s) {
  const { sha256 } = await mods();
  const d = sha256(new TextEncoder().encode(s));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

// The canonical, commitment-free view — MUST match the CLI tool exactly.
const canonicalTrail = (t) => JSON.stringify(t.map((e) => ({
  did: e.did, prev: e.prev, delta: e.delta, next: e.next, sig: e.sig, pubkey: e.pubkey, at: e.at,
})));

const stateString = (did, seq, tipHex) =>
  JSON.stringify({ app: APP, did, seq, tip: 'sha256:' + tipHex });

// Reconstruct the already-anchored state strings from the trail itself: every
// entry stamped with a commitment marks an anchor at seq = its index + 1, whose
// tip hashed the prefix up to and including it.
export async function priorStatesOf(did, trail) {
  const states = [];
  for (let i = 0; i < trail.length; i++) {
    if (trail[i] && trail[i].commitment) {
      states.push(stateString(did, i + 1, await sha256hex(canonicalTrail(trail.slice(0, i + 1)))));
    }
  }
  return states;
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.replace(API, 'mempool')} → ${r.status}`);
  return r.json();
}

// Everything both preview and anchor need, computed once. Keyless.
async function plan(did, trail, opts = {}) {
  const { bt } = await mods();
  const hex = hexOf(did);
  if (!Array.isArray(trail) || trail.length === 0) throw new Error('tidegate: empty trail — nothing to anchor');
  const seq = trail.length;
  const tipHex = await sha256hex(canonicalTrail(trail));
  const state = stateString(did, seq, tipHex);

  const priorStates = await priorStatesOf(did, trail);
  if (trail[trail.length - 1].commitment) throw new Error('tidegate: this tip is already anchored');

  const pubkeyBase = bt.hexToBytes('02' + hex); // even-Y convention
  const fromXonly = priorStates.length === 0
    ? bt.hexToBytes(hex)
    : bt.p2trXonly(bt.deriveChainedPublicKey(pubkeyBase, priorStates));
  const nextXonly = bt.p2trXonly(bt.deriveChainedPublicKey(pubkeyBase, [...priorStates, state]));

  // Addresses for display/API — btc.js is the verified encoder in this repo.
  const { taprootAddress } = await import(new URL('./btc.js', import.meta.url).href);
  const fromAddress = taprootAddress(bt.bytesToHex(fromXonly), 'testnet');
  const nextAddress = taprootAddress(bt.bytesToHex(nextXonly), 'testnet');

  const utxos = (await getJson(`${API}/address/${fromAddress}/utxo`))
    .filter((u) => u.status && u.status.confirmed)
    .sort((a, b) => a.txid.localeCompare(b.txid) || a.vout - b.vout); // deterministic bytes
  if (utxos.length === 0) throw new Error(`tidegate: no confirmed fuel at ${fromAddress.slice(0, 12)}…`);
  const inputValue = utxos.reduce((a, u) => a + u.value, 0);

  let feeRate = Number(opts.feeRate);
  if (!feeRate) {
    try { feeRate = Math.max(1, Math.ceil((await getJson(`${API}/v1/fees/recommended`)).halfHourFee)); }
    catch { feeRate = 1; }
  }

  // The float convention (see header).
  const floatSats = Math.max(1000, Math.trunc(Number(opts.float) || DEFAULT_FLOAT));
  let carving = priorStates.length === 0 && !opts.all;
  let vsize, fee, outputs;
  if (carving) {
    vsize = bt.estimateVsize(utxos.length, 2);
    fee = Math.ceil(vsize * feeRate);
    const change = inputValue - fee - floatSats;
    if (change > DUST) {
      outputs = [
        { xonly: nextXonly, address: nextAddress, value: floatSats, label: 'trail float' },
        { xonly: bt.hexToBytes(hex), address: fromAddress, value: change, label: 'change → base' },
      ];
    } else carving = false;
  }
  if (!carving) {
    vsize = bt.estimateVsize(utxos.length, 1);
    fee = Math.ceil(vsize * feeRate);
    const forward = inputValue - fee;
    if (forward <= DUST) throw new Error(`tidegate: fee ${fee} sat would leave dust — not enough fuel`);
    outputs = [{ xonly: nextXonly, address: nextAddress, value: forward, label: 'whole balance forward' }];
  }

  return { did, hex, seq, state, tip: 'sha256:' + tipHex, priorStates, pubkeyBase, fromXonly, fromAddress, nextXonly, nextAddress, utxos, inputValue, feeRate, vsize, fee, outputs };
}

// PREVIEW — keyless. What an anchor would do, exactly.
export async function previewAnchor(did, trail, opts = {}) {
  const p = await plan(did, trail, opts);
  return {
    seq: p.seq, state: p.state, tip: p.tip, anchorIndex: p.priorStates.length + 1,
    from: p.fromAddress, inputValue: p.inputValue,
    outputs: p.outputs.map(({ address, value, label }) => ({ address, value, label })),
    fee: p.fee, feeRate: p.feeRate,
  };
}

// ANCHOR — sign with the localStorage nostr key and broadcast. Returns the
// commitment; the caller reports it to the app server for stamping.
export async function anchor(did, trail, opts = {}) {
  const { bt } = await mods();
  const p = await plan(did, trail, opts);

  const keyHex = String(opts.key || (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('tidegate: no nostr key — peg once (or store the key) first');
  const priv = bt.hexToBytes(keyHex);

  // Even-Y normalize, then the reference transition() recipe.
  const realPub = bt.hexToBytes(bt.genesis(priv, 'parity-probe').pubkeyBase);
  const basePriv = bt.adjustPrivateKeyForSigning(priv, realPub);
  if (bt.bytesToHex(bt.p2trXonly(realPub)) !== p.hex) throw new Error('tidegate: the stored key does not match this identity — refusing to sign');

  const chainedPriv = p.priorStates.length === 0 ? basePriv : bt.deriveChainedPrivateKey(basePriv, p.priorStates);
  const prevP = p.priorStates.length === 0 ? p.pubkeyBase : bt.deriveChainedPublicKey(p.pubkeyBase, p.priorStates);
  const signingKey = bt.adjustPrivateKeyForSigning(chainedPriv, prevP);
  const signingPub = bt.hexToBytes(bt.genesis(signingKey, 'parity-probe').pubkeyBase);
  if (bt.bytesToHex(bt.p2trXonly(signingPub)) !== bt.bytesToHex(p.fromXonly)) {
    throw new Error('tidegate: derived signing key does not sit on the funded output — refusing to sign');
  }

  const tx = bt.buildTransaction({
    inputs: p.utxos.map((u) => ({ txid: u.txid, vout: u.vout, witnessProgram: p.fromXonly, amount: u.value })),
    outputs: p.outputs.map((o) => ({ witnessProgram: o.xonly, value: o.value })),
  });
  const prevouts = p.utxos.map((u) => ({ txid: u.txid, vout: u.vout, witnessProgram: p.fromXonly, amount: BigInt(u.value) }));
  const signed = bt.signTransaction(tx, p.utxos.map(() => signingKey), prevouts);
  const rawHex = bt.bytesToHex(bt.serializeTransaction(signed));
  const txid = bt.computeTxid(signed);

  const r = await fetch(`${API}/tx`, { method: 'POST', body: rawHex });
  const body = await r.text();
  if (!r.ok) throw new Error(`tidegate: broadcast failed (${r.status}): ${body.slice(0, 120)}`);

  return {
    network: 'tbtc4', seq: p.seq, state: p.state, tip: p.tip,
    address: p.nextAddress, txid, rawHex,
    value: p.outputs[0].value, // the trail output's sats (vout 0) — for amount-checked verification
    explorer: `https://mempool.space/testnet4/tx/${txid}`,
  };
}
