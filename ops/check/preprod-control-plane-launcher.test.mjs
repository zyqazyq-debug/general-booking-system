import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const launcher = resolve(root, 'ops/release/run-booking-preprod-control-plane');
const runbook = resolve(root, 'ops/release/FENCED_EXECUTOR_RUNBOOK.md');
const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\sh.exe' : '/bin/sh';
const IMAGE = 'node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5';

function dryRun(argv) {
  return spawnSync(shell, [launcher, ...argv], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BOOKING_CONTROL_PLANE_DRY_RUN: 'true' },
  });
}

function shellPath(path) {
  if (process.platform !== 'win32') return path;
  return path.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll('\\', '/');
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableCanonical(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableCanonical(entry)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .map((key) => `${JSON.stringify(key)}:${stableCanonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readStableCanonical(path) {
  const bytes = await readFile(path, 'utf8');
  const value = JSON.parse(bytes);
  assert.equal(bytes, `${stableCanonical(value)}\n`, `non-canonical record bytes: ${path}`);
  return value;
}

const shellUid = spawnSync(shell, ['-c', 'id -u'], { encoding: 'utf8' }).stdout.trim();
const shellGid = spawnSync(shell, ['-c', 'id -g'], { encoding: 'utf8' }).stdout.trim();

function replaceHarness(source, from, to) {
  assert.ok(source.includes(from), `missing launcher harness anchor: ${from}`);
  return source.replace(from, to);
}

async function writeLauncherHarness(nativeRoot, { crashAt = '', normal = false, statPath = null, trustEnvironment = false,
  pauseAt = '', pauseMarker = '', pauseRelease = '', injectAt = '', injectScript = '' } = {}) {
  const host = (suffix) => shellPath(join(nativeRoot, suffix));
  let source = readFileSync(launcher, 'utf8');
  const replacements = new Map([
    ["HOST_DOCKER='/var/packages/ContainerManager/target/usr/bin/docker'", `HOST_DOCKER='${host('usr/bin/docker')}'`],
    ["HOST_COMPOSE='/var/packages/ContainerManager/target/usr/bin/docker-compose'", `HOST_COMPOSE='${host('usr/bin/docker-compose')}'`],
    ["STATE_ROOT='/var/lib/happybooking'", `STATE_ROOT='${host('var/lib/happybooking')}'`],
    ["PREPROD_ROOT='/volume1/happybooking/booking-preprod'", `PREPROD_ROOT='${host('volume1/happybooking/booking-preprod')}'`],
    ["CONTROL_ROOT='/usr/local/libexec/happybooking/control-plane'", `CONTROL_ROOT='${host('usr/local/libexec/happybooking/control-plane')}'`],
    ["CONTROL_ENV='/etc/happybooking/secrets/booking-preprod-control-plane.env'", `CONTROL_ENV='${host('etc/happybooking/secrets/booking-preprod-control-plane.env')}'`],
    ["EVIDENCE_ROOT='/volume1/happybooking/booking-preprod/.g4'", `EVIDENCE_ROOT='${host('volume1/happybooking/booking-preprod/.g4')}'`],
    ["COSIGN='/usr/local/bin/cosign'", `COSIGN='${host('usr/local/bin/cosign')}'`],
    ["TRUST_ROOT='/etc/happybooking/trust'", `TRUST_ROOT='${host('etc/happybooking/trust')}'`],
    ["INSTALL_LOCK='/usr/local/libexec/.happybooking-control-plane-install.lock'", `INSTALL_LOCK='${host('usr/local/libexec/.happybooking-control-plane-install.lock')}'`],
    ["INSTALL_JOURNAL='/usr/local/libexec/.happybooking-control-plane-install.journal.json'", `INSTALL_JOURNAL='${host('usr/local/libexec/.happybooking-control-plane-install.journal.json')}'`],
    ["RUNTIME_LOCK='/usr/local/libexec/.happybooking-control-plane-runtime.lock'", `RUNTIME_LOCK='${host('usr/local/libexec/.happybooking-control-plane-runtime.lock')}'`],
    ["MIGRATION_LOCK='/usr/local/libexec/.happybooking-legacy-active-migration.lock'", `MIGRATION_LOCK='${host('usr/local/libexec/.happybooking-legacy-active-migration.lock')}'`],
    ["MIGRATION_JOURNAL='/usr/local/libexec/.happybooking-legacy-active-migration.journal.json'", `MIGRATION_JOURNAL='${host('usr/local/libexec/.happybooking-legacy-active-migration.journal.json')}'`],
    ["RUNTIME_TXN_PREFIX='/usr/local/libexec/.happybooking-control-plane-runtime-txn'", `RUNTIME_TXN_PREFIX='${host('usr/local/libexec/.happybooking-control-plane-runtime-txn')}'`],
    ["HOST_DOCKER_CONFIG='/usr/local/libexec/happybooking/control-plane/ops/release/.host-docker-empty'", `HOST_DOCKER_CONFIG='${host('usr/local/libexec/happybooking/control-plane/ops/release/.host-docker-empty')}'`],
    ["PROC_ROOT='/proc'", `PROC_ROOT='${host('proc')}'`],
    ["BOOT_ID_PATH='/proc/sys/kernel/random/boot_id'", `BOOT_ID_PATH='${host('proc/sys/kernel/random/boot_id')}'`],
    ["EXPECTED_UID='0'", `EXPECTED_UID='${shellUid}'`],
    ["EXPECTED_GID='0'", `EXPECTED_GID='${shellGid}'`],
    ['[ -S /var/run/docker.sock ] || fail', ` [ -f '${host('var/run/docker.sock')}' ] || fail`],
  ]);
  for (const [from, to] of replacements) source = replaceHarness(source, from, to);
  if (statPath) source = replaceHarness(source, "STAT='/usr/bin/stat'", `STAT='${shellPath(statPath)}'`);
  if (process.platform === 'win32') {
    source = source.replaceAll('case "$3" in 500|700) ;; *) fail ;; esac', 'case "$3" in 500|700|755) ;; *) fail ;; esac');
    source = source.replaceAll('[ "$3" = \'400\' ] || fail', 'case "$3" in 400|444|600|644) ;; *) fail ;; esac');
    source = source.replaceAll('case "$runtime_publish_mode" in 400|600) ;; *) return 1 ;; esac', 'case "$runtime_publish_mode" in 400|444|600|644) ;; *) return 1 ;; esac');
    source = source.replaceAll('if [ "$runtime_publish_mode" = \'600\' ]; then "$CHMOD" 400 "$runtime_publish_source" || fail; fi',
      'case "$runtime_publish_mode" in 600|644) "$CHMOD" 400 "$runtime_publish_source" || fail ;; esac');
    source = source.replaceAll('"$MKDIR" -m 700 "$runtime_temp" || fail', '"$MKDIR" "$runtime_temp" || fail');
    source = source.replaceAll('"$MKDIR" -m 700 "$runtime_publish_stage" || fail', '"$MKDIR" "$runtime_publish_stage" || fail');
    source = source.replaceAll('"$MKDIR" -m 700 "$runtime_txn" || fail', '"$MKDIR" "$runtime_txn" || fail');
  }
  if (normal) {
    source = replaceHarness(source, 'runtime_stat_path="$PROC_ROOT/$runtime_pid/stat"', 'runtime_stat_path="$PROC_ROOT/self/stat"');
    source = source.replaceAll('$PROC_ROOT/$runtime_owner_pid', '$PROC_ROOT/self');
    source = replaceHarness(source, 'export PATH\n', "export PATH\nLD_PRELOAD='/tmp/evil.so'\nLD_LIBRARY_PATH='/tmp/evil'\nexport LD_PRELOAD LD_LIBRARY_PATH\n");
  }
  if (!normal && !trustEnvironment) source = replaceHarness(source, '    runtime_trusted_recovery_environment\n', '    : # non-production harness: trust chain tested separately\n');
  if (pauseAt) source = replaceHarness(source, `# RUNTIME_TEST_CHECKPOINT ${pauseAt}`,
    `: > '${shellPath(pauseMarker)}'; while [ ! -f '${shellPath(pauseRelease)}' ]; do :; done`);
  if (injectAt) source = replaceHarness(source, `# RUNTIME_TEST_CHECKPOINT ${injectAt}`, injectScript);
  if (crashAt) source = replaceHarness(source, `# RUNTIME_TEST_CHECKPOINT ${crashAt}`, 'exit 75');
  const harness = join(nativeRoot, `launcher-${normal ? 'normal' : 'recovery'}-${crashAt || 'none'}`);
  await writeFile(harness, source);
  await chmod(harness, 0o500);
  return harness;
}

async function runtimeRecoveryFixture(t, { ownerBoot = '22222222-2222-2222-2222-222222222222',
  currentBoot = '11111111-1111-1111-1111-111111111111', ownerTicks = '9001', currentTicks = ownerTicks,
  dockerRecord = '', trustedDirectoryGid = false, writableTrustedDirectory = false, statDirectory = false,
  withCreate = true, withOwner = true, withCompletion = false } = {}) {
  const nativeRoot = await mkdtemp(join(tmpdir(), 'booking-runtime-lock-'));
  t.after(() => rm(nativeRoot, { recursive: true, force: true }));
  const testRoot = shellPath(nativeRoot);
  const lock = join(nativeRoot, 'usr/local/libexec/.happybooking-control-plane-runtime.lock');
  const docker = join(nativeRoot, 'usr/bin/docker');
  const record = join(nativeRoot, 'docker-record');
  const pid = 4242;
  await mkdir(dirname(lock), { recursive: true });
  await mkdir(join(nativeRoot, `proc/${pid}`), { recursive: true });
  await mkdir(join(nativeRoot, 'proc/sys/kernel/random'), { recursive: true });
  await mkdir(join(nativeRoot, 'usr/local/libexec/happybooking/control-plane/ops/release'), { recursive: true });
  await mkdir(dirname(docker), { recursive: true });
  await writeFile(join(nativeRoot, 'proc/sys/kernel/random/boot_id'), `${currentBoot}\n`);
  await writeFile(join(nativeRoot, `proc/${pid}/stat`), `${pid} (runtime-owner) ${['S', ...Array(18).fill('0'), currentTicks].join(' ')}\n`);
  if (statDirectory) { await rm(join(nativeRoot, `proc/${pid}/stat`)); await mkdir(join(nativeRoot, `proc/${pid}/stat`)); }
  const requestDigest = `sha256:${'b'.repeat(64)}`;
  const body = `{"bootId":"${ownerBoot}","containerIdentity":"booking-preprod-control-plane","imageDigest":"${IMAGE}","pid":${pid},"requestDigest":"${requestDigest}","schema":"booking.preprod-runtime-lock-intent/v2","startTicks":"${ownerTicks}"}`;
  const lockDigest = sha256(body);
  const document = `{"bootId":"${ownerBoot}","containerIdentity":"booking-preprod-control-plane","imageDigest":"${IMAGE}","lockDigest":"${lockDigest}","pid":${pid},"requestDigest":"${requestDigest}","schema":"booking.preprod-runtime-lock-intent/v2","startTicks":"${ownerTicks}"}`;
  const txn = join(nativeRoot, `usr/local/libexec/.happybooking-control-plane-runtime-txn-${lockDigest.slice(7)}`);
  await mkdir(txn, { recursive: true });
  await writeFile(join(txn, 'intent.json'), `${document}\n`);
  await chmod(join(txn, 'intent.json'), 0o400);
  await link(join(txn, 'intent.json'), lock);
  await chmod(txn, 0o700);
  const containerId = 'a'.repeat(64);
  let createDigest = 'absent';
  if (withCreate) {
    const createBody = `{"containerId":"${containerId}","lockDigest":"${lockDigest}","schema":"booking.preprod-runtime-create/v1"}`;
    createDigest = sha256(createBody);
    await writeFile(join(txn, 'create.json'), `{"containerId":"${containerId}","createDigest":"${createDigest}","lockDigest":"${lockDigest}","schema":"booking.preprod-runtime-create/v1"}\n`);
    await chmod(join(txn, 'create.json'), 0o400);
  }
  let ownerDigest = 'absent';
  if (withOwner) {
    assert.notEqual(createDigest, 'absent');
    const ownerBody = `{"containerId":"${containerId}","createDigest":"${createDigest}","lockDigest":"${lockDigest}","schema":"booking.preprod-runtime-owner/v3"}`;
    ownerDigest = sha256(ownerBody);
    await writeFile(join(txn, 'owner.json'), `{"containerId":"${containerId}","createDigest":"${createDigest}","lockDigest":"${lockDigest}","ownerDigest":"${ownerDigest}","schema":"booking.preprod-runtime-owner/v3"}\n`);
    await chmod(join(txn, 'owner.json'), 0o400);
    if (withCompletion) {
      const completionBody = `{"containerId":"${containerId}","exitCode":"7","lockDigest":"${lockDigest}","ownerDigest":"${ownerDigest}","schema":"booking.preprod-runtime-completion-intent/v1","status":"prepared"}`;
      const completionDigest = sha256(completionBody);
      await writeFile(join(txn, 'completion-intent.json'), `{"completionDigest":"${completionDigest}","containerId":"${containerId}","exitCode":"7","lockDigest":"${lockDigest}","ownerDigest":"${ownerDigest}","schema":"booking.preprod-runtime-completion-intent/v1","status":"prepared"}\n`);
      await chmod(join(txn, 'completion-intent.json'), 0o400);
    }
  }
  if (dockerRecord) await writeFile(record, `${dockerRecord}\n`);
  await writeFile(docker, `#!/bin/sh
set -eu
record='${shellPath(record)}'
[ "$1" = '--host' ] && [ "$2" = 'unix:///var/run/docker.sock' ] || exit 1
[ "$3" = '--config' ] && [ "$4" = '${shellPath(join(nativeRoot, 'usr/local/libexec/happybooking/control-plane/ops/release/.host-docker-empty'))}' ] || exit 1
shift 4
case "$1:$2" in
  version:--format) printf '%s\\n' '24.0.0' ;;
  container:inspect)
    [ -f "$record" ] || exit 1
    found=''
    while IFS='|' read -r id name status running exit_code image label; do
      if [ "$5" = "$id" ] || [ "$5" = "\${name#/}" ]; then
        [ -z "$found" ] || exit 1
        found="$id|$name|$status|$running|$exit_code|$image|$label"
      fi
    done < "$record"
    [ -n "$found" ] || exit 1
    printf '%s\\n' "$found"
    ;;
  ps:-a)
    [ -f "$record" ] || exit 0
    filter=''; previous=''; for value do [ "$previous" = '--filter' ] && filter=$value; previous=$value; done
    while IFS='|' read -r id name status running exit_code image label; do
      case "$filter" in
        name=*) [ "$filter" = "name=^/\${name#/}$" ] && printf '%s\\n' "$id" ;;
        label=uk.happybooking.runtime-lock-digest) [ -n "$label" ] && printf '%s\\n' "$id" ;;
        label=uk.happybooking.runtime-lock-digest=*) [ "$label" = "\${filter##*=}" ] && printf '%s\\n' "$id" ;;
        *) exit 1 ;;
      esac
    done < "$record"
    ;;
  container:rm)
    [ -f "$record" ] || exit 1
    target=$3; temp="$record.tmp"; : > "$temp"; found='false'
    while IFS='|' read -r id name status running exit_code image label; do
      if [ "$target" = "$id" ]; then found='true'; else printf '%s|%s|%s|%s|%s|%s|%s\\n' "$id" "$name" "$status" "$running" "$exit_code" "$image" "$label" >> "$temp"; fi
    done < "$record"
    [ "$found" = 'true' ] || exit 1
    if [ -s "$temp" ]; then mv "$temp" "$record"; else rm "$temp" "$record"; fi
    printf '%s\\n' "$target"
    ;;
  *) exit 1 ;;
esac
`);
  await chmod(docker, 0o500);
  let statPath = null;
  if (trustedDirectoryGid || writableTrustedDirectory) {
    statPath = join(nativeRoot, 'usr/bin/stat');
    const writablePath = shellPath(join(nativeRoot, 'usr/local/libexec'));
    await writeFile(statPath, `#!/bin/sh
set -eu
real=/usr/bin/stat
format=$1
shift
target=''
for target do :; done
value=$("$real" "$format" "$@")
if [ "$format" = '--format=%u %g %a' ]; then
  set -- $value
  mode=$3
  if [ '${writableTrustedDirectory ? 'true' : 'false'}' = 'true' ] && [ "$target" = '${writablePath}' ]; then mode=775; fi
  printf '%s %s %s\\n' "$1" '12345' "$mode"
else
  printf '%s\\n' "$value"
fi
`);
    await chmod(statPath, 0o500);
  }
  const harnesses = {};
  for (const point of ['', 'recovery-intent-published', 'container-removed', 'fixed-lock-unlinked',
    'record-stage-created', 'record-source-written', 'record-source-chmodded', 'record-source-synced',
    'record-stage-synced', 'record-linked', 'record-parent-synced', 'record-source-unlinked']) {
    harnesses[point] = await writeLauncherHarness(nativeRoot, { crashAt: point, statPath,
      trustEnvironment: trustedDirectoryGid || writableTrustedDirectory });
  }
  const argv = ['recover-stale-runtime-lock', '--action', 'recover-runtime-lock', '--execute', 'true',
    '--environment', 'preprod', '--project', 'booking-preprod', '--expected-lock-digest', lockDigest,
    '--recovery-id', 'runtime-recovery-test-1'];
  const run = (extraEnv = {}, overrideArgv = argv) => {
    const crashAt = extraEnv.BOOKING_CONTROL_PLANE_RUNTIME_LOCK_TEST_CRASH_AT || '';
    const cleanEnv = { ...extraEnv };
    delete cleanEnv.BOOKING_CONTROL_PLANE_RUNTIME_LOCK_TEST_CRASH_AT;
    const shellArgs = cleanEnv.RUNTIME_HARNESS_TRACE ? ['-x', harnesses[crashAt], ...overrideArgv] : [harnesses[crashAt], ...overrideArgv];
    delete cleanEnv.RUNTIME_HARNESS_TRACE;
    return spawnSync(shell, shellArgs, {
    cwd: root, encoding: 'utf8', env: { ...process.env, BOOKING_CONTROL_PLANE_DRY_RUN: '', ...cleanEnv },
  });
  };
  return { nativeRoot, testRoot, lock, lockDigest, createDigest, ownerDigest, containerId, txn, record, argv, run };
}

async function waitForPath(path) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    try { await access(path); return; } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 10)); }
  }
  throw new Error(`timed out waiting for ${path}`);
}

