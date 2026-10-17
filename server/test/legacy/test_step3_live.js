'use strict';

// ── Live Docker integration test for containerPool.js ────────────────────────
// Run this AFTER `docker compose up --build` so the fat-judge image exists.
// Verifies: pool spawns 4 containers, /dev/shm=1K, hardening flags applied.

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

const {
  pool,
  spawnContainer,
  killContainer,
  validateContainer,
  RECYCLE_AFTER_N,
} = require('./src/judge/containerPool');

async function run() {
  let passed = 0, failed = 0;

  function ok(label) { console.log(`  ✅  ${label}`); passed++; }
  function fail(label, msg) { console.error(`  ❌  ${label}\n       ${msg}`); failed++; }

  // ── 1. Spawn one container manually and verify it ──────────────────────────
  console.log('\n── Manual spawn + inspect ───────────────────────────────────────');
  let testName;
  try {
    testName = await spawnContainer();
    ok(`spawnContainer() returned "${testName}"`);

    // Name format
    if (/^judge-worker-[0-9a-f-]{36}$/.test(testName)) ok('Name matches judge-worker-<uuid>');
    else fail('Name format', `Got "${testName}"`);

    // validate() returns true on the live container
    const healthy = await validateContainer(testName);
    if (healthy) ok('validateContainer() returns true on live container');
    else fail('validate live container', 'returned false');

    // /dev/shm must be 1.0K, not 64.0M (the core §2 fix)
    const { stdout: dfOut } = await execFileP('docker', [
      'exec', testName, 'df', '-h', '/dev/shm',
    ]);
    if (dfOut.includes('1.0K')) ok('/dev/shm mount is 1.0K (not 64.0M)');
    else fail('/dev/shm size', `df output:\n${dfOut}`);

    // Inspect: read-only rootfs
    const { stdout: roOut } = await execFileP('docker', [
      'inspect', '-f', '{{.HostConfig.ReadonlyRootfs}}', testName,
    ]);
    if (roOut.trim() === 'true') ok('--read-only: ReadonlyRootfs=true');
    else fail('--read-only', `Got "${roOut.trim()}"`);

    // Inspect: network mode = none
    const { stdout: netOut } = await execFileP('docker', [
      'inspect', '-f', '{{.HostConfig.NetworkMode}}', testName,
    ]);
    if (netOut.trim() === 'none') ok('--network=none confirmed');
    else fail('--network=none', `Got "${netOut.trim()}"`);

    // Inspect: CapDrop includes ALL
    const { stdout: capOut } = await execFileP('docker', [
      'inspect', '-f', '{{.HostConfig.CapDrop}}', testName,
    ]);
    if (capOut.includes('ALL')) ok('--cap-drop=ALL confirmed');
    else fail('--cap-drop=ALL', `Got "${capOut.trim()}"`);

  } catch (err) {
    fail('Manual spawn', err.message);
  } finally {
    if (testName) {
      await killContainer(testName);
      // validate should now return false (container gone)
      const dead = await validateContainer(testName);
      if (!dead) ok('validateContainer() returns false after killContainer()');
      else fail('validate after kill', 'still returned true');
    }
  }

  // ── 2. Pool initialises with 4 warm containers ────────────────────────────
  console.log('\n── Pool warm-up (4 containers) ──────────────────────────────────');
  try {
    // Acquire all 4 slots to confirm they exist
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    const c3 = await pool.acquire();
    const c4 = await pool.acquire();
    ok('Pool filled: acquired 4 containers');

    // All names should be judge-worker-<uuid>
    for (const c of [c1, c2, c3, c4]) {
      if (!/^judge-worker-[0-9a-f-]{36}$/.test(c))
        fail(`Name format for "${c}"`, 'does not match judge-worker-<uuid>');
    }
    ok('All 4 names match judge-worker-<uuid>');

    // Force-kill one, release the rest normally
    // Pool should auto-respawn the killed one within acquireTimeoutMillis
    await pool.destroy(c1);
    ok('pool.destroy(c1) — pool will auto-respawn');

    await pool.release(c2);
    await pool.release(c3);
    await pool.release(c4);

    // Acquire again — pool should have refilled c1's slot
    const cNew = await pool.acquire();
    ok(`Pool re-acquired after destroy: "${cNew}"`);
    await pool.release(cNew);

  } catch (err) {
    fail('Pool warm-up', err.message);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);

  // Drain pool cleanly before exit
  await pool.drain();
  await pool.clear();

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
