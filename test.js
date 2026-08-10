// Tidegate v0.0.1 — the round-trip, in Node against the local backend. The same
// code runs in a browser tab; only the backend and signer differ there.
import { createTidegate } from './tidegate.js';
import { localBackend, localSigner } from './local.js';

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
  const trail = backend.trail(did);
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

  console.log(`\n${fail ? fail + ' FAILURE(S)' : 'all tests pass'} — ${pass} ok`);
  process.exit(fail ? 1 : 0);
})();
