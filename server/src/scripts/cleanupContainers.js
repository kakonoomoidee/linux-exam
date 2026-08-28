/**
 * Sweep up stray exam sandbox containers that escaped automatic teardown
 * (provisioning crashed mid-create, docker daemon hiccup, someone `docker
 * kill`ed one by hand, an old row that predates a fix...).
 *
 *   npm run cleanup             remove stale (exited/dead/created) tekser-* containers
 *   npm run cleanup -- --dry    just list them, remove nothing
 *   npm run cleanup -- --force  ALSO remove RUNNING tekser-* containers
 *                               (only when you're sure no exam is in progress)
 *
 * Only ever touches containers whose name starts with "tekser-" — the
 * per-student sandboxes. Never the app / db / compose containers.
 *
 * Needs Docker socket access: run it on the host, or
 *   docker compose exec app npm run cleanup
 */
const Docker = require('dockerode');

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const name = (c) => c.Names[0].replace(/^\//, '');

async function main() {
  const docker = new Docker();

  const listed = await docker.listContainers({ all: true, filters: { name: ['tekser-'] } });
  // Docker's name filter is a loose substring match — pin it to the real prefix.
  const sandboxes = listed.filter((c) => c.Names.some((n) => n.replace(/^\//, '').startsWith('tekser-')));

  if (sandboxes.length === 0) {
    console.log('[cleanup] no tekser-* containers. Nothing to do.');
    return;
  }

  const running = sandboxes.filter((c) => c.State === 'running');
  const stale = sandboxes.filter((c) => c.State !== 'running');

  console.log(`[cleanup] ${sandboxes.length} tekser-* container(s) — ${stale.length} stale, ${running.length} running:`);
  for (const c of sandboxes) {
    console.log(`  ${c.State.padEnd(8)} ${name(c).padEnd(45)} ${c.Id.slice(0, 12)}  ${c.Status}`);
  }

  if (running.length && !FORCE) {
    console.log(
      `[cleanup] leaving ${running.length} RUNNING container(s) alone — an exam may be live. ` +
        `Re-run with --force to remove those too.`
    );
  }

  const targets = FORCE ? sandboxes : stale;
  if (targets.length === 0) {
    console.log('[cleanup] nothing to remove.');
    return;
  }
  if (DRY) {
    console.log(`[cleanup] --dry: would remove ${targets.length} container(s).`);
    return;
  }

  let removed = 0;
  for (const c of targets) {
    try {
      await docker.getContainer(c.Id).remove({ force: true });
      removed += 1;
      console.log(`[cleanup] removed ${name(c)}`);
    } catch (err) {
      if (err.statusCode === 404) {
        removed += 1; // already gone
        continue;
      }
      console.error(`[cleanup] failed to remove ${c.Id.slice(0, 12)}: ${err.message}`);
    }
  }
  console.log(`[cleanup] done — removed ${removed}/${targets.length}.`);
}

main().catch((err) => {
  console.error('[cleanup] fatal:', err.message);
  process.exit(1);
});
