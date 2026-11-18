// Emergency one-time copy of essential TOP5 data and collection scan checkpoints.
// Does NOT write to old Firebase. Avoids copying per-serial receipts (not required
// for UI ranking or collector deduplication, which uses collectionState.done).
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function credentials(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(`Missing GitHub Actions Secret: ${name}`);
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`Invalid service account JSON for ${name}`); }
  if (!parsed.project_id || !parsed.private_key) throw new Error(`Incomplete service account: ${name}`);
  return parsed;
}

const oldKey = credentials('FIREBASE_SERVICE_ACCOUNT_JSON');
const newKey = credentials('FIREBASE_SERVICE_ACCOUNT_JSON_NEW');
if (oldKey.project_id === newKey.project_id) throw new Error('Source and destination must be DIFFERENT Firebase projects.');

const oldApp = initializeApp({ credential: cert(oldKey), projectId: oldKey.project_id }, 'source');
const newApp = initializeApp({ credential: cert(newKey), projectId: newKey.project_id }, 'destination');
const source = getFirestore(oldApp);
const destination = getFirestore(newApp);

async function run() {
  console.log('Reading existing rank and scan progress (no writes to source)...');
  const [status, state, ranks, destinationState, destinationRanks] = await Promise.all([
    source.doc('public/status').get(),
    source.collection('collectionState').get(),
    source.collection('rankShards').get(),
    destination.collection('collectionState').limit(1).get(),
    destination.collection('rankShards').limit(1).get(),
  ]);
  if (!destinationState.empty || !destinationRanks.empty) {
    throw new Error('Destination already has ranking or collectionState data. Refusing to overwrite to prevent count duplication.');
  }
  if (!status.exists || state.empty || ranks.empty) {
    throw new Error(`Source data incomplete: public/status=${status.exists}, collectionState=${state.size}, rankShards=${ranks.size}. Stopped safely.`);
  }
  console.log(`Found: ${state.size} collection states, ${ranks.size} ranking shards, 1 status.`);
  // This preserves each collectionState.done, which is the scanner's deduplication key.
  // Per-serial legacy receipts are intentionally not copied. Existing old project remains intact.
  const copies = [
    ...state.docs.map(d => ({ path: d.ref.path, value: d.data() })),
    ...ranks.docs.map(d => ({ path: d.ref.path, value: d.data() })),
    { path: 'public/status', value: { ...status.data(), syncRunning: false, lastError: '', migratedAt: new Date().toISOString(), migratedFrom: oldKey.project_id } },
  ];
  // Small chunks keep the batch write well inside Firestore's limits.
  let written = 0;
  for (let start = 0; start < copies.length; start += 20) {
    const batch = destination.batch();
    for (const { path, value } of copies.slice(start, start + 20)) {
      batch.set(destination.doc(path), value);
    }
    await batch.commit();
    written += Math.min(20, copies.length - start);
    console.log(`MIGRATION: ${written}/${copies.length} essential documents written to new Firebase.`);
  }
  // Verify all transferred documents exist; no extra writes.
  const [checkState, checkRanks, checkStatus] = await Promise.all([
    destination.collection('collectionState').get(),
    destination.collection('rankShards').get(),
    destination.doc('public/status').get(),
  ]);
  if (checkState.size !== state.size || checkRanks.size !== ranks.size || !checkStatus.exists) {
    throw new Error(`Verification mismatch: states ${checkState.size}/${state.size}; ranks ${checkRanks.size}/${ranks.size}; status ${checkStatus.exists}`);
  }
  console.log('SUCCESS: New Firebase has ranking, completed serial markers and status. Ready to switch site config and scanner secret.');
}

try { await run(); }
finally { await Promise.allSettled([deleteApp(oldApp), deleteApp(newApp)]); }
