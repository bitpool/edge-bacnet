/*
 * Integration test: round-trip a real BACnet readProperty against bacnet-sim-ci.
 *
 * What this proves: the vendored bacstack can encode/send/receive/decode a
 * standard BACnet/IP read against a real (simulated) device in a CI environment.
 * If this passes, the network plumbing is sound — any edge-bacnet-driven E2E
 * test can be added on top with confidence.
 *
 * What this deliberately does NOT exercise:
 *   - edge-bacnet's BacnetClient wrapper (its constructor binds schedulers and
 *     intervals that complicate teardown; covered separately by the smoke test)
 *   - Who-Is/I-Am broadcast discovery (UDP broadcast is unreliable across
 *     Docker network boundaries; we go unicast using the sim's REST API to
 *     learn the device IP)
 *   - Writes (a follow-up; the simulator's REST API exposes writes too)
 *
 * Env vars (with defaults suitable for GH Actions service-container setup):
 *   SIM_API_URL   - REST API base                (default: http://localhost:8099)
 *   SIM_BACNET_PORT - sim's BACnet/IP UDP port    (default: 47808)
 *   LOCAL_BACNET_PORT - port this client binds to (default: 47809; must differ
 *                       from SIM_BACNET_PORT when running against a sim that
 *                       forwards 47808 to the host)
 *   READY_TIMEOUT_MS - how long to wait for sim health (default: 60000)
 */

'use strict';

const http = require('http');
const bacnet = require('../../resources/node-bacstack-ts/dist/index.js');
const baEnum = bacnet.enum;

const SIM_API_URL = process.env.SIM_API_URL || 'http://localhost:8099';
const SIM_BACNET_PORT = parseInt(process.env.SIM_BACNET_PORT || '47808', 10);
const LOCAL_BACNET_PORT = parseInt(process.env.LOCAL_BACNET_PORT || '47809', 10);
const READY_TIMEOUT_MS = parseInt(process.env.READY_TIMEOUT_MS || '60000', 10);

let pass = 0;
let fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log(`  ok  ${name}`); return; }
  fail++;
  console.log(`  FAIL ${name}${info ? ' ' + info : ''}`);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`bad JSON from ${url}: ${e.message}\n${body}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${body}`));
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await getJson(`${SIM_API_URL}/health/ready`);
      if (r) return true;
    } catch (e) { lastErr = e; }
    await sleep(1000);
  }
  throw new Error(`sim never became ready within ${READY_TIMEOUT_MS}ms: ${lastErr && lastErr.message}`);
}

function readProperty(client, address, port, objectId, propertyId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('readProperty timeout (10s)')), 10000);
    client.readProperty({ address, port }, objectId, propertyId, (err, value) => {
      clearTimeout(timeout);
      if (err) return reject(err);
      resolve(value);
    });
  });
}

(async () => {
  console.log(`waiting for ${SIM_API_URL}/health/ready ...`);
  await waitForReady();
  ok('sim REST API is ready', true);

  const devices = await getJson(`${SIM_API_URL}/api/devices`);
  ok('sim returns at least one device', Array.isArray(devices) && devices.length > 0,
     JSON.stringify(devices));
  const device = devices[0];
  console.log(`testing against device ${device.deviceId} @ ${device.ip}:${SIM_BACNET_PORT}`);

  // The sim's default HVAC controller exposes "Zone Temp" at analog-input/1 = 72.5
  const expectedRest = await getJson(
    `${SIM_API_URL}/api/devices/${device.deviceId}/objects/analog-input/1`
  );
  ok('REST GET analog-input/1 returns a numeric value',
     typeof expectedRest.value === 'number',
     JSON.stringify(expectedRest));

  const client = new bacnet.Client({
    apduTimeout: 6000,
    interface: '0.0.0.0',
    port: LOCAL_BACNET_PORT,
    broadcastAddress: '255.255.255.255',
  });

  let bacnetValue;
  try {
    const result = await readProperty(
      client,
      device.ip,
      SIM_BACNET_PORT,
      { type: baEnum.ObjectType.ANALOG_INPUT, instance: 1 },
      baEnum.PropertyIdentifier.PRESENT_VALUE,
    );
    bacnetValue = result && result.values && result.values[0] && result.values[0].value;
    ok('BACnet readProperty returned a value', typeof bacnetValue === 'number',
       JSON.stringify(result));

    // REST and BACnet should agree on the current PRESENT_VALUE. Allow a small
    // float epsilon for the round-trip through ApplicationTags.REAL.
    const drift = Math.abs(bacnetValue - expectedRest.value);
    ok(`BACnet value matches REST (BACnet=${bacnetValue}, REST=${expectedRest.value}, drift=${drift})`,
       drift < 0.01);
  } finally {
    try { client.close && client.close(); } catch (_) { /* best effort */ }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('integration test crashed:', e);
  process.exit(2);
});