function collectChild(child) {
  return new Promise((resolveExit) => {
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      killChildTree(child);
      resolveExit({ status: null, signal: 'TEST_TIMEOUT', stdout, stderr: `${stderr}\nlauncher test timed out` });
    }, 45_000);
    timer.unref();
    child.once('exit', (code, signal) => { clearTimeout(timer); resolveExit({ status: code, signal, stdout, stderr }); });
  });
}

function killChildTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
    // taskkill reports failure when one descendant exits during traversal even
    // after it terminated the requested parent. A direct fallback is bounded to
    // this fixture-owned process; the awaited exit remains the authoritative proof.
    if (result.status !== 0) try { child.kill('SIGKILL'); } catch { /* already exited */ }
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function normalRuntimeFixture(t, { crashAt = '', pauseAt = '', injectAt = '', injectScript = '',
  injectArtifact = '', injectHostConfig = false, injectDangling = false } = {}) {
  const nativeRoot = await mkdtemp(join(tmpdir(), 'booking-runtime-normal-'));
  const host = (suffix) => join(nativeRoot, suffix);
  const docker = host('usr/bin/docker'); const compose = host('usr/bin/docker-compose');
  const started = host('docker-started'); const release = host('docker-release'); const exitCode = host('docker-exit-code');
  const createMode = host('docker-create-mode'); const startMode = host('docker-start-mode');
  const plan = host('docker-run-plan'); const environment = host('docker-environment'); const runCount = host('docker-run-count');
  const record = host('docker-record');
  const pauseMarker = host('launcher-checkpoint-paused'); const pauseRelease = host('launcher-checkpoint-release');
  const lock = host('usr/local/libexec/.happybooking-control-plane-runtime.lock');
  const children = new Set();
  let injectSymlinkSource = '';
  if (injectArtifact) {
    const artifactPath = shellPath(host(`usr/local/libexec/${injectArtifact}`));
    injectAt = 'fixed-lock-linked';
    if (injectDangling) {
      injectSymlinkSource = host('dangling-conflict-source');
      injectScript = `mv '${shellPath(injectSymlinkSource)}' '${artifactPath}'`;
    } else injectScript = `printf '%s\\n' busy > '${artifactPath}'`;
  }
  if (injectHostConfig) {
    const configPath = shellPath(host('usr/local/libexec/happybooking/control-plane/ops/release/.host-docker-empty'));
    injectAt = 'fixed-lock-linked';
    if (injectDangling) {
      injectSymlinkSource = host('dangling-config-source');
      injectScript = `mv '${shellPath(injectSymlinkSource)}' '${configPath}'`;
    } else injectScript = `printf '%s\\n' '{}' > '${configPath}'`;
  }
  for (const directory of ['usr/bin', 'usr/local/bin', 'usr/local/libexec/happybooking/control-plane/ops/release',
    'var/lib/happybooking', 'volume1/happybooking/booking-preprod/.g4', 'etc/happybooking/trust',
    'etc/happybooking/secrets', 'proc/self', 'proc/sys/kernel/random', 'var/run']) await mkdir(host(directory), { recursive: true });
  if (injectSymlinkSource) await symlink('missing-conflict-target', injectSymlinkSource);
  for (const file of ['manage-deploy-state.mjs', 'execute-fenced-action.mjs']) await writeFile(host(`usr/local/libexec/happybooking/control-plane/ops/release/${file}`), '');
  await writeFile(compose, ''); await writeFile(host('usr/local/bin/cosign'), '#!/bin/sh\nexit 0\n');
  await chmod(host('usr/local/bin/cosign'), 0o500);
  await writeFile(host('etc/happybooking/trust/cosign-preprod.pub'), 'test');
  await writeFile(host('etc/happybooking/trust/cosign-preprod.pub.sha256'), 'test');
  await writeFile(host('etc/happybooking/secrets/booking-preprod-control-plane.env'), 'TEST=1\n');
  await writeFile(host('var/run/docker.sock'), 'test socket');
  await writeFile(host('proc/sys/kernel/random/boot_id'), '11111111-1111-1111-1111-111111111111\n');
  await writeFile(host('proc/self/stat'), `1 (runtime-owner) ${['S', ...Array(18).fill('0'), '7777'].join(' ')}\n`);
  const expectedConfig = shellPath(host('usr/local/libexec/happybooking/control-plane/ops/release/.host-docker-empty'));
  await writeFile(docker, `#!/bin/sh
set -eu
printf '%s\\n' "HOST=$DOCKER_HOST" "CONFIG=$DOCKER_CONFIG" "HOME=$HOME" "CONTEXT=\${DOCKER_CONTEXT:-}" "TLS=\${DOCKER_TLS:-}" "TLS_VERIFY=\${DOCKER_TLS_VERIFY:-}" "CERT=\${DOCKER_CERT_PATH:-}" "API=\${DOCKER_API_VERSION:-}" "AUTH=\${DOCKER_AUTH_CONFIG:-}" "HEADERS=\${DOCKER_CUSTOM_HEADERS:-}" "TRUST=\${DOCKER_CONTENT_TRUST:-}" "TRUST_SERVER=\${DOCKER_CONTENT_TRUST_SERVER:-}" "PLATFORM=\${DOCKER_DEFAULT_PLATFORM:-}" "BUILDKIT=\${BUILDKIT_HOST:-}" "COMPOSE=\${COMPOSE_FILE:-}" "PRELOAD=\${LD_PRELOAD:-}" "LIBRARY=\${LD_LIBRARY_PATH:-}" > '${shellPath(environment)}'
[ "$DOCKER_HOST" = 'unix:///var/run/docker.sock' ]
[ "$DOCKER_CONFIG" = '${expectedConfig}' ]
[ "$HOME" = '/root' ]
[ -z "\${DOCKER_CONTEXT:-}\${DOCKER_TLS:-}\${DOCKER_TLS_VERIFY:-}\${DOCKER_CERT_PATH:-}\${DOCKER_API_VERSION:-}\${DOCKER_AUTH_CONFIG:-}\${DOCKER_CUSTOM_HEADERS:-}\${DOCKER_CONTENT_TRUST:-}\${DOCKER_CONTENT_TRUST_SERVER:-}\${DOCKER_DEFAULT_PLATFORM:-}\${BUILDKIT_HOST:-}\${COMPOSE_FILE:-}\${LD_PRELOAD:-}\${LD_LIBRARY_PATH:-}" ]
[ "$1" = '--host' ] && [ "$2" = 'unix:///var/run/docker.sock' ] || exit 1
[ "$3" = '--config' ] && [ "$4" = '${expectedConfig}' ] || exit 1
shift 4
case "$1:$2" in
  version:--format) printf '%s\\n' '24.0.0' ;;
  container:inspect)
    [ -f '${shellPath(record)}' ] || exit 1
    IFS='|' read -r id name status running code image label < '${shellPath(record)}'
    ref=''; for ref do :; done
    [ "$ref" = "$id" ] || [ "$ref" = "\${name#/}" ] || exit 1
    printf '%s|%s|%s|%s|%s|%s|%s\\n' "$id" "$name" "$status" "$running" "$code" "$image" "$label"
    ;;
  ps:-a)
    [ -f '${shellPath(record)}' ] || exit 0
    IFS='|' read -r id name status running code image label < '${shellPath(record)}'
    filter=''; previous=''; for value do [ "$previous" = '--filter' ] && filter=$value; previous=$value; done
    case "$filter" in
      name=*) [ "$filter" = "name=^/\${name#/}$" ] && printf '%s\\n' "$id" ;;
      label=uk.happybooking.runtime-lock-digest) [ -n "$label" ] && printf '%s\\n' "$id" ;;
      label=uk.happybooking.runtime-lock-digest=*) [ "$label" = "\${filter##*=}" ] && printf '%s\\n' "$id" ;;
      *) exit 1 ;;
    esac
    ;;
  container:create)
    printf '%s\\n' "$@" > '${shellPath(plan)}'
    printf 'create\\n' >> '${shellPath(runCount)}'
    name=''; label=''; previous=''
    for value do
      [ "$previous" = '--name' ] && name=$value
      [ "$previous" = '--label' ] && label=\${value#*=}
      previous=$value
    done
    id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    printf '%s|/%s|created|false|0|%s|%s\\n' "$id" "$name" '${IMAGE}' "$label" > '${shellPath(record)}'
    mode='ok'; [ ! -f '${shellPath(createMode)}' ] || mode=$(cat '${shellPath(createMode)}')
    case "$mode" in ok) printf '%s\\n' "$id" ;; nonzero) exit 9 ;; empty) : ;; multiline) printf '%s\\n%s\\n' "$id" warning ;; *) exit 1 ;; esac
    ;;
  container:start)
    [ "$3" = '--attach' ] || exit 1
    IFS='|' read -r id name status running code image label < '${shellPath(record)}'
    [ "$4" = "$id" ] || exit 1
    mode='exited'; [ ! -f '${shellPath(startMode)}' ] || mode=$(cat '${shellPath(startMode)}')
    case "$mode" in
      created) exit 9 ;;
      running) printf '%s|%s|running|true|0|%s|%s\\n' "$id" "$name" "$image" "$label" > '${shellPath(record)}'; exit 9 ;;
      inconsistent) printf '%s|%s|running|false|0|%s|%s\\n' "$id" "$name" "$image" "$label" > '${shellPath(record)}'; exit 9 ;;
      exited) ;;
      *) exit 1 ;;
    esac
    printf '%s|%s|running|true|0|%s|%s\\n' "$id" "$name" "$image" "$label" > '${shellPath(record)}'
    : > '${shellPath(started)}'
    exec >/dev/null 2>/dev/null
    while [ ! -f '${shellPath(release)}' ]; do sleep 0.02; done
    code=0; if [ -f '${shellPath(exitCode)}' ]; then code=$(cat '${shellPath(exitCode)}'); fi
    printf '%s|%s|exited|false|%s|%s|%s\\n' "$id" "$name" "$code" "$image" "$label" > '${shellPath(record)}'
    exit "$code"
    ;;
  container:rm) rm '${shellPath(record)}'; printf '%s\\n' "$3" ;;
  *) exit 1 ;;
esac
`);
  await chmod(docker, 0o500);
  const harness = await writeLauncherHarness(nativeRoot, { normal: true, crashAt, pauseAt, pauseMarker, pauseRelease,
    injectAt, injectScript });
  const recoveryHarness = await writeLauncherHarness(nativeRoot);
  const argv = ['manage-deploy-state', '--action', 'init', '--execute', 'true', '--environment', 'preprod', '--project', 'booking-preprod'];
  const launch = (extraEnv = {}) => {
    const trace = extraEnv.RUNTIME_HARNESS_TRACE; const cleanEnv = { ...extraEnv }; delete cleanEnv.RUNTIME_HARNESS_TRACE;
    const child = spawn(shell, [...(trace ? ['-x'] : []), harness, ...argv], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, BOOKING_CONTROL_PLANE_DRY_RUN: '', ...cleanEnv } });
    children.add(child); child.once('exit', () => children.delete(child)); return child;
  };
  const recover = (lockDigest, recoveryId = 'runtime-recovery-normal-crash-1') => spawnSync(shell,
    [recoveryHarness, 'recover-stale-runtime-lock', '--action', 'recover-runtime-lock', '--execute', 'true',
      '--environment', 'preprod', '--project', 'booking-preprod', '--expected-lock-digest', lockDigest,
      '--recovery-id', recoveryId],
    { cwd: root, encoding: 'utf8', env: { ...process.env, BOOKING_CONTROL_PLANE_DRY_RUN: '' } });
  t.after(async () => {
    // Let any fixture Docker descendant that outlived an intentionally killed
    // launcher observe its bounded release marker before removing the tree.
    await writeFile(release, 'fixture-cleanup').catch(() => {});
    await writeFile(pauseRelease, 'fixture-cleanup').catch(() => {});
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    for (const child of children) killChildTree(child);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    await rm(nativeRoot, { recursive: true, force: true });
  });
  return { nativeRoot, lock, started, release, exitCode, createMode, startMode, plan, environment, runCount, record,
    pauseMarker, pauseRelease, argv, launch, recover };
}

