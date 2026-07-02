'use strict';
/**
 * SCConnection state-machine tests (Figures AB-11 / AB-12) using a scripted
 * fake WebSocket and node:test mock timers — no sockets, no ws dependency.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const SC = require('../../resources/node-bacstack-ts/dist/lib/sc-constants');
const bvlcSc = require('../../resources/node-bacstack-ts/dist/lib/bvlc-sc');
const { SCConnection } = require('../../resources/node-bacstack-ts/dist/lib/sc-connection');
const { FakeWebSocket, track: trackEvents } = require('./helpers');

const FN = SC.BvlcScFunction;
const ERR = SC.ScErrorCode;
const STATE = SC.ConnectionState;

const LOCAL_VMAC = Buffer.from('c2a15e3307b4', 'hex');
const LOCAL_UUID = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const HUB_VMAC = Buffer.from('927bf71a96a2', 'hex');
const HUB_UUID = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex');
const PEER_VMAC = Buffer.from('a2b2c2d2e2f2', 'hex');

const track = (conn) => trackEvents(conn, ['closed', 'status', 'npdu', 'connected', 'advertisement', 'routable']);

const makeInitiating = (overrides) => {
  const ws = new FakeWebSocket();
  const conn = new SCConnection(Object.assign({
    role: 'initiating',
    url: 'wss://hub.example:4443',
    vmac: LOCAL_VMAC,
    uuid: LOCAL_UUID,
    wsFactory: () => ws
  }, overrides || {}));
  const seen = track(conn);
  return { conn, ws, seen };
};

// Drive an initiating connection all the way to CONNECTED
const connectHappy = (overrides) => {
  const ctx = makeInitiating(overrides);
  ctx.conn.connect();
  ctx.ws.open();
  const connectRequest = bvlcSc.decodeMessage(ctx.ws.lastSent());
  ctx.ws.feed(bvlcSc.encodeConnectAccept({
    messageId: connectRequest.messageId,
    vmac: HUB_VMAC,
    uuid: HUB_UUID,
    maxBvlcLength: 6144,
    maxNpduLength: 1497
  }));
  ctx.ws.sent.length = 0;
  return ctx;
};

const assertTornDown = (conn, seen) => {
  assert.strictEqual(seen.closed.length, 1, "'closed' must be emitted exactly once");
  for (const [name, timer] of Object.entries(conn._timers))
    assert.strictEqual(timer, null, `timer '${name}' must be cleared after teardown`);
  assert.deepStrictEqual(conn._pending, {});
};

test('initiating handshake: Connect-Request bytes, Connect-Accept => CONNECTED', () => {
  const { conn, ws, seen } = makeInitiating();
  conn.connect();
  assert.strictEqual(conn.state, STATE.AWAITING_WEBSOCKET);
  ws.open();
  assert.strictEqual(conn.state, STATE.AWAITING_ACCEPT);

  assert.strictEqual(ws.sent.length, 1);
  const raw = ws.lastSent();
  assert.strictEqual(raw[0], FN.CONNECT_REQUEST);
  assert.strictEqual(raw[1], 0x00, 'connection peer messages carry no VMACs/options');
  assert.strictEqual(raw.length, 4 + 26);
  const request = bvlcSc.decodeMessage(raw);
  assert.deepStrictEqual(request.connect.vmac, LOCAL_VMAC);
  assert.deepStrictEqual(request.connect.uuid, LOCAL_UUID);
  assert.strictEqual(request.connect.maxBvlcLength, SC.Defaults.MAX_BVLC_ACCEPTED);
  assert.strictEqual(request.connect.maxNpduLength, SC.Defaults.MAX_NPDU_ACCEPTED);

  ws.feed(bvlcSc.encodeConnectAccept({
    messageId: request.messageId,
    vmac: HUB_VMAC, uuid: HUB_UUID, maxBvlcLength: 9999, maxNpduLength: 1497
  }));
  assert.strictEqual(conn.state, STATE.CONNECTED);
  assert.strictEqual(seen.connected.length, 1);
  assert.deepStrictEqual(seen.connected[0].peerVmac, HUB_VMAC);
  assert.deepStrictEqual(seen.connected[0].peerUuid, HUB_UUID);
  assert.strictEqual(seen.connected[0].peerMaxBvlc, 9999);
  assert.deepStrictEqual(conn.peerInfo.vmac, HUB_VMAC);
});

test('initiating: wrong subprotocol => close 1002, FAILED', () => {
  const { conn, ws, seen } = makeInitiating();
  ws.protocol = 'something.else';
  conn.connect();
  ws.open();
  assert.deepStrictEqual(ws.closeCalls, [1002]);
  assert.strictEqual(conn.state, STATE.FAILED);
  assert.strictEqual(seen.closed[0].reasonName, 'WEBSOCKET_PROTOCOL_ERROR');
  assertTornDown(conn, seen);
});

test('initiating: non-wss URL is refused up front', () => {
  const ws = new FakeWebSocket();
  const conn = new SCConnection({
    role: 'initiating', url: 'ws://insecure.example', vmac: LOCAL_VMAC, uuid: LOCAL_UUID,
    wsFactory: () => ws
  });
  const seen = track(conn);
  conn.connect();
  assert.strictEqual(conn.state, STATE.FAILED);
  assert.strictEqual(seen.closed[0].reasonName, 'WEBSOCKET_INITIATION_FAILED');
  assert.strictEqual(seen.status[0].code, 'WEBSOCKET_SCHEME_NOT_SUPPORTED');
});

test('initiating: NAK NODE_DUPLICATE_VMAC surfaces as its own close reason', () => {
  const { conn, ws, seen } = makeInitiating();
  conn.connect();
  ws.open();
  const request = bvlcSc.decodeMessage(ws.lastSent());
  ws.feed(bvlcSc.encodeResult({
    messageId: request.messageId,
    resultForFunction: FN.CONNECT_REQUEST,
    resultCode: SC.ResultCode.NAK,
    errorClass: SC.ScErrorClass.COMMUNICATION,
    errorCode: ERR.NODE_DUPLICATE_VMAC
  }));
  assert.strictEqual(seen.closed[0].reasonName, 'NODE_DUPLICATE_VMAC');
  assertTornDown(conn, seen);
});

test('initiating: other Connect NAK => CONNECT_REJECTED with nak detail', () => {
  const { conn, ws, seen } = makeInitiating();
  conn.connect();
  ws.open();
  const request = bvlcSc.decodeMessage(ws.lastSent());
  ws.feed(bvlcSc.encodeResult({
    messageId: request.messageId,
    resultForFunction: FN.CONNECT_REQUEST,
    resultCode: SC.ResultCode.NAK,
    errorClass: SC.ScErrorClass.COMMUNICATION,
    errorCode: ERR.NOT_A_BACNET_SC_HUB,
    errorDetails: 'wrong door'
  }));
  assert.strictEqual(seen.closed[0].reasonName, 'CONNECT_REJECTED');
  assert.strictEqual(seen.closed[0].nak.errorCode, ERR.NOT_A_BACNET_SC_HUB);
  assert.strictEqual(seen.closed[0].nak.errorDetails, 'wrong door');
  assertTornDown(conn, seen);
});

test('initiating: connect-wait expiry closes and fails', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { conn, ws, seen } = makeInitiating({ connectWaitMs: 10000 });
  conn.connect();
  ws.open();
  t.mock.timers.tick(9999);
  assert.strictEqual(conn.state, STATE.AWAITING_ACCEPT);
  t.mock.timers.tick(1);
  assert.strictEqual(conn.state, STATE.FAILED);
  assert.strictEqual(seen.closed[0].reasonName, 'CONNECT_WAIT_TIMEOUT');
  assertTornDown(conn, seen);
});

test('single-use: connect() twice throws', () => {
  const { conn } = makeInitiating();
  conn.connect();
  assert.throws(() => conn.connect(), /single-use/);
});

test('CONNECTED: text frame => close 1003', () => {
  const { conn, ws, seen } = connectHappy();
  ws.feed('hello', false);
  assert.deepStrictEqual(ws.closeCalls, [1003]);
  assert.strictEqual(seen.closed[0].reasonName, 'WEBSOCKET_DATA_NOT_ACCEPTED');
  assertTornDown(conn, seen);
});

test('CONNECTED: oversized BVLC message discarded without closing', () => {
  const { conn, ws, seen } = connectHappy({ maxBvlcAccepted: 100 });
  ws.feed(Buffer.alloc(101));
  assert.strictEqual(conn.state, STATE.CONNECTED);
  assert.strictEqual(seen.closed.length, 0);
  assert.ok(seen.status.some((s) => s.code === 'BVLC_OVERSIZED'));
});

test('CONNECTED: npdu delivery, unicast and broadcast', () => {
  const { conn, ws, seen } = connectHappy();
  ws.feed(bvlcSc.encodeEncapsulatedNpdu({
    messageId: 100, origVmac: PEER_VMAC, npdu: Buffer.from('0104deadbeef', 'hex')
  }));
  ws.feed(bvlcSc.encodeEncapsulatedNpdu({
    messageId: 101, origVmac: PEER_VMAC, destVmac: SC.BROADCAST_VMAC, npdu: Buffer.from('0100', 'hex')
  }));
  assert.strictEqual(seen.npdu.length, 2);
  assert.deepStrictEqual(seen.npdu[0].srcVmac, PEER_VMAC);
  assert.strictEqual(seen.npdu[0].isBroadcast, false);
  assert.deepStrictEqual(seen.npdu[0].npdu, Buffer.from('0104deadbeef', 'hex'));
  assert.strictEqual(seen.npdu[1].isBroadcast, true);
  assert.strictEqual(conn.state, STATE.CONNECTED);
});

test('CONNECTED (initiating): non-broadcast destination VMAC from hub is dropped (AB.5.4)', () => {
  const { conn, ws, seen } = connectHappy();
  ws.feed(bvlcSc.encodeEncapsulatedNpdu({
    messageId: 102, origVmac: PEER_VMAC, destVmac: Buffer.from('deadbeefcafe', 'hex'), npdu: Buffer.from('0100', 'hex')
  }));
  assert.strictEqual(seen.npdu.length, 0);
  assert.strictEqual(conn.state, STATE.CONNECTED);
});

test('sendNpdu: unicast carries destination VMAC, null means broadcast', () => {
  const { conn, ws } = connectHappy();
  assert.strictEqual(conn.sendNpdu(Buffer.from('0104', 'hex'), PEER_VMAC), true);
  assert.strictEqual(conn.sendNpdu(Buffer.from('0100', 'hex'), null), true);
  const [unicast, broadcast] = ws.decodedSent();
  assert.deepStrictEqual(unicast.destVmac, PEER_VMAC);
  assert.strictEqual(unicast.origVmac, null, 'originating VMAC absent when sending to the hub');
  assert.strictEqual(broadcast.isBroadcast, true);
});

test('sendNpdu returns false when not CONNECTED', () => {
  const { conn } = makeInitiating();
  assert.strictEqual(conn.sendNpdu(Buffer.from('0100', 'hex'), null), false);
});

test('heartbeat: idle fires Heartbeat-Request; ACK keeps the connection alive', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { conn, ws } = connectHappy({ heartbeatMs: 60000, heartbeatAckWaitMs: 5000 });
  t.mock.timers.tick(60000);
  assert.strictEqual(ws.sent.length, 1);
  const heartbeat = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(heartbeat.func, FN.HEARTBEAT_REQUEST);
  ws.feed(bvlcSc.encodeHeartbeatAck({ messageId: heartbeat.messageId }));
  t.mock.timers.tick(5000); // ack-wait must have been cleared
  assert.strictEqual(conn.state, STATE.CONNECTED);
  // idle timer re-armed by the inbound ACK
  t.mock.timers.tick(60000);
  assert.strictEqual(ws.sent.length, 2);
});

test('heartbeat: missing ACK terminates the connection', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { conn, ws, seen } = connectHappy({ heartbeatMs: 60000, heartbeatAckWaitMs: 5000 });
  t.mock.timers.tick(60000);
  assert.strictEqual(bvlcSc.decodeMessage(ws.lastSent()).func, FN.HEARTBEAT_REQUEST);
  t.mock.timers.tick(5000);
  assert.strictEqual(ws.terminated, true);
  assert.strictEqual(seen.closed[0].reasonName, 'HEARTBEAT_TIMEOUT');
  assertTornDown(conn, seen);
});

test('heartbeat: any inbound traffic defers the idle timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { conn, ws } = connectHappy({ heartbeatMs: 60000 });
  t.mock.timers.tick(59999);
  ws.feed(bvlcSc.encodeEncapsulatedNpdu({ messageId: 7, origVmac: PEER_VMAC, npdu: Buffer.from('0100', 'hex') }));
  t.mock.timers.tick(59999);
  assert.strictEqual(ws.sent.length, 0, 'heartbeat must not fire before a full idle interval');
  t.mock.timers.tick(1);
  assert.strictEqual(ws.sent.length, 1);
  assert.strictEqual(bvlcSc.decodeMessage(ws.lastSent()).func, FN.HEARTBEAT_REQUEST);
});

test('CONNECTED: peer Heartbeat-Request answered with echoing ACK', () => {
  const { ws } = connectHappy();
  ws.feed(bvlcSc.encodeHeartbeatRequest({ messageId: 0xABCD }));
  const ack = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(ack.func, FN.HEARTBEAT_ACK);
  assert.strictEqual(ack.messageId, 0xABCD);
});

test('CONNECTED: Disconnect-Request from peer => ACK, close 1000, clean', () => {
  const { conn, ws, seen } = connectHappy();
  ws.feed(bvlcSc.encodeDisconnectRequest({ messageId: 0x1111 }));
  const ack = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(ack.func, FN.DISCONNECT_ACK);
  assert.strictEqual(ack.messageId, 0x1111);
  assert.strictEqual(seen.closed[0].clean, true);
  assert.strictEqual(seen.closed[0].reasonName, 'DISCONNECTED_BY_PEER');
  assertTornDown(conn, seen);
});

test('disconnect(): Disconnect-Request then ACK => clean close', () => {
  const { conn, ws, seen } = connectHappy();
  conn.disconnect();
  assert.strictEqual(conn.state, STATE.DISCONNECTING);
  const request = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(request.func, FN.DISCONNECT_REQUEST);
  ws.feed(bvlcSc.encodeDisconnectAck({ messageId: request.messageId }));
  assert.strictEqual(seen.closed[0].clean, true);
  assertTornDown(conn, seen);
});

test('disconnect(): wait timeout still closes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { conn, ws, seen } = connectHappy({ disconnectWaitMs: 5000 });
  conn.disconnect();
  t.mock.timers.tick(5000);
  assert.strictEqual(seen.closed[0].reasonName, 'DISCONNECT_WAIT_TIMEOUT');
  assertTornDown(conn, seen);
});

test('must-understand unknown destination option: NAK 146 unicast, silence broadcast', () => {
  const { ws, seen } = connectHappy();
  const mustUnderstand = [{ type: 5, mustUnderstand: true, headerData: null }];
  // unicast (no dest VMAC — addressed to us via the hub connection)
  ws.feed(bvlcSc.encodeMessage({
    func: FN.ENCAPSULATED_NPDU, messageId: 0x2222, origVmac: PEER_VMAC,
    destOptions: mustUnderstand, payload: Buffer.from('0100', 'hex')
  }));
  const nak = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(nak.func, FN.BVLC_RESULT);
  assert.strictEqual(nak.messageId, 0x2222);
  assert.strictEqual(nak.result.errorCode, ERR.HEADER_NOT_UNDERSTOOD);
  assert.notStrictEqual(nak.result.errorHeaderMarker, 0);
  assert.deepStrictEqual(nak.destVmac, PEER_VMAC, 'NAK addressed back to the originator');
  assert.strictEqual(seen.npdu.length, 0, 'rejected message must not be delivered');

  // broadcast — silent drop
  ws.sent.length = 0;
  ws.feed(bvlcSc.encodeMessage({
    func: FN.ENCAPSULATED_NPDU, messageId: 0x2223, origVmac: PEER_VMAC, destVmac: SC.BROADCAST_VMAC,
    destOptions: mustUnderstand, payload: Buffer.from('0100', 'hex')
  }));
  assert.strictEqual(ws.sent.length, 0);
  assert.strictEqual(seen.npdu.length, 0);
});

test('Address-Resolution => NAK OPTIONAL_FUNCTIONALITY_NOT_SUPPORTED', () => {
  const { ws } = connectHappy();
  ws.feed(bvlcSc.encodeAddressResolution({ messageId: 0x3333, origVmac: PEER_VMAC }));
  const nak = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(nak.result.errorCode, ERR.OPTIONAL_FUNCTIONALITY_NOT_SUPPORTED);
  assert.strictEqual(nak.result.resultForFunction, FN.ADDRESS_RESOLUTION);
  assert.strictEqual(nak.messageId, 0x3333);
});

test('Advertisement-Solicitation => Advertisement with fresh message id', () => {
  const { ws } = connectHappy({
    advertisementProvider: () => ({ hubConnectionStatus: SC.HubConnectionStatus.CONNECTED_TO_PRIMARY })
  });
  ws.feed(bvlcSc.encodeAdvertisementSolicitation({ messageId: 0x4444, origVmac: PEER_VMAC }));
  const advertisement = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(advertisement.func, FN.ADVERTISEMENT);
  assert.notStrictEqual(advertisement.messageId, 0x4444, 'an Advertisement is not a response message');
  assert.deepStrictEqual(advertisement.destVmac, PEER_VMAC);
  assert.strictEqual(advertisement.advertisement.hubConnectionStatus, 1);
  assert.strictEqual(advertisement.advertisement.acceptsDirectConnections, 0);
});

test('inbound Advertisement is stored and emitted', () => {
  const { conn, ws, seen } = connectHappy();
  ws.feed(bvlcSc.encodeAdvertisement({
    messageId: 9, origVmac: PEER_VMAC,
    hubConnectionStatus: 2, acceptsDirectConnections: 1, maxBvlcLength: 4000, maxNpduLength: 1497
  }));
  assert.strictEqual(seen.advertisement.length, 1);
  assert.strictEqual(seen.advertisement[0].hubConnectionStatus, 2);
  assert.deepStrictEqual(seen.advertisement[0].srcVmac, PEER_VMAC);
  assert.strictEqual(conn.lastPeerAdvertisement.maxBvlcLength, 4000);
});

test('malformed unicast => NAK with mapped error code; malformed broadcast => silence', () => {
  const { ws } = connectHappy();
  // Heartbeat-Request with a payload => UNEXPECTED_DATA (unicast, NAKable)
  ws.feed(Buffer.from('0a000123aa', 'hex'));
  const nak = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(nak.func, FN.BVLC_RESULT);
  assert.strictEqual(nak.messageId, 0x0123);
  assert.strictEqual(nak.result.errorCode, ERR.UNEXPECTED_DATA);

  // Broadcast Encapsulated-NPDU with reserved flag bits set => silent drop
  ws.sent.length = 0;
  const broadcastBad = Buffer.concat([
    Buffer.from('01f40124', 'hex'), // func 0x01, flags 0xF4 (reserved bits + dest VMAC)
    SC.BROADCAST_VMAC,
    Buffer.from('0100', 'hex')
  ]);
  ws.feed(broadcastBad);
  assert.strictEqual(ws.sent.length, 0);
});

test('BVLC-Result NAK for a sent message surfaces as a status warning', () => {
  const { conn, ws, seen } = connectHappy();
  conn.sendNpdu(Buffer.from('0104', 'hex'), PEER_VMAC);
  const sentNpdu = bvlcSc.decodeMessage(ws.lastSent());
  ws.feed(bvlcSc.encodeResult({
    messageId: sentNpdu.messageId,
    origVmac: PEER_VMAC,
    resultForFunction: FN.ENCAPSULATED_NPDU,
    resultCode: SC.ResultCode.NAK,
    errorClass: SC.ScErrorClass.COMMUNICATION,
    errorCode: ERR.HEADER_NOT_UNDERSTOOD
  }));
  assert.ok(seen.status.some((s) => s.code === 'BVLC_NAK_RECEIVED'));
  assert.strictEqual(conn.state, STATE.CONNECTED);
});

test('ws error before establishment tears down with taxonomy reason', () => {
  const { conn, ws, seen } = makeInitiating();
  conn.connect();
  const err = new Error('getaddrinfo ENOTFOUND hub.example');
  err.code = 'ENOTFOUND';
  ws.emit('error', err);
  assert.strictEqual(conn.state, STATE.FAILED);
  assert.strictEqual(seen.closed[0].reasonName, 'DNS_NAME_RESOLUTION_FAILED');
  assertTornDown(conn, seen);
});

test('unexpected ws close in CONNECTED maps the close code', () => {
  const { conn, ws, seen } = connectHappy();
  ws.emit('close', 1006, Buffer.alloc(0));
  assert.strictEqual(seen.closed[0].reasonName, 'WEBSOCKET_CLOSED_ABNORMALLY');
  assert.strictEqual(seen.closed[0].clean, false);
  assertTornDown(conn, seen);
});

test('destroy() is idempotent and emits closed once', () => {
  const { conn, seen } = connectHappy();
  conn.destroy('TEST');
  conn.destroy('TEST_AGAIN');
  assert.strictEqual(seen.closed.length, 1);
  assert.strictEqual(seen.closed[0].reasonName, 'TEST');
});

// ---------------------------------------------------------------- accepting

const makeAccepting = (overrides) => {
  const ws = new FakeWebSocket();
  ws.readyState = 1; // adopted sockets are already open
  const conn = new SCConnection(Object.assign({
    role: 'accepting',
    ws,
    vmac: HUB_VMAC,
    uuid: HUB_UUID
  }, overrides || {}));
  const seen = track(conn);
  return { conn, ws, seen };
};

test('accepting: Connect-Request => Connect-Accept with local identity, CONNECTED', () => {
  const { conn, ws, seen } = makeAccepting();
  conn.connect();
  assert.strictEqual(conn.state, STATE.AWAITING_REQUEST);
  ws.feed(bvlcSc.encodeConnectRequest({
    messageId: 0x5555, vmac: LOCAL_VMAC, uuid: LOCAL_UUID, maxBvlcLength: 6144, maxNpduLength: 1497
  }));
  const accept = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(accept.func, FN.CONNECT_ACCEPT);
  assert.strictEqual(accept.messageId, 0x5555, 'Connect-Accept echoes the request message id');
  assert.deepStrictEqual(accept.connect.vmac, HUB_VMAC);
  assert.deepStrictEqual(accept.connect.uuid, HUB_UUID);
  assert.strictEqual(conn.state, STATE.CONNECTED);
  assert.deepStrictEqual(seen.connected[0].peerVmac, LOCAL_VMAC);
  assert.deepStrictEqual(conn.peerInfo.uuid, LOCAL_UUID);
});

test('accepting: duplicate VMAC => NAK 151 and close (AB.6.2.3)', () => {
  const { conn, ws, seen } = makeAccepting({ duplicateCheck: () => 'vmac-collision' });
  conn.connect();
  ws.feed(bvlcSc.encodeConnectRequest({
    messageId: 0x6666, vmac: HUB_VMAC, uuid: LOCAL_UUID, maxBvlcLength: 6144, maxNpduLength: 1497
  }));
  const nak = bvlcSc.decodeMessage(ws.lastSent());
  assert.strictEqual(nak.result.errorCode, ERR.NODE_DUPLICATE_VMAC);
  assert.strictEqual(nak.messageId, 0x6666);
  assert.strictEqual(conn.state, STATE.FAILED);
  assert.strictEqual(seen.connected.length, 0);
  assertTornDown(conn, seen);
});

test('accepting: uuid takeover is accepted and flagged', () => {
  const { conn, seen, ws } = makeAccepting({ duplicateCheck: () => 'uuid-takeover' });
  conn.connect();
  ws.feed(bvlcSc.encodeConnectRequest({
    messageId: 1, vmac: LOCAL_VMAC, uuid: LOCAL_UUID, maxBvlcLength: 6144, maxNpduLength: 1497
  }));
  assert.strictEqual(conn.state, STATE.CONNECTED);
  assert.strictEqual(seen.connected[0].tookOver, true);
});

test('accepting: connect-wait expiry closes the socket', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { conn, seen } = makeAccepting({ connectWaitMs: 10000 });
  conn.connect();
  t.mock.timers.tick(10000);
  assert.strictEqual(conn.state, STATE.FAILED);
  assert.strictEqual(seen.closed[0].reasonName, 'CONNECT_WAIT_TIMEOUT');
  assertTornDown(conn, seen);
});

test('accepting: destination-bearing messages are emitted as routable, not consumed', () => {
  const { conn, ws, seen } = makeAccepting();
  conn.connect();
  ws.feed(bvlcSc.encodeConnectRequest({
    messageId: 1, vmac: LOCAL_VMAC, uuid: LOCAL_UUID, maxBvlcLength: 6144, maxNpduLength: 1497
  }));
  ws.sent.length = 0;
  // unicast NPDU for another node
  ws.feed(bvlcSc.encodeEncapsulatedNpdu({ messageId: 2, destVmac: PEER_VMAC, npdu: Buffer.from('0104', 'hex') }));
  // broadcast
  ws.feed(bvlcSc.encodeEncapsulatedNpdu({ messageId: 3, destVmac: SC.BROADCAST_VMAC, npdu: Buffer.from('0100', 'hex') }));
  assert.strictEqual(seen.routable.length, 2);
  assert.deepStrictEqual(seen.routable[0].destVmac, PEER_VMAC);
  assert.strictEqual(seen.routable[1].isBroadcast, true);
  assert.strictEqual(seen.npdu.length, 0);
  // heartbeats still handled by the connection itself
  ws.feed(bvlcSc.encodeHeartbeatRequest({ messageId: 4 }));
  assert.strictEqual(bvlcSc.decodeMessage(ws.lastSent()).func, FN.HEARTBEAT_ACK);
});
