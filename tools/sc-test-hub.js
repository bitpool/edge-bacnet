'use strict';
/**
 * Minimal BACnet/SC hub for development and tests. Thin wss wrapper around the
 * ScHubFunction routing core (resources/node-bacstack-ts/dist/lib/sc-hub-function.js).
 * Mutual-TLS 1.3, subprotocol hub.bsc.bacnet.org, per ANNEX AB. NOT a product
 * feature — dev/test only in v1.
 *
 * As a CLI:
 *   node scripts/generate-sc-test-certs.js
 *   node tools/sc-test-hub.js --port 4443 [--host 0.0.0.0] [--fixtures test/sc/fixtures]
 *
 * As a module:
 *   const { createTestHub } = require('./tools/sc-test-hub');
 *   const hub = createTestHub({ cert, key, ca, port: 0 });
 *   await hub.listen();  ... await hub.close();
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const SC = require('../resources/node-bacstack-ts/dist/lib/sc-constants');
const { ScHubFunction } = require('../resources/node-bacstack-ts/dist/lib/sc-hub-function');

const createTestHub = (options) => {
  options = options || {};
  const faults = Object.assign({
    closeOnConnectCode: null, // close every new socket with this code (before handshake)
    delayAttachMs: 0, // delay adopting the socket (connect-wait timeout tests)
    refuseSubprotocol: false // negotiate no subprotocol (protocol-assertion tests)
  }, options.faults || {});

  const hub = new ScHubFunction({
    vmac: options.vmac,
    uuid: options.uuid,
    connectWaitMs: options.connectWaitMs,
    disconnectWaitMs: options.disconnectWaitMs,
    maxBvlcAccepted: options.maxBvlcAccepted,
    maxNpduAccepted: options.maxNpduAccepted
  });

  const server = https.createServer({
    cert: options.cert,
    key: options.key,
    ca: options.ca,
    requestCert: true, // AB.7.4: mutual TLS
    rejectUnauthorized: true,
    minVersion: options.allowTls12 ? 'TLSv1.2' : 'TLSv1.3',
    maxVersion: 'TLSv1.3'
  });

  const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    maxPayload: SC.Defaults.WS_HARD_MAX_PAYLOAD,
    handleProtocols: (protocols) => {
      if (faults.refuseSubprotocol)
        return false;
      return protocols.has(SC.WS_SUBPROTOCOL_HUB) ? SC.WS_SUBPROTOCOL_HUB : false;
    }
  });

  wss.on('connection', (ws) => {
    if (faults.closeOnConnectCode) {
      ws.close(faults.closeOnConnectCode);
      return;
    }
    if (faults.delayAttachMs > 0) {
      const timer = setTimeout(() => hub.attachSocket(ws), faults.delayAttachMs);
      if (timer.unref)
        timer.unref();
      return;
    }
    hub.attachSocket(ws);
  });

  const api = {
    hub,
    wss,
    server,
    faults,
    port: null,
    url: null,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port || 0, options.host || '127.0.0.1', () => {
        api.port = server.address().port;
        api.url = `wss://${options.host || '127.0.0.1'}:${api.port}`;
        resolve(api);
      });
    }),
    close: (graceful) => {
      hub.stop(graceful);
      // make sure no client socket keeps the HTTP server's close() waiting
      for (const client of wss.clients)
        client.terminate();
      return new Promise((resolve) => {
        wss.close(() => {
          if (typeof server.closeAllConnections === 'function')
            server.closeAllConnections();
          server.close(() => resolve());
        });
      });
    }
  };
  return api;
};
module.exports = { createTestHub };

// ------------------------------------------------------------------ CLI mode
if (require.main === module) {
  const argValue = (flag, fallback) => {
    const index = process.argv.indexOf(flag);
    return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
  };
  const fixturesDir = path.resolve(argValue('--fixtures', path.join(__dirname, '..', 'test', 'sc', 'fixtures')));
  const readPem = (file) => fs.readFileSync(path.join(fixturesDir, file));
  const testHub = createTestHub({
    port: parseInt(argValue('--port', '4443'), 10),
    host: argValue('--host', '127.0.0.1'),
    cert: readPem('hub.cert.pem'),
    key: readPem('hub.key.pem'),
    ca: readPem('ca.cert.pem')
  });
  testHub.hub.on('nodeConnected', (info) => console.log(`[hub] node connected    ${info.vmac} (uuid ${info.uuid})`));
  testHub.hub.on('nodeDisconnected', (info) => console.log(`[hub] node disconnected ${info.vmac} (${info.reasonName})`));
  testHub.hub.on('status', (status) => {
    if (status.level !== 'info')
      console.log(`[hub] ${status.level} ${status.code}: ${status.message}`);
  });
  testHub.listen().then(() => {
    console.log(`BACnet/SC test hub listening on ${testHub.url}`);
    console.log(`  subprotocol: ${SC.WS_SUBPROTOCOL_HUB}, mutual TLS 1.3, CA: ${path.join(fixturesDir, 'ca.cert.pem')}`);
  }).catch((err) => {
    console.error('Failed to start test hub:', err.message);
    process.exit(1);
  });
}