function mounts(argv) {
  return argv.flatMap((value, index) => value === '--mount' ? [argv[index + 1]] : []);
}

const BASE_MOUNTS = [
  'type=bind,src=/var/lib/happybooking,dst=/var/lib/happybooking',
  'type=bind,src=/volume1/happybooking/booking-preprod,dst=/volume1/happybooking/booking-preprod,readonly',
  'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
  'type=bind,src=/var/packages/ContainerManager/target/usr/bin/docker,dst=/var/packages/ContainerManager/target/usr/bin/docker,readonly',
  'type=bind,src=/var/packages/ContainerManager/target/usr/bin/docker-compose,dst=/root/.docker/cli-plugins/docker-compose,readonly',
  'type=bind,src=/usr/local/libexec/happybooking/control-plane,dst=/usr/local/libexec/happybooking/control-plane,readonly',
  'type=bind,src=/usr/local/bin/cosign,dst=/usr/local/bin/cosign,readonly',
  'type=bind,src=/etc/happybooking/trust/cosign-preprod.pub,dst=/etc/happybooking/trust/cosign-preprod.pub,readonly',
  'type=bind,src=/etc/happybooking/trust/cosign-preprod.pub.sha256,dst=/etc/happybooking/trust/cosign-preprod.pub.sha256,readonly',
  'type=bind,src=/etc/happybooking/secrets/booking-preprod-control-plane.env,dst=/etc/happybooking/secrets/booking-preprod-control-plane.env,readonly',
];

