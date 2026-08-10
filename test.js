// Tidegate v0.0.1 — the round-trip, in Node against the local backend. The same
// code runs in a browser tab; only the backend and signer differ there.
import { createTidegate, trailBackend, noCommitter } from './tidegate.js';
import { localBackend, localSigner } from './local.js';
import { memStore, localStore } from './store.js';
import { podStore } from './pod.js';

let pass = 0;
let fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

const did = 'did:nostr:npub1testtidegate';
const backend = localBackend();
const tg = createTidegate({ backend, signer: localSigner('npub1testtidegate') });

(async () => {
  check('a fresh identity starts at zero', (await tg.balance(did)) === 0);

  const seen = [];
  const unsub = tg.subscribe(did, (b) => seen.push(b));

  await tg.pegIn(did, 1200);
  check('peg-in raises the sealed balance', (await tg.balance(did)) === 1200);

  await tg.pegIn(did, 300);
  check('a second peg-in accrues', (await tg.balance(did)) === 1500);

  await tg.pegOut(did, 500);
  check('peg-out lowers it', (await tg.balance(did)) === 1000);

  check('every change reached the subscriber',
    JSON.stringify(seen) === JSON.stringify([1200, 1500, 1000]), JSON.stringify(seen));

  // The trail is a signed, linear history — one entry per move.
  const trail = await backend.trail(did);
  check('the trail records each signed transition (3 so far)',
    trail.length === 3 && trail.every((t) => typeof t.sig === 'string' && t.sig.length > 0));
  check('transitions chain: prev of each is next of the last',
    trail[1].prev === trail[0].next && trail[2].prev === trail[1].next);

  // Guards.
  let threw = false;
  try { await tg.pegOut(did, 99999); } catch { threw = true; }
  check('over-peg-out is refused and leaves the balance intact',
    threw && (await tg.balance(did)) === 1000);

  threw = false;
  try { await tg.pegIn(did, 0); } catch { threw = true; }
  check('a zero amount is refused', threw);

  threw = false;
  try { await tg.pegIn(did, -5); } catch { threw = true; }
  check('a negative amount is refused (peg-in cannot be a disguised peg-out)', threw);

  // Fractions truncate to whole gold (matches the vault's flooring).
  await tg.pegIn(did, 10.7);
  check('a fractional peg-in truncates to whole gold', (await tg.balance(did)) === 1010);

  threw = false;
  try { await createTidegate({ backend }).pegIn(did, 1); } catch { threw = true; }
  check('a move without a signer is refused', threw);

  // Full round-trip conserves: everything in comes back out.
  await tg.pegOut(did, 1010);
  check('a full peg-out empties the seal — gold conserved', (await tg.balance(did)) === 0);

  unsub();
  await tg.pegIn(did, 5);
  check('unsubscribe stops delivery', seen[seen.length - 1] !== 5);

  // ---- the StateStore seam ------------------------------------------------
  const did2 = 'did:nostr:npub1storeseam';

  // memStore composed through trailBackend, with an explicit no-op committer.
  const mem = createTidegate({ backend: trailBackend({ store: memStore(), committer: noCommitter }), signer: localSigner() });
  await mem.pegIn(did2, 700);
  await mem.pegOut(did2, 200);
  check('trailBackend + memStore round-trips', (await mem.balance(did2)) === 500);

  // localStore: a fake storage, and the balance SURVIVES a fresh backend
  // instance reading the same storage — the durability a memStore lacks.
  const fakeStorage = (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  })();
  const lsA = createTidegate({ backend: trailBackend({ store: localStore({ storage: fakeStorage }) }), signer: localSigner() });
  await lsA.pegIn(did2, 900);
  const lsB = createTidegate({ backend: trailBackend({ store: localStore({ storage: fakeStorage }) }), signer: localSigner() });
  check('localStore persists across a fresh backend instance', (await lsB.balance(did2)) === 900);

  // podStore: a fake authFetch (in-memory PUT/GET), and durability across
  // instances — the trail lives in "the pod", not the backend.
  const podFiles = new Map();
  const fakeAuthFetch = async (u, opts = {}) => {
    if ((opts.method || 'GET') === 'PUT') { podFiles.set(u, opts.body); return { ok: true, status: 200 }; }
    if (podFiles.has(u)) return { ok: true, status: 200, text: async () => podFiles.get(u) };
    return { ok: false, status: 404, text: async () => '' };
  };
  const podOpts = { authFetch: fakeAuthFetch, base: 'https://pod.example/tidegate/' };
  const pdA = createTidegate({ backend: trailBackend({ store: podStore(podOpts) }), signer: localSigner() });
  await pdA.pegIn(did2, 300);
  check('podStore writes the trail to the pod and reads it back', (await pdA.balance(did2)) === 300);
  const pdB = createTidegate({ backend: trailBackend({ store: podStore(podOpts) }), signer: localSigner() });
  check('podStore is durable — a fresh instance reads the same pod', (await pdB.balance(did2)) === 300);
  check('the pod holds exactly one document for this identity', podFiles.size === 1);

  // Committer seam: a recording committer stamps each transition.
  const commits = [];
  const recCommitter = { async commit(d, t) { const c = 'c#' + commits.length; commits.push({ d, delta: t.delta, c }); return c; } };
  const cm = createTidegate({ backend: trailBackend({ store: memStore(), committer: recCommitter }), signer: localSigner() });
  await cm.pegIn(did2, 100);
  await cm.pegOut(did2, 40);
  check('the committer anchors every transition and stamps it',
    commits.length === 2 && commits[0].c === 'c#0' && commits[1].delta === -40);

  console.log(`\n${fail ? fail + ' FAILURE(S)' : 'all tests pass'} — ${pass} ok`);
  process.exit(fail ? 1 : 0);
})();
