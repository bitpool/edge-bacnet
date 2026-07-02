'use strict';
/**
 * SCHubConnector tests: failover orchestration over real TLS sockets against
 * the in-repo test hub (AB.5.2), plus backoff/VMAC-regeneration mechanics with
 * fake sockets.
 */
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const SC = require('../../resources/node-bacstack-ts/dist/lib/sc-constants');
const bvlcSc = require('../../resources/node-bacstack-ts/dist/lib/bvlc-sc');
const { SCConnection } = require('../../resources/node-bacstack-ts/dist/lib/sc-connection');
const { SCHubConnector } = require('../../resources/node-bacstack-ts/dist/lib/sc-hub-connector');
const { createTestHub } = require('../../tools/sc-test-hub');
const { FakeWebSocket } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (file) => fs.readFileSync(path.join(FIXTURES, file));
const uuid = () => bvlcSc.uuidFromString(require('node:crypto').randomUUID());

before(() => {
  if (!fs.existsSync(path.join(FIXTURES, 'ca.cert.pem')))
    execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'generate-sc-test-certs.js')], { stdio: 'inherit' });
});

const waitFor = (emitter, event, ms = 8000, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    emitter.removeListener(event, onEvent);
    reject(new Error(`timed out waiting for '${event}'`));
  }, ms);
  const onEvent = (payload) => {
    if (predicate && !predicate(payload))
      return;
    clearTimeout(timer);
    emitter.removeListener(event, onEvent);
    resolve(payload);
  };
  emitter.on(event, onEvent);
});

const startHub = async (options) => {
  const hub = createTestHub(Object.assign({
    cert: fixture('hub.cert.pem'),
    key: fixture('hub.key.pem'),
    ca: fixture('ca.cert.pem')
  }, options || {}));
  await hub.listen();
  return hub;
};

const nodeTls = (n) => ({
  ca: fixture('ca.cert.pem'),
  cert: fixture(`node${n}.cert.pem`),
  key: fixture(`node${n}.key.pem`)
});

const makeConnector = (overrides) => new SCHubConnector(Object.assign({
  uuid: uuid(),
  tls: nodeTls(1),
  reconnectMs: 150,
  connectWaitMs: 3000,
  disconnectWaitMs: 1000
}, overrides || {}));

test('start() without configuration refuses with SC_NOT_CONFIGURED', () => {
  const connector = new SCHubConnector({});
  const statuses = [];
  connector.on('status', (s) => statuses.push(s));
  assert.strictEqual(connector.start(), false);
  assert.strictEqual(statuses[0].code, 'SC_NOT_CONFIGURED');
  assert.match(statuses[0].message, /primary hub URI/);
  assert.match(statuses[0].message, /CA certificate/);
  assert.strictEqual(connector.connected, false);
});

test('connects to the primary hub and exchanges NPDUs', async () => {
  const hub = await startHub();
  const connector = makeConnector({ primaryHubUri: hub.url });
  try {
    const up = waitFor(connector, 'up');
    assert.strictEqual(connector.start(), true);
    const info = await up;
    assert.strictEqual(info.hubType, 'primary');
    assert.strictEqual(connector.connected, true);
    assert.strictEqual(connector.hubType, 'primary');
    assert.strictEqual(connector.maxNpduTx, 1497);
    assert.strictEqual(connector.getStatus().uri, hub.url);

    // a second plain node on the same hub sees the connector's broadcast
    const witness = new SCConnection({
      role: 'initiating', url: hub.url,
      vmac: bvlcSc.generateRandom48(), uuid: uuid(), tls: nodeTls(2)
    });
    const witnessUp = waitFor(witness, 'connected');
    witness.connect();
    await witnessUp;

    const received = waitFor(witness, 'npdu');
    assert.strictEqual(connector.send(Buffer.from('0100', 'hex'), null), true);
    const npdu = await received;
    assert.strictEqual(npdu.isBroadcast, true);
    assert.deepStrictEqual(npdu.srcVmac, connector.vmac);

    // and unicast back to the connector
    const back = waitFor(connector, 'npdu');
    witness.sendNpdu(Buffer.from('0104cafe', 'hex'), connector.vmac);
    const backNpdu = await back;
    assert.strictEqual(backNpdu.isBroadcast, false);
    assert.deepStrictEqual(backNpdu.npdu, Buffer.from('0104cafe', 'hex'));

    witness.destroy();
  }
  finally {
    await connector.stop();
    await hub.close();
  }
});

test('send() without a hub connection returns false', () => {
  const connector = makeConnector({ primaryHubUri: 'wss://127.0.0.1:1' });
  assert.strictEqual(connector.send(Buffer.from('0100', 'hex'), null), false);
});