const INGRESS_MOUNTS = [
  'type=bind,src=/usr/local/libexec/happybooking/switch-preprod-ingress,dst=/usr/local/libexec/happybooking/switch-preprod-ingress,readonly',
  'type=bind,src=/usr/local/libexec/happybooking/switch-preprod-ingress.mjs,dst=/usr/local/libexec/happybooking/switch-preprod-ingress.mjs,readonly',
];

const LEGACY_NGINX_MOUNT = 'type=bind,src=/volume1/homes/realzyq/booking-preprod/releases/booking-20260908T202714Z-317be4dec675/source/frontend/nginx.preprod.conf,dst=/volume1/homes/realzyq/booking-preprod/releases/booking-20260908T202714Z-317be4dec675/source/frontend/nginx.preprod.conf,readonly';

const BACKUP_RW_MOUNTS = [
  'type=bind,src=/volume1/happybooking/booking-preprod/.g4/backups,dst=/volume1/happybooking/booking-preprod/.g4/backups',
  'type=bind,src=/volume1/happybooking/booking-preprod/.g4/receipts,dst=/volume1/happybooking/booking-preprod/.g4/receipts',
];
const RECEIPT_RW_MOUNT = 'type=bind,src=/volume1/happybooking/booking-preprod/.g4/receipts,dst=/volume1/happybooking/booking-preprod/.g4/receipts';

const common = ['--execute', 'true', '--environment', 'preprod', '--project', 'booking-preprod',
  '--approval-id', 'approval-1', '--expected-generation', '3', '--expected-fencing-epoch', '7',
  '--manifest-digest', `sha256:${'a'.repeat(64)}`];

