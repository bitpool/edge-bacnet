'use strict';
/**
 * End-to-end: two real stack Clients, each with an injected ScTransport,
 * exchanging BACnet services through the in-repo test hub over mutual-TLS 1.3
 * WebSockets — whoIs/iAm discovery, readProperty and writeProperty round
 * trips. This exercises APDU -> NPDU -> client.js seam -> ScTransport ->
 * SCHubConnector -> SCConnection -> wss -> ScHubFunction and back.
 */
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const bacnet = require('../../resources/node-bacstack-ts/dist/index.js');
const { createTestHub } = require('../../tools/sc-test-hub');

const baEnum = bacnet.enum;
const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (file) => fs.readFileSync(path.join(FIXTURES, file));

before(() => {
  if (!fs.existsSync(path.join(FIXTURES, 'ca.cert.pem')))
    execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'generate-sc-test-certs.js')], { stdio: 'inherit' });
});

const scClient = (hubUrl, certN) => {
  const transport = new bacnet.ScTransport({
    primaryHubUri: hubUrl,
    ca: fixture('ca.cert.pem'),
    cert: fixture(`node${certN}.cert.pem`),
    key: fixture(`node${certN}.key.pem`),
    uuid: require('node:crypto').randomUUID(),
    reconnectMs: 200,
    connectWaitMs: 3000
  });
  const client = new bacnet.Client({ transport, apduTimeout: 3000, portRangeMatrix: [47808] });
  return { transport, client };
};

const connected = (transport, ms = 8000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('transport did not connect')), ms);
  transport.once('connected', () => {
    clearTimeout(timer);
    resolve();
  });
});

test('discovery, read and write round-trips through the hub', async () => {
  const hub = createTestHub({
    cert: fixture('hub.cert.pem'),
    key: fixture('hub.key.pem'),
    ca: fixture('ca.cert.pem')
  });
  await hub.listen();
  const a = scClient(hub.url, 1); // the gateway-like reader
  const b = scClient(hub.url, 2); // a responding BACnet device (bacnet_server.js pattern)
  try {
    await Promise.all([connected(a.transport), connected(b.transport)]);

    // negotiated sizing reaches the client's buffer arithmetic
    assert.strictEqual(a.client._transport.getMaxPayload(), 1497 + 4);

    // ---- responder wiring (mirrors bacnet_server.js)
    b.client.on('whoIs', () => {
      b.client.iAmResponse(2222, baEnum.Segmentation.NO_SEGMENTATION, 1401);
    });
    b.client.on('readProperty', (data) => {
      assert.strictEqual(data.request.objectId.type, 2);
      assert.strictEqual(data.request.objectId.instance, 1);
      assert.strictEqual(data.request.property.id, 85);
      b.client.readPropertyResponse(data.address, data.invokeId, data.request.objectId, data.request.property, [
        { value: 42.5, type: baEnum.ApplicationTags.REAL }
      ]);
    });
    const written = [];
    b.client.on('writeProperty', (data) => {
      // payload shape mirrored from bacnet_server.js: request.value.value[0].value
      written.push(data.request.value.value[0].value);
      b.client.simpleAckResponse(data.address, data.service, data.invokeId);
    });

    // ---- whoIs / iAm discovery over the hub broadcast path
    const discovered = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no iAm received')), 8000);
      a.client.on('iAm', (device) => {
        clearTimeout(timer);
        resolve(device);
      });
      a.client.whoIs();
    });
    assert.strictEqual(discovered.deviceId, 2222);
    assert.strictEqual(discovered.vendorId, 1401);
    assert.strictEqual(discovered.address, b.transport.getLocalVmac(), 'iAm source address is the responder VMAC string');
    assert.match(discovered.address, /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);

    // ---- confirmed readProperty round-trip (unicast both directions)
    const readResult = await new Promise((resolve, reject) => {
      a.client.readProperty(discovered.address, { type: 2, instance: 1 }, 85, {}, (err, value) => {
        if (err)
          reject(err);
        else
          resolve(value);
      });
    });
    assert.strictEqual(readResult.values[0].value, 42.5);
    assert.strictEqual(readResult.values[0].type, baEnum.ApplicationTags.REAL);

    // ---- confirmed writeProperty round-trip
    await new Promise((resolve, reject) => {
      a.client.writeProperty(discovered.address, { type: 2, instance: 1 }, 85,
        [{ type: baEnum.ApplicationTags.REAL, value: 18.25 }], { priority: 8 },
        (err) => (err ? reject(err) : resolve()));
    });
    assert.strictEqual(written.length, 1);
    assert.strictEqual(written[0], 18.25);
  }
  finally {
    await a.transport.close();
    await b.transport.close();
    await hub.close();
  }
});

test('reads fail cleanly with ERR_TIMEOUT while the hub is unreachable', async () => {
  const { transport, client } = (() => {
    const t = new bacnet.ScTransport({
      primaryHubUri: 'wss://127.0.0.1:1',
      ca: fixture('ca.cert.pem'),
      cert: fixture('node1.cert.pem'),
      key: fixture('node1.key.pem'),
      uuid: require('node:crypto').randomUUID(),
      reconnectMs: 60000,
      connectWaitMs: 500
    });
    return { transport: t, client: new bacnet.Client({ transport: t, apduTimeout: 300 }) };
  })();
  try {
    const err = await new Promise((resolve) => {
      client.readProperty('C2:A1:5E:33:07:B4', { type: 2, instance: 1 }, 85, {}, (e) => resolve(e));
    });
    assert.ok(err, 'read must fail');
    assert.match(String(err.message || err), /ERR_TIMEOUT/);
  }
  finally {
    await transport.close();
  }
});

test('stale IP-shaped addresses are dropped without throwing (mode-switch cache)', async () => {
  const hub = createTestHub({
    cert: fixture('hub.cert.pem'),
    key: fixture('hub.key.pem'),
    ca: fixture('ca.cert.pem')
  });
  await hub.listen();
  const a = scClient(hub.url, 1);
  try {
    await connected(a.transport);
    const err = await new Promise((resolve) => {
      a.client.readProperty('192.168.1.43', { type: 2, instance: 1 }, 85, {}, (e) => resolve(e));
    });
    assert.match(String(err.message || err), /ERR_TIMEOUT/, 'stale-address read times out like an offline device');
  }
  finally {
    await a.transport.close();
    await hub.close();
  }
});
