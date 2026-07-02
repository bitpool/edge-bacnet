'use strict';
/** Shared test helpers for the BACnet/SC suites. */
const { EventEmitter } = require('node:events');
const SC = require('../../resources/node-bacstack-ts/dist/lib/sc-constants');
const bvlcSc = require('../../resources/node-bacstack-ts/dist/lib/bvlc-sc');

/**
 * Minimal scripted stand-in for a `ws` WebSocket. Drives SCConnection in both
 * roles without sockets: `open()` fires the client-side 'open' event, `feed()`
 * injects an inbound frame, `sent` records outbound frames.
 */
class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0; // CONNECTING
    this.protocol = SC.WS_SUBPROTOCOL_HUB;
    this.bufferedAmount = 0;
    this.sent = [];
    this.closeCalls = [];
    this.terminated = false;
  }
  send(buffer) { this.sent.push(Buffer.from(buffer)); }
  close(code) {
    this.closeCalls.push(code);
    this.readyState = 3;
  }
  terminate() {
    this.terminated = true;
    this.readyState = 3;
  }
  // test drivers
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  feed(buffer, isBinary = true) { this.emit('message', buffer, isBinary); }
  lastSent() { return this.sent[this.sent.length - 1]; }
  decodedSent() { return this.sent.map((b) => bvlcSc.decodeMessage(b)); }
}

/** Record every interesting SCConnection event for assertions. */
const track = (emitter, events) => {
  const seen = {};
  for (const event of events) {
    seen[event] = [];
    emitter.on(event, (payload) => seen[event].push(payload));
  }
  return seen;
};

module.exports = { FakeWebSocket, track };