test('control-plane launcher builds the fixed hardened Docker plan for the state manager', () => {
  const result = dryRun(['manage-deploy-state', '--action', 'renew', ...common, '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--lease-duration-ms', '300000', '--observation-window-minutes', '30']);
  assert.equal(result.status, 0, result.stderr);
  const argv = result.stdout.trim().split(/\r?\n/);
  assert.equal(argv[0], '/var/packages/ContainerManager/target/usr/bin/docker');
  assert.ok(argv.includes(IMAGE));
  assert.ok(argv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/manage-deploy-state.mjs'));
  assert.deepEqual(argv.slice(1, 10), ['--host', 'unix:///var/run/docker.sock', '--config',
    '/usr/local/libexec/happybooking/control-plane/ops/release/.host-docker-empty', 'container', 'create', '--pull', 'never', '--name']);
  for (const expected of ['host', '0:0', 'ALL', 'no-new-privileges:true', '/usr/local/bin/node']) assert.ok(argv.includes(expected));
  for (const expected of ['HOME=/root', 'NODE_OPTIONS=', 'NODE_PATH=', 'LD_PRELOAD=', 'DOCKER_HOST=unix:///var/run/docker.sock', 'DOCKER_CONFIG=/root/.docker']) assert.ok(argv.includes(expected));
  assert.ok(argv.includes('type=bind,src=/var/lib/happybooking,dst=/var/lib/happybooking'));
  assert.ok(argv.includes('type=bind,src=/volume1/happybooking/booking-preprod,dst=/volume1/happybooking/booking-preprod,readonly'));
  assert.ok(argv.includes('type=bind,src=/usr/local/bin/cosign,dst=/usr/local/bin/cosign,readonly'));
  assert.ok(argv.includes('type=bind,src=/etc/happybooking/trust/cosign-preprod.pub,dst=/etc/happybooking/trust/cosign-preprod.pub,readonly'));
  assert.ok(argv.includes('type=bind,src=/etc/happybooking/trust/cosign-preprod.pub.sha256,dst=/etc/happybooking/trust/cosign-preprod.pub.sha256,readonly'));
  assert.ok(argv.includes('type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock'));
  assert.ok(argv.includes('type=bind,src=/var/packages/ContainerManager/target/usr/bin/docker,dst=/var/packages/ContainerManager/target/usr/bin/docker,readonly'));
  assert.ok(argv.includes('type=bind,src=/var/packages/ContainerManager/target/usr/bin/docker-compose,dst=/root/.docker/cli-plugins/docker-compose,readonly'));
  assert.ok(argv.includes('type=bind,src=/usr/local/libexec/happybooking/control-plane,dst=/usr/local/libexec/happybooking/control-plane,readonly'));
  assert.ok(argv.includes('--read-only'));
  assert.equal(argv[argv.indexOf('--cap-drop') + 1], 'ALL');
  assert.equal(argv[argv.indexOf('--security-opt') + 1], 'no-new-privileges:true');
  assert.equal(argv[argv.indexOf('--tmpfs') + 1], '/tmp:rw,nosuid,nodev,noexec,size=64m');
  assert.ok(argv.includes('/root/.docker:rw,nosuid,nodev,noexec,size=1m'));
  for (const name of ['DOCKER_CONTEXT=', 'DOCKER_TLS=', 'DOCKER_TLS_VERIFY=', 'DOCKER_CERT_PATH=', 'DOCKER_API_VERSION=',
    'DOCKER_AUTH_CONFIG=', 'DOCKER_CUSTOM_HEADERS=', 'DOCKER_CONTENT_TRUST=', 'DOCKER_CONTENT_TRUST_SERVER=',
    'DOCKER_DEFAULT_PLATFORM=', 'BUILDKIT_HOST=', 'COMPOSE_FILE=', 'COMPOSE_ENV_FILES=', 'LD_LIBRARY_PATH=']) assert.ok(argv.includes(name), name);
  assert.equal(argv.includes('--pids-limit'), false, 'Synology without a PID controller must not receive --pids-limit');
  assert.equal(argv[argv.indexOf('--pid') + 1], 'host', 'lock owner PIDs must be interpreted in the host PID namespace');
  assert.equal(argv.some((value) => value.includes('src=/etc/happybooking/secrets,dst=')), false);
  assert.equal(argv.some((value) => value.includes('src=/usr/local/libexec/happybooking,dst=')), false);
  assert.deepEqual(mounts(argv), BASE_MOUNTS);
  assert.equal(argv[argv.indexOf('--env-file') + 1], '/etc/happybooking/secrets/booking-preprod-control-plane.env');
  assert.deepEqual(argv.slice(argv.indexOf('--observation-window-minutes'), argv.indexOf('--observation-window-minutes') + 2), ['--observation-window-minutes', '30']);
});

test('state recovery transition and fresh acquire forward the exact 30-minute observation contract', () => {
  for (const [action, extra] of [
    ['transition', ['--to', 'FAILED_RECOVERED']],
    ['acquire', ['--operation-id', 'g4.new.operation', '--lease-id', 'lease-new', '--holder-id', 'holder-new', '--lease-duration-ms', '300000']],
  ]) {
    const result = dryRun(['manage-deploy-state', '--action', action, ...common, '--observation-window-minutes', '30', ...extra]);
    assert.equal(result.status, 0, `${action}: ${result.stderr}`); const argv = result.stdout.trim().split(/\r?\n/);
    assert.equal(argv.filter((value) => value === '--observation-window-minutes').length, 1, action);
    assert.equal(argv[argv.indexOf('--observation-window-minutes') + 1], '30', action);
    assert.ok(argv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/manage-deploy-state.mjs'), action);
  }
  const duplicate = dryRun(['manage-deploy-state', '--action', 'acquire', ...common, '--observation-window-minutes', '30', '--observation-window-minutes', '30']);
  assert.notEqual(duplicate.status, 0); assert.equal(duplicate.stdout, '');
});

test('control-plane launcher maps only the fenced executor and preserves argument boundaries', () => {
  const result = dryRun(['execute-fenced-action', '--action', 'preprod-stage', ...common,
    '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1',
    '--resource-id', 'booking-preprod-edge', '--action-id', 'stage-1']);
  assert.equal(result.status, 0, result.stderr);
  const argv = result.stdout.trim().split(/\r?\n/);
  assert.ok(argv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/execute-fenced-action.mjs'));
  assert.equal(argv.includes('/bin/sh'), false);
  assert.equal(argv.includes('-c'), false);
  assert.equal(argv.filter((value) => value === '--action').length, 1);
  assert.deepEqual(mounts(argv), BASE_MOUNTS, 'staging must not depend on Cloudflare helper or token files');
});

test('stale-lock recovery uses a separate fixed container identity so a stopped owner can be inspected', () => {
  const result = dryRun(['recover-stale-fencing-lock', '--action', 'recover-deploy-lock', '--execute', 'true',
    '--environment', 'preprod', '--project', 'booking-preprod', '--expected-state-digest', `sha256:${'a'.repeat(64)}`,
    '--expected-lock-digest', `sha256:${'b'.repeat(64)}`]);
  assert.equal(result.status, 0, result.stderr);
  const argv = result.stdout.trim().split(/\r?\n/);
  assert.equal(argv[argv.indexOf('--name') + 1], 'booking-preprod-lock-recovery');
  assert.ok(argv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/recover-stale-fencing-lock.mjs'));
});

test('only forward and rollback ingress receive the self-contained local alias helper without a Cloudflare API token mount', () => {
  for (const action of ['preprod-switch-ingress', 'preprod-rollback-ingress']) {
    const result = dryRun(['execute-fenced-action', '--action', action, ...common,
      '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1',
      '--resource-id', 'ingress:booking-preprod', '--action-id', 'ingress-1']);
    assert.equal(result.status, 0, result.stderr);
    const argv = result.stdout.trim().split(/\r?\n/);
    assert.deepEqual(mounts(argv), [...BASE_MOUNTS, ...INGRESS_MOUNTS]);
  }
});

test('only fixed active-runtime recovery receives the read-only legacy Nginx source', () => {
  const actionArgs = (action) => ['execute-fenced-action', '--action', action, ...common,
    '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1',
    '--resource-id', 'booking-preprod-edge', '--action-id', 'recovery-1'];
  const restored = dryRun(actionArgs('preprod-restore-active-runtime'));
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(mounts(restored.stdout.trim().split(/\r?\n/)), [...BASE_MOUNTS, LEGACY_NGINX_MOUNT]);
  const other = dryRun(actionArgs('preprod-stage'));
  assert.equal(other.status, 0, other.stderr);
  assert.deepEqual(mounts(other.stdout.trim().split(/\r?\n/)), BASE_MOUNTS);
});

test('init, baseline, migration, staging, and webhook plans have no Cloudflare token dependency', () => {
  const cases = [
    ['manage-deploy-state', '--action', 'init', ...common],
    ['execute-fenced-action', '--action', 'preprod-baseline-ledger', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'database:booking-preprod', '--action-id', 'baseline-1'],
    ['execute-fenced-action', '--action', 'preprod-expand-migrate', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'database:booking-preprod', '--action-id', 'migrate-1'],
    ['execute-fenced-action', '--action', 'preprod-stage', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'booking-preprod-edge', '--action-id', 'stage-1'],
    ['execute-fenced-action', '--action', 'preprod-transfer-singletons', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'booking-preprod-edge', '--action-id', 'singletons-1'],
    ['execute-fenced-action', '--action', 'preprod-rollback-singletons', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'booking-preprod-edge', '--action-id', 'rollback-singletons-1'],
    ['execute-fenced-action', '--action', 'preprod-set-webhook', ...common, '--operation-id', 'op-1', '--lease-id', 'lease-1', '--holder-id', 'owner-1', '--resource-id', 'telegram:booking-preprod', '--action-id', 'webhook-1'],
  ];
  for (const input of cases) {
    const result = dryRun(input);
    assert.equal(result.status, 0, result.stderr);
    const argv = result.stdout.trim().split(/\r?\n/);
    assert.deepEqual(mounts(argv), BASE_MOUNTS);
    assert.equal(argv.some((value) => value.includes('cloudflare-preprod-api-token')), false);
    assert.equal(argv.some((value) => value.includes('switch-preprod-ingress')), false);
  }
});

test('backup symbolic entrypoint constructs only canonical release/evidence paths and exact nested RW mounts', () => {
  const base = ['--execute', 'true', '--environment', 'preprod', '--project', 'booking-preprod', '--operation-id', 'g4-op-1',
    '--approval-id', 'approval-1', '--expected-generation', '3', '--expected-fencing-epoch', '1', '--manifest-digest', `sha256:${'9'.repeat(64)}`, '--lease-id', 'lease-1', '--holder-id', 'owner-1'];
  const created = dryRun(['generate-database-backup-receipt', '--action', 'create', '--identity', 'old',
    '--release-id', 'booking-20260908T202714Z-317be4dec675', ...base]);
  assert.equal(created.status, 0, created.stderr);
  const createArgv = created.stdout.trim().split(/\r?\n/);
  assert.ok(createArgv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/generate-database-backup-receipt.mjs'));
  assert.ok(createArgv.includes('/volume1/happybooking/booking-preprod/releases/booking-20260908T202714Z-317be4dec675/release-manifest.json'));
  assert.ok(createArgv.includes('/volume1/happybooking/booking-preprod/.g4/backups/g4-op-1.dump'));
  assert.ok(createArgv.includes('/volume1/happybooking/booking-preprod/.g4/receipts/g4-op-1-old-backup.json'));
  assert.equal(createArgv[createArgv.indexOf('--expected-generation') + 1], '3');
  assert.deepEqual(mounts(createArgv), [...BASE_MOUNTS, ...BACKUP_RW_MOUNTS]);

  const candidate = 'booking-20260909T010203Z-acde123';
  const digest = `sha256:${'d'.repeat(64)}`;
  const bound = dryRun(['generate-database-backup-receipt', '--action', 'bind-existing', '--identity', 'candidate',
    '--release-id', candidate, '--expected-backup-digest', digest, ...base]);
  assert.equal(bound.status, 0, bound.stderr);
  const bindArgv = bound.stdout.trim().split(/\r?\n/);
  assert.ok(bindArgv.includes(`/volume1/happybooking/booking-preprod/releases/${candidate}/release-manifest.json`));
  assert.ok(bindArgv.includes(digest));
  assert.ok(bindArgv.includes('/volume1/happybooking/booking-preprod/.g4/receipts/g4-op-1-candidate-backup.json'));
  assert.deepEqual(mounts(bindArgv), [...BASE_MOUNTS, ...BACKUP_RW_MOUNTS]);
  assert.equal(bindArgv.some((value) => value.includes('cloudflare-preprod-api-token')), false);
});

test('schema-diff symbolic entrypoint fixes the legacy manifest/slot and grants only receipt RW', () => {
  const result = dryRun(['generate-schema-diff-receipt', '--action', 'generate', '--execute', 'true', '--environment', 'preprod',
    '--project', 'booking-preprod', '--operation-id', 'g4-op-2', '--approval-id', 'approval-1', '--expected-fencing-epoch', '1',
    '--expected-generation', '3',
    '--manifest-digest', `sha256:${'9'.repeat(64)}`, '--lease-id', 'lease-1', '--holder-id', 'owner-1']);
  assert.equal(result.status, 0, result.stderr);
  const argv = result.stdout.trim().split(/\r?\n/);
  assert.ok(argv.includes('/usr/local/libexec/happybooking/control-plane/ops/release/generate-schema-diff-receipt.mjs'));
  assert.equal(argv[argv.indexOf('--identity') + 1], 'old');
  assert.equal(argv[argv.indexOf('--slot') + 1], 'green');
  assert.ok(argv.includes('/volume1/happybooking/booking-preprod/releases/booking-20260908T202714Z-317be4dec675/release-manifest.json'));
  assert.ok(argv.includes('/volume1/happybooking/booking-preprod/.g4/receipts/g4-op-2-old-zero-diff.json'));
  assert.deepEqual(mounts(argv), [...BASE_MOUNTS, RECEIPT_RW_MOUNT]);
});

test('evidence symbolic entrypoints reject caller paths, wrong identities, and malformed release/digest values', () => {
  const commonEvidence = ['--execute', 'true', '--environment', 'preprod', '--project', 'booking-preprod', '--operation-id', 'g4-op-3',
    '--approval-id', 'approval-1', '--expected-generation', '3', '--expected-fencing-epoch', '1', '--manifest-digest', `sha256:${'9'.repeat(64)}`, '--lease-id', 'lease-1', '--holder-id', 'owner-1'];
  const cases = [
    ['generate-database-backup-receipt', '--action', 'create', '--identity', 'old', '--release-id', 'booking-20260909T010203Z-acde123', ...commonEvidence],
    ['generate-database-backup-receipt', '--action', 'create', '--identity', 'old', '--release-id', 'booking-20260908T202714Z-317be4dec675', '--manifest', '/tmp/manifest.json', ...commonEvidence],
    ['generate-database-backup-receipt', '--action', 'bind-existing', '--identity', 'candidate', '--release-id', 'booking-invalid', '--expected-backup-digest', `sha256:${'d'.repeat(64)}`, ...commonEvidence],
    ['generate-database-backup-receipt', '--action', 'bind-existing', '--identity', 'candidate', '--release-id', 'booking-20260909T010203Z-acde123', '--expected-backup-digest', `sha256:${'z'.repeat(64)}`, ...commonEvidence],
    ['generate-schema-diff-receipt', '--action', 'generate', '--receipt-path', 'forged.json', ...commonEvidence],
  ];
  for (const input of cases) {
    const result = dryRun(input);
    assert.notEqual(result.status, 0, `unexpectedly accepted ${input.join(' ')}`);
    assert.equal(result.stdout, '');
  }
});

test('control-plane launcher rejects commands, paths, metacharacters, duplicates, and scope escape before Docker', () => {
  const cases = [
    ['sh', ...common],
    ['../execute-fenced-action', ...common],
    ['execute-fenced-action', '--action', 'preprod-stage;id', ...common.slice(2)],
    ['execute-fenced-action', '--action', 'preprod-stage', ...common, '--resource-id', '/var/run/docker.sock'],
    ['execute-fenced-action', '--action', 'preprod-stage', ...common, '--project', 'booking-prod'],
    ['execute-fenced-action', '--action', 'preprod-stage', ...common, '--manifest-digest', `sha256:${'b'.repeat(64)}`],
    ['manage-deploy-state', '--action', 'renew', ...common, '--state', 'deploy-state.json'],
    ['manage-deploy-state', '--action', 'complete', ...common],
    ['manage-deploy-state', '--action', 'renew', ...common, '--execute', 'false'],
  ];
  for (const argv of cases) {
    const result = dryRun(argv);
    assert.notEqual(result.status, 0, `unexpectedly accepted: ${argv.join(' ')}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /rejected the request/);
  }
});

test('runtime-lock recovery rejects non-lowercase and path-bearing digest arguments before lookup', () => {
  for (const digest of [`sha256:${'A'.repeat(64)}`, `sha256:/${'a'.repeat(63)}`]) {
    const result = dryRun(['recover-stale-runtime-lock', '--action', 'recover-runtime-lock', '--execute', 'true',
      '--environment', 'preprod', '--project', 'booking-preprod', '--expected-lock-digest', digest,
      '--recovery-id', 'runtime-recovery-test-1']);
    assert.equal(result.status, 64);
    assert.equal(result.stdout, '');
  }
});

test('v2 recovery publishes prepared intent before exact-ID removal and final pass after lock unlink', async (t) => {
  const fixture = await runtimeRecoveryFixture(t);
  await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|exited|false|7|${IMAGE}|${fixture.lockDigest}\n`);
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(fixture.lock));
  await assert.rejects(access(fixture.record));
  const intent = await readStableCanonical(join(fixture.txn, 'recovery-intent.json'));
  const final = await readStableCanonical(join(fixture.txn, 'final.json'));
  assert.equal(intent.status, 'prepared');
  assert.equal(intent.containerId, fixture.containerId);
  assert.equal(final.cleanupStatus, 'pass');
  assert.equal(final.businessOutcome, 'failed');
  assert.equal(final.recoveryIntentDigest, intent.recoveryIntentDigest);
  assert.equal(final.observedExitCode, '7');
  await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|exited|false|7|${IMAGE}|${fixture.lockDigest}\n`);
  assert.equal(fixture.run().status, 64, 'final replay must freshly reject a reappeared container');
  assert.equal((await readFile(fixture.record, 'utf8')).startsWith(fixture.containerId), true);
  await rm(fixture.record);
  const changed = [...fixture.argv]; changed[changed.length - 1] = 'runtime-recovery-test-2';
  assert.equal(fixture.run({}, changed).status, 64);
});

test('v2 recovery replays every authoritative crash boundary', async (t) => {
  for (const crashAt of ['record-stage-created', 'record-source-written', 'record-source-chmodded', 'record-source-synced',
    'record-stage-synced', 'record-linked', 'record-parent-synced', 'record-source-unlinked',
    'recovery-intent-published', 'container-removed', 'fixed-lock-unlinked']) {
    await t.test(crashAt, async (st) => {
      const fixture = await runtimeRecoveryFixture(st);
      await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|exited|false|7|${IMAGE}|${fixture.lockDigest}\n`);
      const crashed = fixture.run({ BOOKING_CONTROL_PLANE_RUNTIME_LOCK_TEST_CRASH_AT: crashAt });
      assert.equal(crashed.status, 75, crashed.stderr);
      const replay = fixture.run();
      assert.equal(replay.status, 0, replay.stderr);
      await assert.rejects(access(fixture.lock));
      assert.equal((await readStableCanonical(join(fixture.txn, 'final.json'))).cleanupStatus, 'pass');
    });
  }
});

test('record publisher repairs only recognized private partial stages and freezes unknown stage contents', async (t) => {
  await t.test('partial mode-600 record', async (st) => {
    const fixture = await runtimeRecoveryFixture(st);
    const crashed = fixture.run({ BOOKING_CONTROL_PLANE_RUNTIME_LOCK_TEST_CRASH_AT: 'record-source-written' });
    assert.equal(crashed.status, 75, crashed.stderr);
    const stage = (await readdir(fixture.txn)).find((name) => name.startsWith('recovery-intent.json.publish-'));
    assert.ok(stage);
    const source = join(fixture.txn, stage, 'record.json');
    await chmod(source, 0o600); await writeFile(source, '{partial');
    const replay = fixture.run();
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal((await readStableCanonical(join(fixture.txn, 'final.json'))).cleanupStatus, 'pass');
  });
  await t.test('unknown link count', async (st) => {
    const fixture = await runtimeRecoveryFixture(st);
    assert.equal(fixture.run({ BOOKING_CONTROL_PLANE_RUNTIME_LOCK_TEST_CRASH_AT: 'record-source-written' }).status, 75);
    const stage = (await readdir(fixture.txn)).find((name) => name.startsWith('recovery-intent.json.publish-'));
    const source = join(fixture.txn, stage, 'record.json');
    await link(source, join(fixture.txn, 'unknown-hardlink'));
    const before = await readFile(source, 'utf8');
    assert.equal(fixture.run().status, 64);
    assert.equal(await readFile(source, 'utf8'), before);
  });
  await t.test('unexpected extra entry', async (st) => {
    const fixture = await runtimeRecoveryFixture(st);
    assert.equal(fixture.run({ BOOKING_CONTROL_PLANE_RUNTIME_LOCK_TEST_CRASH_AT: 'record-stage-created' }).status, 75);
    const stage = (await readdir(fixture.txn)).find((name) => name.startsWith('recovery-intent.json.publish-'));
    await writeFile(join(fixture.txn, stage, 'unknown'), 'forensic');
    assert.equal(fixture.run().status, 64);
    assert.equal(await readFile(join(fixture.txn, stage, 'unknown'), 'utf8'), 'forensic');
  });
});

test('v2 recovery rejects live owners, malformed canonical bytes, running containers and replacements', async (t) => {
  await t.test('live owner', async (st) => {
    const fixture = await runtimeRecoveryFixture(st, { ownerBoot: '11111111-1111-1111-1111-111111111111' });
    assert.equal(fixture.run().status, 64);
  });
  await t.test('extra newline', async (st) => {
    const fixture = await runtimeRecoveryFixture(st);
    await chmod(join(fixture.txn, 'intent.json'), 0o600);
    await writeFile(fixture.lock, `${await readFile(fixture.lock, 'utf8')}\n`);
    await chmod(join(fixture.txn, 'intent.json'), 0o400);
    assert.equal(fixture.run().status, 64);
  });
  await t.test('running', async (st) => {
    const fixture = await runtimeRecoveryFixture(st);
    await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|running|true|0|${IMAGE}|${fixture.lockDigest}\n`);
    assert.equal(fixture.run().status, 64);
    assert.equal((await readFile(fixture.record, 'utf8')).startsWith(fixture.containerId), true);
  });
  for (const record of [
    `running|false|0`,
    `exited|true|7`,
  ]) {
    await t.test(`inconsistent ${record}`, async (st) => {
      const fixture = await runtimeRecoveryFixture(st);
      await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|${record}|${IMAGE}|${fixture.lockDigest}\n`);
      assert.equal(fixture.run().status, 64);
      assert.equal((await readFile(fixture.record, 'utf8')).startsWith(fixture.containerId), true);
    });
  }
  await t.test('completion exit drift', async (st) => {
    const fixture = await runtimeRecoveryFixture(st, { withCompletion: true });
    await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|exited|false|8|${IMAGE}|${fixture.lockDigest}\n`);
    assert.equal(fixture.run().status, 64);
    assert.equal((await readFile(fixture.record, 'utf8')).includes('|8|'), true);
  });
  await t.test('same-name replacement', async (st) => {
    const fixture = await runtimeRecoveryFixture(st);
    const wrong = 'c'.repeat(64);
    await writeFile(fixture.record, `${wrong}|/booking-preprod-control-plane|exited|false|0|${IMAGE}|${fixture.lockDigest}\n`);
    assert.equal(fixture.run().status, 64);
    assert.equal((await readFile(fixture.record, 'utf8')).startsWith(wrong), true);
  });
  for (const [label, status, running] of [['renamed stopped owner', 'exited', 'false'], ['renamed running owner', 'running', 'true']]) {
    await t.test(label, async (st) => {
      const fixture = await runtimeRecoveryFixture(st);
      await writeFile(fixture.record, `${fixture.containerId}|/renamed-owner|${status}|${running}|7|${IMAGE}|${fixture.lockDigest}\n`);
      assert.equal(fixture.run().status, 64);
      assert.match(await readFile(fixture.record, 'utf8'), /renamed-owner/);
    });
  }
  await t.test('multiple exact-label containers', async (st) => {
    const fixture = await runtimeRecoveryFixture(st, { withOwner: false });
    const second = 'c'.repeat(64);
    await writeFile(fixture.record,
      `${fixture.containerId}|/booking-preprod-control-plane|created|false|0|${IMAGE}|${fixture.lockDigest}\n${second}|/other|exited|false|1|${IMAGE}|${fixture.lockDigest}\n`);
    assert.equal(fixture.run().status, 64);
    assert.match(await readFile(fixture.record, 'utf8'), new RegExp(second));
  });
});

test('v2 new launch rejects every pre-existing runtime label and fixed-name orphan before acquisition', async (t) => {
  await t.test('old lock digest orphan', async (st) => {
    const fixture = await normalRuntimeFixture(st);
    await writeFile(fixture.record, `${'c'.repeat(64)}|/old-orphan|exited|false|1|${IMAGE}|sha256:${'d'.repeat(64)}\n`);
    const result = await collectChild(fixture.launch());
    assert.equal(result.status, 64, result.stderr);
    await assert.rejects(access(fixture.lock));
    assert.match(await readFile(fixture.record, 'utf8'), /old-orphan/);
  });
  await t.test('unlabelled fixed name', async (st) => {
    const fixture = await normalRuntimeFixture(st);
    await writeFile(fixture.record, `${'c'.repeat(64)}|/booking-preprod-control-plane|exited|false|1|${IMAGE}|\n`);
    const result = await collectChild(fixture.launch());
    assert.equal(result.status, 64, result.stderr);
    await assert.rejects(access(fixture.lock));
  });
});

test('v2 normal path binds canonical lock and full-ID owner before start, excludes competitors and finalizes', async (t) => {
  const fixture = await normalRuntimeFixture(t);
  const first = fixture.launch({ DOCKER_HOST: 'tcp://attacker:2376', DOCKER_CONTEXT: 'attacker', DOCKER_CONFIG: '/tmp/attacker',
    DOCKER_TLS: '1', DOCKER_TLS_VERIFY: '1', DOCKER_CERT_PATH: '/tmp/certs', DOCKER_API_VERSION: '0.1',
    DOCKER_AUTH_CONFIG: 'attacker', DOCKER_CUSTOM_HEADERS: 'evil=1', DOCKER_CONTENT_TRUST: '1',
    DOCKER_CONTENT_TRUST_SERVER: 'https://attacker', DOCKER_DEFAULT_PLATFORM: 'windows/amd64',
    BUILDKIT_HOST: 'tcp://attacker', COMPOSE_FILE: '/tmp/compose.yml' });
  const firstExit = collectChild(first);
  await Promise.race([waitForPath(fixture.started), firstExit.then((result) => { throw new Error(result.stderr || `launcher exited ${result.status}`); })]);
  const lock = await readStableCanonical(fixture.lock);
  const txn = join(fixture.nativeRoot, `usr/local/libexec/.happybooking-control-plane-runtime-txn-${lock.lockDigest.slice(7)}`);
  const owner = await readStableCanonical(join(txn, 'owner.json'));
  assert.equal(owner.containerId, 'a'.repeat(64));
  assert.equal(owner.lockDigest, lock.lockDigest);
  const plan = (await readFile(fixture.plan, 'utf8')).trim().split(/\r?\n/);
  assert.deepEqual(plan.slice(0, 4), ['container', 'create', '--pull', 'never']);
  assert.equal(plan[plan.indexOf('--label') + 1], `uk.happybooking.runtime-lock-digest=${lock.lockDigest}`);
  const competitor = await collectChild(fixture.launch());
  assert.equal(competitor.status, 64, competitor.stderr);
  assert.equal((await readFile(fixture.runCount, 'utf8')).trim().split(/\r?\n/).length, 1);
  await writeFile(fixture.release, 'go');
  const completed = await firstExit;
  assert.equal(completed.status, 0, completed.stderr);
  await assert.rejects(access(fixture.lock));
  assert.equal((await readStableCanonical(join(txn, 'completion-intent.json'))).status, 'prepared');
  assert.equal((await readStableCanonical(join(txn, 'final.json'))).cleanupStatus, 'pass');
  const received = await readFile(fixture.environment, 'utf8');
  assert.match(received, /^HOST=unix:\/\/\/var\/run\/docker\.sock$/m);
  assert.match(received, /^HOME=\/root$/m);
  for (const name of ['CONTEXT', 'TLS', 'TLS_VERIFY', 'CERT', 'API', 'AUTH', 'HEADERS', 'TRUST', 'TRUST_SERVER',
    'PLATFORM', 'BUILDKIT', 'COMPOSE', 'PRELOAD', 'LIBRARY']) assert.match(received, new RegExp(`^${name}=$`, 'm'));
});

test('v2 normal completion preserves nonzero exit and abrupt death leaves full-ID evidence', async (t) => {
  await t.test('Docker failure', async (st) => {
    const fixture = await normalRuntimeFixture(st);
    await writeFile(fixture.exitCode, '42'); await writeFile(fixture.release, 'go');
    const result = await collectChild(fixture.launch());
    assert.equal(result.status, 42, result.stderr);
    await assert.rejects(access(fixture.lock));
    const txn = (await readdir(join(fixture.nativeRoot, 'usr/local/libexec'))).find((name) => name.startsWith('.happybooking-control-plane-runtime-txn-'));
    const final = await readStableCanonical(join(fixture.nativeRoot, 'usr/local/libexec', txn, 'final.json'));
    assert.equal(final.cleanupStatus, 'pass');
    assert.equal(final.businessOutcome, 'failed');
    assert.equal(final.observedExitCode, '42');
  });
  await t.test('abrupt death', async (st) => {
    const fixture = await normalRuntimeFixture(st);
    const child = fixture.launch(); const exited = collectChild(child);
    await Promise.race([waitForPath(fixture.started), exited.then((result) => { throw new Error(result.stderr || `launcher exited ${result.status}`); })]);
    const intent = await readStableCanonical(fixture.lock);
    const txn = join(fixture.nativeRoot, `usr/local/libexec/.happybooking-control-plane-runtime-txn-${intent.lockDigest.slice(7)}`);
    const evidence = await readFile(join(txn, 'owner.json'), 'utf8');
    assert.equal((await readStableCanonical(join(txn, 'owner.json'))).schema, 'booking.preprod-runtime-owner/v3');
    killChildTree(child);
    await writeFile(fixture.release, 'go');
    const result = await exited;
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(join(txn, 'owner.json'), 'utf8'), evidence);
  });
  await t.test('completion intent crash replay', async (st) => {
    const fixture = await runtimeRecoveryFixture(st, { withCompletion: true });
    const completion = await readStableCanonical(join(fixture.txn, 'completion-intent.json'));
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(access(fixture.lock));
    const final = await readStableCanonical(join(fixture.txn, 'final.json'));
    assert.equal(final.action, 'recovery');
    assert.equal(final.completionDigest, completion.completionDigest);
    assert.equal(final.containerId, fixture.containerId);
    assert.equal(final.observedExitCode, '7');
    assert.equal(final.result, 'absent');
    assert.equal(final.cleanupStatus, 'pass');
  });
});

test('v2 normal completion crash boundaries replay through the recovery state machine', async (t) => {
  for (const crashAt of ['normal-completion-intent-published', 'normal-container-removed', 'normal-lock-unlinked', 'normal-final-published']) {
    await t.test(crashAt, async (st) => {
      const fixture = await normalRuntimeFixture(st, { crashAt });
      const child = fixture.launch(); const exited = collectChild(child);
      await Promise.race([waitForPath(fixture.started), exited.then((result) => { throw new Error(result.stderr || `launcher exited ${result.status}`); })]);
      const lock = await readStableCanonical(fixture.lock);
      const txn = join(fixture.nativeRoot, `usr/local/libexec/.happybooking-control-plane-runtime-txn-${lock.lockDigest.slice(7)}`);
      await writeFile(fixture.release, 'go');
      const crashed = await exited;
      assert.equal(crashed.status, 75, crashed.stderr);
      const replay = fixture.recover(lock.lockDigest);
      assert.equal(replay.status, 0, replay.stderr);
      await assert.rejects(access(fixture.lock));
      await assert.rejects(access(fixture.record));
      const final = await readStableCanonical(join(txn, 'final.json'));
      assert.equal(final.cleanupStatus, 'pass');
      assert.equal(final.completionDigest, (await readStableCanonical(join(txn, 'completion-intent.json'))).completionDigest);
      assert.equal(final.action, crashAt === 'normal-final-published' ? 'normal' : 'recovery');
    });
  }
});

test('v2 acquisition and pre-start crash boundaries replay without starting an unbound container', async (t) => {
  for (const crashAt of ['fixed-lock-linked', 'create-receipt-published', 'container-inspected', 'owner-published']) {
    await t.test(crashAt, async (st) => {
      const fixture = await normalRuntimeFixture(st, { crashAt });
      const crashed = await collectChild(fixture.launch());
      assert.equal(crashed.status, 75, crashed.stderr);
      const lock = await readStableCanonical(fixture.lock);
      const txn = join(fixture.nativeRoot, `usr/local/libexec/.happybooking-control-plane-runtime-txn-${lock.lockDigest.slice(7)}`);
      await assert.rejects(access(fixture.started));
      const replay = fixture.recover(lock.lockDigest);
      assert.equal(replay.status, 0, replay.stderr);
      await assert.rejects(access(fixture.lock));
      await assert.rejects(access(fixture.record));
      const final = await readStableCanonical(join(txn, 'final.json'));
      assert.equal(final.action, 'recovery');
      assert.equal(final.containerId, crashAt === 'fixed-lock-linked' ? 'absent' : 'a'.repeat(64));
      assert.equal(final.result, crashAt === 'fixed-lock-linked' ? 'absent' : 'removed');
      assert.equal(final.cleanupStatus, 'pass');
    });
  }
});

test('v3 create-to-receipt parent death is a forensic stop that preserves the unprovable Docker candidate', async (t) => {
  const fixture = await normalRuntimeFixture(t, { pauseAt: 'daemon-container-discovered' });
  const child = fixture.launch(); const exited = collectChild(child);
  await Promise.race([waitForPath(fixture.pauseMarker), exited.then((result) => { throw new Error(result.stderr || `launcher exited ${result.status}`); })]);
  const intent = await readStableCanonical(fixture.lock);
  const txn = join(fixture.nativeRoot, `usr/local/libexec/.happybooking-control-plane-runtime-txn-${intent.lockDigest.slice(7)}`);
  await assert.rejects(access(join(txn, 'create.json')));
  assert.match(await readFile(fixture.record, 'utf8'), /^a{64}\|\/booking-preprod-control-plane\|created\|false\|/);
  killChildTree(child);
  const killed = await exited;
  assert.notEqual(killed.status, 0);
  const evidence = await readFile(fixture.record, 'utf8');
  const recovered = fixture.recover(intent.lockDigest);
  assert.equal(recovered.status, 64);
  assert.equal(await readFile(fixture.record, 'utf8'), evidence);
  assert.equal(await readFile(fixture.lock, 'utf8').then(Boolean), true);
  assert.equal(await readFile(join(txn, 'intent.json'), 'utf8').then(Boolean), true);
  await assert.rejects(access(join(txn, 'create.json')));
  await assert.rejects(access(join(txn, 'final.json')));
});

test('v3 receipt-less recovery freezes exact clones, running, multiple, and identity-mismatched Docker candidates', async (t) => {
  await t.test('stable exited exact clone', async (st) => {
    const fixture = await runtimeRecoveryFixture(st, { withCreate: false, withOwner: false });
    await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|exited|false|23|${IMAGE}|${fixture.lockDigest}\n`);
    const recovered = fixture.run();
    assert.equal(recovered.status, 64);
    await assert.rejects(access(join(fixture.txn, 'create.json')));
    await assert.rejects(access(join(fixture.txn, 'final.json')));
  });
  await t.test('different full-ID exact clone', async (st) => {
    const fixture = await runtimeRecoveryFixture(st, { withCreate: false, withOwner: false });
    const clone = 'c'.repeat(64);
    await writeFile(fixture.record, `${clone}|/booking-preprod-control-plane|created|false|0|${IMAGE}|${fixture.lockDigest}\n`);
    assert.equal(fixture.run().status, 64);
    assert.match(await readFile(fixture.record, 'utf8'), new RegExp(clone));
    await assert.rejects(access(join(fixture.txn, 'final.json')));
  });
  await t.test('running unique candidate', async (st) => {
    const fixture = await runtimeRecoveryFixture(st, { withCreate: false, withOwner: false });
    await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|running|true|0|${IMAGE}|${fixture.lockDigest}\n`);
    assert.equal(fixture.run().status, 64);
    await assert.rejects(access(join(fixture.txn, 'create.json')));
    assert.match(await readFile(fixture.record, 'utf8'), /\|running\|true\|/);
  });
  await t.test('multiple exact-label candidates', async (st) => {
    const fixture = await runtimeRecoveryFixture(st, { withCreate: false, withOwner: false });
    const second = 'c'.repeat(64);
    await writeFile(fixture.record,
      `${fixture.containerId}|/booking-preprod-control-plane|created|false|0|${IMAGE}|${fixture.lockDigest}\n` +
      `${second}|/other|exited|false|1|${IMAGE}|${fixture.lockDigest}\n`);
    assert.equal(fixture.run().status, 64);
    await assert.rejects(access(join(fixture.txn, 'create.json')));
  });
  for (const [label, name, image, digest] of [
    ['renamed', '/renamed-control-plane', IMAGE, null],
    ['wrong image', '/booking-preprod-control-plane', `node@sha256:${'f'.repeat(64)}`, null],
    ['wrong label', '/booking-preprod-control-plane', IMAGE, `sha256:${'e'.repeat(64)}`],
  ]) {
    await t.test(label, async (st) => {
      const fixture = await runtimeRecoveryFixture(st, { withCreate: false, withOwner: false });
      await writeFile(fixture.record, `${fixture.containerId}|${name}|created|false|0|${image}|${digest || fixture.lockDigest}\n`);
      assert.equal(fixture.run().status, 64);
      await assert.rejects(access(join(fixture.txn, 'create.json')));
      assert.match(await readFile(fixture.record, 'utf8'), new RegExp(fixture.containerId));
    });
  }
});

test('v3 recovery never treats dangling owner, completion, or final records as absent', async (t) => {
  for (const [recordName, options] of [
    ['owner.json', { withOwner: false }],
    ['completion-intent.json', { withOwner: true }],
    ['final.json', { withOwner: true }],
  ]) {
    await t.test(recordName, async (st) => {
      const fixture = await runtimeRecoveryFixture(st, options);
      await symlink('missing-record-target', join(fixture.txn, recordName));
      await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|exited|false|7|${IMAGE}|${fixture.lockDigest}\n`);
      const before = await readFile(fixture.record, 'utf8');
      assert.equal(fixture.run().status, 64);
      assert.equal(await readFile(fixture.record, 'utf8'), before);
      assert.equal(await readFile(fixture.lock, 'utf8').then(Boolean), true);
    });
  }
});

