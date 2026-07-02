'use strict';
/**
 * ScHubFunction routing-core tests (AB.5.3) using fake sockets — no TLS.
 * Real-socket coverage runs in the connector/e2e suites via tools/sc-test-hub.js.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const SC = require('../../resources/node-bacstack-ts/dist/lib/sc-constants');
const bvlcSc = require('../../resources/node-bacstack-ts/dist/lib/bvlc-sc');
const { ScHubFunction } = require('../../resources/node-bacstack-ts/dist/lib/sc-hub-function');
const { FakeWebSocket } = require('./helpers');

const FN = SC.BvlcScFunction;
const ERR = SC.ScErrorCode;

const HUB_VMAC = Buffer.from('927bf71a96a2', 'hex');
const HUB_UUID = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex');
const NODE1 = { vmac: Buffer.from('c2a15e330701', 'hex'), uuid: Buffer.from('11111111111111111111111111111111', 'hex') };
const NODE2 = { vmac: Buffer.from('c2a15e330702', 'hex'), uuid: Buffer.from('22222222222222222222222222222222', 'hex') };
const NODE3 = { vmac: Buffer.from('c2a15e330703', 'hex'), uuid: Buffer.from('33333333333333333333333333333333', 'hex') };

const makeHub = () => new ScHubFunction({ vmac: HUB_VMAC, uuid: HUB_UUID });

// Attach a fake socket and complete the accepting-side handshake for a node
const join = (hub, node, messageId = 1) => {
  const ws = new FakeWebSocket();
  ws.readyState = 1;
  hub.attachSocket(ws);
  ws.feed(bvlcSc.encodeConnectRequest({
    messageId,
    vmac: node.vmac,
    uuid: node.uuid,
    maxBvlcLength: 6144,
    maxNpduLength: 1497
  }));
  return ws;
};

test('handshake: Connect-Accept carries the hub hosting node identity', () => {
  const hub = makeHub();
  const ws = join(hub, NODE1, 0x77);
  const accept = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(accept.func, FN.CONNECT_ACCEPT);
  assert.strictEqual(accept.messageId, 0x77);
  assert.deepStrictEqual(accept.connect.vmac, HUB_VMAC);
  assert.deepStrictEqual(accept.connect.uuid, HUB_UUID);
  assert.strictEqual(hub.connectedNodes.length, 1);
  assert.strictEqual(hub.connectedNodes[0].vmac, bvlcSc.vmacToString(NODE1.vmac));
});

test('unicast forward: originating VMAC inserted, destination removed, message id preserved (AB.5.3.2)', () => {
  const hub = makeHub();
  const ws1 = join(hub, NODE1);
  const ws2 = join(hub, NODE2);
  ws1.sent.length = 0;
  ws2.sent.length = 0;

  const npdu = Buffer.from('01040000010c0c000000051955', 'hex');
  ws1.feed(bvlcSc.encodeEncapsulatedNpdu({ messageId: 0xB5EC, destVmac: NODE2.vmac, npdu }));

  assert.strictEqual(ws2.sent.length, 1);
  const forwarded = bvlcSc.decodeMessage(ws2.lastSent());
  assert.strictEqual(forwarded.func, FN.ENCAPSULATED_NPDU);
  assert.strictEqual(forwarded.messageId, 0xB5EC, 'hub must not change the message id');
  assert.deepStrictEqual(forwarded.origVmac, NODE1.vmac, 'hub inserts the source peer VMAC');
  assert.strictEqual(forwarded.destVmac, null, 'destination address removed at the final hop');
  assert.deepStrictEqual(forwarded.payload, npdu);
  assert.strictEqual(ws1.sent.length, 0, 'nothing echoed to the source');
});

test('unicast forward preserves destination and data options untouched', () => {
  const hub = makeHub();
  const ws1 = join(hub, NODE1);
  const ws2 = join(hub, NODE2);
  ws2.sent.length = 0;

  const original = bvlcSc.encodeMessage({
    func: FN.ENCAPSULATED_NPDU,
    messageId: 5,
    destVmac: NODE2.vmac,
    destOptions: [{ type: SC.HeaderOptionType.PROPRIETARY, mustUnderstand: false, headerData: Buffer.from('022bbac5ecc099', 'hex') }],
    dataOptions: [{ type: SC.HeaderOptionType.SECURE_PATH, mustUnderstand: true, headerData: null }],
    payload: Buffer.from('0100', 'hex')
  });
  ws1.feed(original);

  const forwarded = bvlcSc.decodeMessage(ws2.lastSent());
  assert.strictEqual(forwarded.destOptions.length, 1);
  assert.deepStrictEqual(forwarded.destOptions[0].headerData, Buffer.from('022bbac5ecc099', 'hex'));
  assert.strictEqual(forwarded.dataOptions.length, 1);
  assert.strictEqual(forwarded.dataOptions[0].type, SC.HeaderOptionType.SECURE_PATH);
});

test('broadcast: fan-out to all but source, destination stays broadcast, orig inserted (AB.5.3.3)', () => {
  const hub = makeHub();
  const ws1 = join(hub, NODE1);
  const ws2 = join(hub, NODE2);
  const ws3 = join(hub, NODE3);
  ws1.sent.length = ws2.sent.length = ws3.sent.length = 0;

  ws2.feed(bvlcSc.encodeEncapsulatedNpdu({
    messageId: 0x1000, destVmac: SC.BROADCAST_VMAC, npdu: Buffer.from('0100', 'hex')
  }));

  assert.strictEqual(ws2.sent.length, 0, 'no echo to the source connection');
  for (const ws of [ws1, ws3]) {
    assert.strictEqual(ws.sent.length, 1);
    const copy = bvlcSc.decodeMessage(ws.lastSent());
    assert.strictEqual(copy.isBroadcast, true, 'broadcast destination must remain');
    assert.deepStrictEqual(copy.origVmac, NODE2.vmac);
    assert.strictEqual(copy.messageId, 0x1000);
  }
});

test('unicast to an unknown VMAC is discarded (AB.5.3.2)', () => {
  const hub = makeHub();
  const ws1 = join(hub, NODE1);
  const ws2 = join(hub, NODE2);
  ws1.sent.length = ws2.sent.length = 0;
  ws1.feed(bvlcSc.encodeEncapsulatedNpdu({
    messageId: 1, destVmac: Buffer.from('deadbeefcafe', 'hex'), npdu: Buffer.from('0100', 'hex')
  }));
  assert.strictEqual(ws1.sent.length, 0);
  assert.strictEqual(ws2.sent.length, 0);
});

test('non-NPDU unicast BVLC messages are forwarded too (Address-Resolution through the hub)', () => {
  const hub = makeHub();
  const ws1 = join(hub, NODE1);
  const ws2 = join(hub, NODE2);
  ws2.sent.length = 0;
  ws1.feed(bvlcSc.encodeAddressResolution({ messageId: 0x42, destVmac: NODE2.vmac }));
  const forwarded = bvlcSc.decodeMessage(ws2.lastSent());
  assert.strictEqual(forwarded.func, FN.ADDRESS_RESOLUTION);
  assert.deepStrictEqual(forwarded.origVmac, NODE1.vmac);
  assert.strictEqual(forwarded.destVmac, null);
});

test('VMAC collision with a new device UUID is NAKed 151 (AB.6.2.3)', () => {
  const hub = makeHub();
  join(hub, NODE1);
  const ws = new FakeWebSocket();
  ws.readyState = 1;
  hub.attachSocket(ws);
  ws.feed(bvlcSc.encodeConnectRequest({
    messageId: 9, vmac: NODE1.vmac, uuid: NODE3.uuid, maxBvlcLength: 6144, maxNpduLength: 1497
  }));
  const nak = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(nak.func, FN.BVLC_RESULT);
  assert.strictEqual(nak.result.errorCode, ERR.NODE_DUPLICATE_VMAC);
  assert.strictEqual(hub.connectedNodes.length, 1);
});

test('a Connect-Request using the hub hosting node VMAC is a collision', () => {
  const hub = makeHub();
  const ws = new FakeWebSocket();
  ws.readyState = 1;
  hub.attachSocket(ws);
  ws.feed(bvlcSc.encodeConnectRequest({
    messageId: 9, vmac: HUB_VMAC, uuid: NODE1.uuid, maxBvlcLength: 6144, maxNpduLength: 1497
  }));
  assert.strictEqual(bvlcSc.decodeMessage(ws.lastSent()).result.errorCode, ERR.NODE_DUPLICATE_VMAC);
});

test('known device UUID takes over: new connection accepted, old one closed (AB.6.2.3)', () => {
  const hub = makeHub();
  const oldWs = join(hub, NODE1);
  assert.strictEqual(hub.connectedNodes.length, 1);

  // same UUID, new VMAC (device rebooted and regenerated its Random-48)
  const rebooted = { vmac: Buffer.from('c2ffffffff01', 'hex'), uuid: NODE1.uuid };
  const newWs = join(hub, rebooted, 11);

  const accept = bvlcSc.decodeMessage(newWs.lastSent());
  assert.strictEqual(accept.func, FN.CONNECT_ACCEPT);
  assert.strictEqual(oldWs.terminated, true, 'stale connection must be closed');
  assert.strictEqual(hub.connectedNodes.length, 1);
  assert.strictEqual(hub.connectedNodes[0].vmac, bvlcSc.vmacToString(rebooted.vmac));

  // routing reaches the new connection
  const ws2 = join(hub, NODE2, 12);
  newWs.sent.length = 0;
  ws2.feed(bvlcSc.encodeEncapsulatedNpdu({ messageId: 2, destVmac: rebooted.vmac, npdu: Buffer.from('0100', 'hex') }));
  assert.strictEqual(newWs.sent.length, 1);
});

test('closed connections leave the routing table', () => {
  const hub = makeHub();
  const ws1 = join(hub, NODE1);
  const ws2 = join(hub, NODE2);
  ws1.emit('close', 1006, Buffer.alloc(0));
  assert.strictEqual(hub.connectedNodes.length, 1);
  ws2.sent.length = 0;
  // unicast to the departed node is now discarded
  ws2.feed(bvlcSc.encodeEncapsulatedNpdu({ messageId: 3, destVmac: NODE1.vmac, npdu: Buffer.from('0100', 'hex') }));
  assert.strictEqual(ws2.sent.length, 0);
});

test('stop() clears every connection', () => {
  const hub = makeHub();
  const ws1 = join(hub, NODE1);
  const ws2 = join(hub, NODE2);
  hub.stop(false);
  assert.strictEqual(hub.connectedNodes.length, 0);
  assert.ok(ws1.terminated);
  assert.ok(ws2.terminated);
  // late socket attach after stop is refused
  const late = new FakeWebSocket();
  late.readyState = 1;
  assert.strictEqual(hub.attachSocket(late), null);
  assert.deepStrictEqual(late.closeCalls, [1001]);
});
