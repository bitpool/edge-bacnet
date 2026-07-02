'use strict';
/**
 * Gateway-level integration: BacnetClientConfig -> BacnetClient in SC mode
 * against the in-repo test hub — identity persistence, ScTransport injection,
 * scStatus plumbing, connect-triggered discovery, and the redeploy transport
 * swap (SC param change and SC -> IP). Runs without Node-RED by driving
 * BacnetClient directly, exactly as bacnet_gateway.js does.
 */
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// isolate the datastore/identity files BEFORE requiring the modules
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-bacnet-sc-test-'));
process.env.BACNET_STORAGE_PATH = STORAGE;

const bacnet = require('../../resources/node-bacstack-ts/dist/index.js');
const { BacnetClientConfig } = require('../../common');
const { BacnetClient } = require('../../bacnet_client');
const { createTestHub } = require('../../tools/sc-test-hub');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (file) => fs.readFileSync(path.join(FIXTURES, file));
const fixturePath = (file) => path.join(FIXTURES, file);

before(() => {
  if (!fs.existsSync(fixturePath('ca.cert.pem')))
    execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'generate-sc-test-certs.js')], { stdio: 'inherit' });
});

const waitFor = (emitter, event, ms = 10000, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out waiting for '${event}'`)), ms);
  const onEvent = (payload) => {
    if (predicate && !predicate(payload))
      return;
    clearTimeout(timer);
    emitter.removeListener(event, onEvent);
    resolve(payload);
  };
  emitter.on(event, onEvent);
});

// mirrors the construction site in bacnet_gateway.js
const makeConfig = (datalinkMode, scConfig, port) => new BacnetClientConfig(
  3000,            // apduTimeout
  '127.0.0.1',     // localIpAdrress
  port || 47899,   // local_device_port (off the beaten path for IP-mode tests)
  '5',             // apduSize
  '0x50',          // maxSegments
  '255.255.255.255',
  900,             // discover_polling_schedule
  false,           // toRestartNodeRed
  817001,          // deviceId
  false, 0, 0,     // manual instance range
  900,             // device_read_schedule
  5,               // retries
  false,           // cacheFileEnabled
  60,              // sanitise_device_schedule
  [{ start: port || 47899, end: port || 47899, enabled: true }],
  true,            // enable_device_discovery
  250,
  datalinkMode,
  scConfig
);

test('SC gateway client: identity, connection, discovery, reconfigure, IP swap', async (t) => {
  const hub = createTestHub({
    cert: fixture('hub.cert.pem'),
    key: fixture('hub.key.pem'),
    ca: fixture('ca.cert.pem')
  });
  await hub.listen();

  // a responding SC device on the same hub
  const responder = new bacnet.ScTransport({
    primaryHubUri: hub.url,
    ca: fixture('ca.cert.pem'),
    cert: fixture('node2.cert.pem'),
    key: fixture('node2.key.pem'),
    uuid: require('node:crypto').randomUUID()
  });
  const responderClient = new bacnet.Client({ transport: responder, apduTimeout: 3000 });
  responderClient.on('whoIs', () => responderClient.iAmResponse(5555, bacnet.enum.Segmentation.NO_SEGMENTATION, 1401));
  await waitFor(responder, 'connected');

  const scConfig = {
    primaryHubUri: hub.url,
    failoverHubUri: '',
    caCert: fixturePath('ca.cert.pem'), // file-path branch of Resolve_Sc_Credential
    clientCert: fixture('node1.cert.pem').toString(), // pasted-PEM branch
    privateKey: fixture('node1.key.pem').toString(),
    keyPassphrase: '',
    reconnectDelay: 1,
    connectWaitTimeout: 5,
    heartbeatInterval: 60,
    verifyHostname: false,
    allowTls12: false
  };
  const gatewayClient = new BacnetClient(makeConfig('sc', scConfig));
  try {
    // status plumbing reaches BacnetClient subscribers (bacnet_gateway.js pattern)
    await waitFor(gatewayClient, 'scStatus', 10000, (s) => s.state === 'connected');
    assert.strictEqual(gatewayClient.lastScStatus.state, 'connected');
    assert.strictEqual(gatewayClient.lastScStatus.hub, 'primary');

    // identity file created and well-formed
    const identityFile = path.join(STORAGE, 'edge-bacnet-sc-identity.cfg');
    assert.ok(fs.existsSync(identityFile), 'identity file must be persisted');
    const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
    assert.match(identity.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.match(identity.vmac, /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
    assert.strictEqual(gatewayClient.scTransport.getLocalVmac(), identity.vmac);

    // connect-triggered whoIs finds the responder with its VMAC address
    const found = await waitFor(gatewayClient, 'deviceFound', 10000, (d) => d.deviceId === 5555);
    assert.strictEqual(found.address, responder.getLocalVmac());
    const device = gatewayClient.deviceList.find((d) => d.getDeviceId() === 5555);
    assert.ok(device, 'device must be in the device list');
    assert.strictEqual(device.getAddress(), responder.getLocalVmac());

    // redeploy with a changed SC parameter => transport swap + reconnect
    const reconfigured = { ...scConfig, heartbeatInterval: 90 };
    const oldTransport = gatewayClient.scTransport;
    gatewayClient.reinitializeClient(makeConfig('sc', reconfigured));
    await waitFor(gatewayClient, 'scStatus', 10000, (s) => s.state === 'connected');
    assert.notStrictEqual(gatewayClient.scTransport, oldTransport, 'a changed SC parameter must rebuild the transport');
    assert.strictEqual(gatewayClient.client._transport, gatewayClient.scTransport);

    // identity survives the swap (same file, same values)
    assert.strictEqual(gatewayClient.scTransport.getLocalVmac(), identity.vmac);

    // redeploy back to BACnet/IP => UDP transport, no SC remnants
    gatewayClient.reinitializeClient(makeConfig('ip', null));
    assert.strictEqual(typeof gatewayClient.client._transport.sendNpdu, 'undefined', 'IP mode must use the plain UDP transport');
    assert.strictEqual(gatewayClient.scTransport, null);
    assert.strictEqual(gatewayClient.datalinkMode, 'ip');
  }
  finally {
    gatewayClient.scheduler.stop();
    try { gatewayClient.client.close(); } catch (e) { /* transport may already be closed */ }
    await responder.close();
    await hub.close();
  }
});

test('second start reuses the persisted identity', () => {
  const identityFile = path.join(STORAGE, 'edge-bacnet-sc-identity.cfg');
  const before = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
  const { Read_Sc_Identity_Sync } = require('../../common');
  const again = Read_Sc_Identity_Sync();
  assert.deepStrictEqual(again, before);
});

test('unreadable credential path yields a failed status, not a crash or IP fallback', async () => {
  const scConfig = {
    primaryHubUri: 'wss://127.0.0.1:1',
    caCert: 'C:/definitely/not/here.pem',
    clientCert: fixture('node1.cert.pem').toString(),
    privateKey: fixture('node1.key.pem').toString()
  };
  const gatewayClient = new BacnetClient(makeConfig('sc', scConfig));
  try {
    assert.strictEqual(gatewayClient.lastScStatus.state, 'failed');
    assert.strictEqual(gatewayClient.lastScStatus.error, 'SC_CREDENTIAL_ERROR');
    assert.match(gatewayClient.lastScStatus.message, /CA certificate/);
    // inert transport: nothing is sent, nothing throws
    gatewayClient.globalWhoIs();
    assert.strictEqual(typeof gatewayClient.client._transport.sendNpdu, 'function');
  }
  finally {
    gatewayClient.scheduler.stop();
    try { gatewayClient.client.close(); } catch (e) { /* inert */ }
  }
});