test('v3 recovery never treats dangling create receipt as absent with or without a Docker candidate', async (t) => {
  for (const candidate of [false, true]) {
    await t.test(candidate ? 'with candidate' : 'without candidate', async (st) => {
      const fixture = await runtimeRecoveryFixture(st, { withCreate: false, withOwner: false });
      await symlink('missing-create-target', join(fixture.txn, 'create.json'));
      if (candidate) await writeFile(fixture.record,
        `${fixture.containerId}|/booking-preprod-control-plane|created|false|0|${IMAGE}|${fixture.lockDigest}\n`);
      const lock = await readFile(fixture.lock, 'utf8');
      assert.equal(fixture.run().status, 64);
      assert.equal(await readFile(fixture.lock, 'utf8'), lock);
      assert.equal(await readFile(join(fixture.txn, 'intent.json'), 'utf8').then(Boolean), true);
      await assert.rejects(access(join(fixture.txn, 'final.json')));
      if (candidate) assert.match(await readFile(fixture.record, 'utf8'), /a{64}/);
    });
  }
});

test('v2 persists daemon-discovered create identity before rejecting untrusted Docker create results', async (t) => {
  for (const mode of ['nonzero', 'empty', 'multiline']) {
    await t.test(mode, async (st) => {
      const fixture = await normalRuntimeFixture(st);
      await writeFile(fixture.createMode, mode);
      const result = await collectChild(fixture.launch());
      assert.equal(result.status, 64, result.stderr);
      const lock = await readStableCanonical(fixture.lock);
      const txn = join(fixture.nativeRoot, `usr/local/libexec/.happybooking-control-plane-runtime-txn-${lock.lockDigest.slice(7)}`);
      const create = await readStableCanonical(join(txn, 'create.json'));
      assert.equal(create.containerId, 'a'.repeat(64));
      await assert.rejects(access(join(txn, 'owner.json')));
      const recovered = fixture.recover(lock.lockDigest);
      assert.equal(recovered.status, 0, recovered.stderr);
      await assert.rejects(access(fixture.record));
    });
  }
});