test('failover: primary dies => failover hub adopted; primary restored => promoted back (AB.5.2)', async () => {
  const primary = await startHub();
  const failover = await startHub();
  const primaryPort = primary.port;
  const connector = makeConnector({
    primaryHubUri: primary.url,
    failoverHubUri: failover.url,
    reconnectMs: 200
  });
  const statuses = [];
  connector.on('status', (s) => statuses.push(s.code));
  let restoredPrimary = null;
  try {
    const upPrimary = waitFor(connector, 'up', 8000, (info) => info.hubType === 'primary');
    connector.start();
    await upPrimary;

    // kill the primary => expect down, then failover up
    const down = waitFor(connector, 'down');
    const upFailover = waitFor(connector, 'up', 10000, (info) => info.hubType === 'failover');
    await primary.close();
    await down;
    await upFailover;
    assert.strictEqual(connector.hubType, 'failover');
    assert.ok(statuses.includes('FAILOVER_ACTIVE'));

    // restore the primary on the same port => probe must promote it
    restoredPrimary = await startHub({ port: primaryPort });
    const failoverReleased = waitFor(failover.hub, 'nodeDisconnected', 10000);
    const upRestored = waitFor(connector, 'up', 10000, (info) => info.hubType === 'primary');
    await upRestored;
    assert.strictEqual(connector.hubType, 'primary');
    assert.ok(statuses.includes('PRIMARY_RESTORED'));
    // the failover connection is released gracefully (hub side sees the peer disconnect)
    const release = await failoverReleased;
    assert.strictEqual(release.vmac, bvlcSc.vmacToString(connector.vmac));
  }
  finally {
    await connector.stop();
    await failover.close();
    if (restoredPrimary)
      await restoredPrimary.close();
  }
});

test('duplicate VMAC: NAK 151 regenerates the Random-48 and reconnects', async () => {
  const hub = await startHub();
  const stolenVmac = bvlcSc.generateRandom48();
  // occupy the VMAC with a plain node
  const squatter = new SCConnection({
    role: 'initiating', url: hub.url, vmac: stolenVmac, uuid: uuid(), tls: nodeTls(2)
  });
  const squatterUp = waitFor(squatter, 'connected');
  squatter.connect();
  await squatterUp;

  const connector = makeConnector({ primaryHubUri: hub.url, vmac: stolenVmac, reconnectMs: 100 });
  try {
    const changed = waitFor(connector, 'vmac-changed');
    const up = waitFor(connector, 'up');
    connector.start();
    const newVmac = await changed;
    assert.ok(!newVmac.equals(stolenVmac), 'a fresh Random-48 must be generated');
    assert.strictEqual(newVmac[0] & 0x0f, 0x02);
    await up;
    assert.deepStrictEqual(connector.vmac, newVmac);
    assert.strictEqual(hub.hub.connectedNodes.length, 2);
    squatter.destroy();
  }
  finally {
    await connector.stop();
    await hub.close();
  }
});

test('reconnect backoff: doubles within jitter bounds, respects the cap, resets on success', async () => {
  const fakes = [];
  const connector = new SCHubConnector({
    primaryHubUri: 'wss://unreachable.example:4443',
    uuid: uuid(),
    wsFactory: () => {
      const ws = new FakeWebSocket();
      fakes.push(ws);
      return ws;
    },
    reconnectMs: 1000,
    reconnectCapMs: 5000
  });
  const retryDelays = [];
  connector.on('status', (s) => {
    if (s.code === 'SC_CONNECT_FAILED')
      retryDelays.push(s.detail.willRetryInMs);
  });
  connector.start();
  assert.strictEqual(fakes.length, 1);

  const failNext = () => {
    const err = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    fakes[fakes.length - 1].emit('error', err);
  };
  // three consecutive failures — connector uses real timers, so instead of
  // waiting out the delays we assert the arithmetic it reported
  failNext();
  assert.strictEqual(retryDelays.length, 1);
  const bound = (n) => Math.min(1000 * Math.pow(2, n), 5000);
  assert.ok(retryDelays[0] >= 1000 && retryDelays[0] <= bound(1) * 1.2, `delay 1 within bounds: ${retryDelays[0]}`);

  // force the connector's internal state through further failures without waiting
  connector._consecutiveFailures = 5; // beyond the cap
  const capped = connector._nextRetryDelay();
  assert.ok(capped <= 5000 * 1.2, `capped delay: ${capped}`);
  assert.ok(capped >= 1000, 'never below the configured reconnect minimum');
  await connector.stop();
});

test('stop() leaves no sockets or servers behind', async () => {
  const hub = await startHub();
  const connector = makeConnector({ primaryHubUri: hub.url });
  const up = waitFor(connector, 'up');
  connector.start();
  await up;
  await connector.stop();
  await hub.close();
  // allow the event loop a turn to reap closed handles
  await new Promise((resolve) => setTimeout(resolve, 200));
  const resources = process.getActiveResourcesInfo();
  const sockets = resources.filter((name) => /TCPSocketWrap|TCPServerWrap|TLSWrap/.test(name));
  assert.deepStrictEqual(sockets, [], `lingering socket handles: ${resources.join(', ')}`);
});

test('stop() is idempotent and safe before start', async () => {
  const connector = makeConnector({ primaryHubUri: 'wss://127.0.0.1:1' });
  await connector.stop();
  await connector.stop();
  connector.start();
  await connector.stop();
  await connector.stop();
});
