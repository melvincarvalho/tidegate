// Tidegate — the Bitcoin taproot address a nostr key controls.
//
// A BIP340 x-only nostr pubkey IS a witness-v1 (taproot / P2TR) output key on
// the same secp256k1 curve — so the did:nostr identity is *also* a Bitcoin
// address: the one a BlockTrails committer funds and spends to anchor the trail
// (tᵢ = SHA256(stateᵢ) mod n; spend the P2TR output to advance). Funding that one
// address is the whole provisioning step, because identity = signer = auth = key.
//
// Derivation matches the suite (nostr-beacon's DID `#bitcoin-taproot` service):
// the raw 32-byte x-only key, UNTWEAKED, bech32m-encoded — hrp 'tb' for testnet,
// 'bc' for mainnet. Testnet4 shares testnet's 'tb' prefix, so a 'tb1p…' address
// is queried under mempool.space/testnet4. bech32m via @scure/base (same audited
// ecosystem as the noble curves this library already uses).

import { bech32m } from 'https://esm.sh/@scure/base@1.1.6';

const HRP = { testnet: 'tb', mainnet: 'bc' };

function xonlyBytes(pubkey) {
  const h = String(pubkey).trim().toLowerCase().replace(/^did:nostr:/, '').replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('tidegate: a 64-hex x-only pubkey is required');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// The P2TR address for an x-only pubkey. Accepts a bare 64-hex key or a full
// `did:nostr:<hex>`. network is 'testnet' (default) or 'mainnet'.
export function taprootAddress(pubkey, network = 'testnet') {
  const hrp = HRP[network] || HRP.testnet;
  const words = [1, ...bech32m.toWords(xonlyBytes(pubkey))]; // witness v1 + 32-byte program
  return bech32m.encode(hrp, words);
}