test('v2 rejects impossible post-start state/running combinations without cleanup', async (t) => {
  for (const mode of ['created', 'running', 'inconsistent']) {
    await t.test(mode, async (st) => {
      const fixture = await normalRuntimeFixture(st);
      await writeFile(fixture.startMode, mode);
      const result = await collectChild(fixture.launch());
      assert.equal(result.status, 64, result.stderr);
      assert.equal((await readFile(fixture.record, 'utf8')).includes(`|${mode === 'inconsistent' ? 'running|false' : `${mode}|${mode === 'running' ? 'true' : 'false'}`}|`), true);
      const lock = await readStableCanonical(fixture.lock);
      if (mode === 'created') {
        const recovered = fixture.recover(lock.lockDigest);
        assert.equal(recovered.status, 0, recovered.stderr);
      } else {
        assert.equal(fixture.recover(lock.lockDigest).status, 64);
      }
    });
  }
});

test('runtime launcher refuses every regular or dangling conflicting artifact before and after acquisition', async (t) => {
  const artifacts = ['.happybooking-control-plane-install.lock', '.happybooking-control-plane-install.journal.json',
    '.happybooking-legacy-active-migration.lock', '.happybooking-legacy-active-migration.journal.json'];
  for (const artifact of artifacts) {
    for (const kind of ['regular', 'dangling']) {
      await t.test(`before ${artifact} ${kind}`, async (st) => {
        const fixture = await normalRuntimeFixture(st);
        const conflict = join(fixture.nativeRoot, 'usr/local/libexec', artifact);
        if (kind === 'regular') await writeFile(conflict, 'busy'); else await symlink('missing-target', conflict);
        const result = await collectChild(fixture.launch());
        assert.equal(result.status, 64, result.stderr);
        await assert.rejects(access(fixture.runCount));
        await assert.rejects(access(fixture.lock));
      });
      await t.test(`after ${artifact} ${kind}`, async (st) => {
        const fixture = await normalRuntimeFixture(st, { injectArtifact: artifact, injectDangling: kind === 'dangling' });
        const result = await collectChild(fixture.launch());
        assert.equal(result.status, 64, result.stderr);
        await assert.rejects(access(fixture.runCount));
        await assert.rejects(access(fixture.lock));
        const conflict = join(fixture.nativeRoot, 'usr/local/libexec', artifact);
        assert.equal(kind === 'dangling' ? (await readFile(conflict).then(() => false, () => true)) : true, true);
      });
    }
  }
});

test('runtime and Docker-config dangling paths are occupied and never treated as absent', async (t) => {
  await t.test('normal fixed runtime lock dangling', async (st) => {
    const fixture = await normalRuntimeFixture(st);
    await symlink('missing-runtime-target', fixture.lock);
    const result = await collectChild(fixture.launch());
    assert.equal(result.status, 64, result.stderr);
    await assert.rejects(access(fixture.runCount));
  });
  await t.test('recovery fixed runtime lock dangling', async (st) => {
    const fixture = await runtimeRecoveryFixture(st);
    await rm(fixture.lock); await symlink('missing-runtime-target', fixture.lock);
    const before = await readFile(join(fixture.txn, 'intent.json'), 'utf8');
    assert.equal(fixture.run().status, 64);
    assert.equal(await readFile(join(fixture.txn, 'intent.json'), 'utf8'), before);
  });
  for (const kind of ['regular', 'dangling']) {
    await t.test(`normal host Docker config ${kind}`, async (st) => {
      const fixture = await normalRuntimeFixture(st);
      const config = join(fixture.nativeRoot, 'usr/local/libexec/happybooking/control-plane/ops/release/.host-docker-empty');
      if (kind === 'regular') await writeFile(config, '{}'); else await symlink('missing-config-target', config);
      const result = await collectChild(fixture.launch());
      assert.equal(result.status, 64, result.stderr);
      await assert.rejects(access(fixture.runCount));
    });
    await t.test(`post-acquire host Docker config ${kind}`, async (st) => {
      const fixture = await normalRuntimeFixture(st, { injectHostConfig: true, injectDangling: kind === 'dangling' });
      const result = await collectChild(fixture.launch());
      assert.equal(result.status, 64, result.stderr);
      await assert.rejects(access(fixture.runCount));
      await assert.rejects(access(fixture.lock));
    });
  }
});

test('production launcher rejects every legacy TEST_ROOT environment before recovery mutation', async (t) => {
  const fixture = await runtimeRecoveryFixture(t, { ownerBoot: '22222222-2222-2222-2222-222222222222', currentBoot: '11111111-1111-1111-1111-111111111111' });
  const alias = `${fixture.testRoot}/../${fixture.testRoot.slice(fixture.testRoot.lastIndexOf('/') + 1)}`;
  const result = spawnSync(shell, [launcher, ...fixture.argv], { cwd: root, encoding: 'utf8', env: { ...process.env,
    BOOKING_CONTROL_PLANE_DRY_RUN: 'true', BOOKING_CONTROL_PLANE_RUNTIME_LOCK_TEST_ROOT: alias } });
  assert.equal(result.status, 64);
  assert.equal(await readFile(fixture.lock, 'utf8').then(Boolean), true);
  assert.equal(await readFile(fixture.record, 'utf8').catch(() => ''), '');
});

test('legacy v1 directory runtime locks are immutable forensic stops, never v2 cleanup inputs', async (t) => {
  const fixture = await runtimeRecoveryFixture(t);
  await rm(fixture.lock);
  await mkdir(fixture.lock);
  await writeFile(join(fixture.lock, 'owner.json'), '{"schema":"booking.preprod-runtime-lock/v1","signature":"forensic-only"}\n');
  await writeFile(fixture.record, `${fixture.containerId}|/booking-preprod-control-plane|exited|false|7|${IMAGE}|${fixture.lockDigest}\n`);
  const before = await readFile(fixture.record, 'utf8');
  assert.equal(fixture.run().status, 64);
  assert.equal(await readFile(fixture.record, 'utf8'), before);
  assert.equal(await readFile(join(fixture.lock, 'owner.json'), 'utf8').then(Boolean), true);
  assert.equal(await readFile(join(fixture.txn, 'intent.json'), 'utf8').then(Boolean), true,
    'dual v1/v2 evidence must remain intact for signed coordinated disposition');
});

test('op07 rollback rehearsal requires fresh Telegram egress preparation before repromotion stage', () => {
  const source = readFileSync(runbook, 'utf8');
  const section = source.slice(source.indexOf('7. Re-promote the same immutable candidate'), source.indexOf('8. Enter `COMMITTED`'));
  assert.ok(section.includes('`preprod-prepare-telegram-egress`'));
  assert.ok(section.indexOf('`preprod-prepare-telegram-egress`') < section.indexOf('stage to'));
  assert.match(source, /coordinated dual-lock stop/);
  assert.match(source, /There is no supported manual-delete shortcut/);
});

test('record assertions independently reject semantically valid but non-canonical JSON bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-runtime-canonical-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const record = join(directory, 'record.json');
  await writeFile(record, '{"a":1,"nested":{"a":2,"z":3},"z":2}\n');
  assert.deepEqual(await readStableCanonical(record), { a: 1, nested: { a: 2, z: 3 }, z: 2 });
  await writeFile(record, '{"z":2,"a":1,"nested":{"z":3,"a":2}}\n');
  await assert.rejects(readStableCanonical(record), /non-canonical record bytes/);
});

test('launcher source has no eval, shell command mode, mutable image, or caller-configurable host path', () => {
  const source = readFileSync(launcher, 'utf8');
  assert.doesNotMatch(source, /\beval\b/);
  assert.doesNotMatch(source, /(?:^|\s)-(?:c|lc)(?:\s|$)/m);
  assert.doesNotMatch(source, /node:(?:latest|22)(?!-)/);
  assert.doesNotMatch(source, /\$\{?(?:HOST_DOCKER|HOST_COMPOSE|STATE_ROOT|PREPROD_ROOT|CONTROL_ROOT|HELPER_ROOT|SECRETS_ROOT|CONTROL_ENV):-/);
  assert.match(source, /--read-only/);
  assert.match(source, /--cap-drop ALL/);
  assert.match(source, /--security-opt no-new-privileges:true/);
  assert.match(source, /--tmpfs \/tmp:rw,nosuid,nodev,noexec,size=64m/);
  assert.doesNotMatch(source, /--pids-limit/);
  assert.doesNotMatch(source, /--cpus(?:\s|=)/);
  assert.match(source, /--pull never/);
  assert.deepEqual(source.split(/\r?\n/).filter((line) => line.includes('docker_host container rm')), [
    '    docker_host container rm "$runtime_recovered_id" >/dev/null || fail',
    '  docker_host container rm "$runtime_completed_id" >/dev/null || fail',
  ]);
  assert.match(source, /"\$LINK" "\$runtime_txn_intent" "\$RUNTIME_LOCK"/);
  assert.match(source, /container create --pull never/);
  assert.match(source, /docker_host container start --attach "\$runtime_created_id"/);
  assert.match(source, /runtime_trusted_recovery_environment/);
  assert.match(source, /\[ "\$\("\$ID" -u\)" = "\$EXPECTED_UID" \] \|\| fail/);
  assert.match(source, /runtime_conflicts_absent\(\)/);
  assert.match(source, /INSTALL_JOURNAL='\/usr\/local\/libexec\/\.happybooking-control-plane-install\.journal\.json'/);
  assert.match(source, /path_absent\(\)/);
  for (const artifact of ['INSTALL_LOCK', 'INSTALL_JOURNAL', 'MIGRATION_LOCK', 'MIGRATION_JOURNAL']) {
    assert.match(source, new RegExp(`path_absent "\\$${artifact}"`));
  }
  assert.match(source, /runtime_conflicts_absent \|\| fail/);
  assert.match(source, /if ! runtime_conflicts_absent; then abort_runtime_before_create; fail; fi/);
  assert.doesNotMatch(source, /exec "\$HOST_DOCKER"/);
});
