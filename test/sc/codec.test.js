'use strict';
/**
 * BVLC-SC codec tests. Golden vectors are transcribed byte-exact from
 * ANSI/ASHRAE 135-2020 Figures AB-5, AB-6 and AB-7.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const SC = require('../../resources/node-bacstack-ts/dist/lib/sc-constants');
const bvlcSc = require('../../resources/node-bacstack-ts/dist/lib/bvlc-sc');

const FN = SC.BvlcScFunction;
const ERR = SC.ScErrorCode;

const hex = (s) => Buffer.from(s.replace(/[\s|]/g, ''), 'hex');

// Figure AB-5: Encapsulated-NPDU sent to the hub, 40 octets
const VECTOR_AB5 = hex(`
  01 07 b5ec 927bf71a96a2
  bf 0007 022b bac5ecc099
  3f 0003 0309 39
  01
  0104 0000010c0c000000051955
`);
// Figure AB-6: BVLC-Result NAK with UTF-8 'Error Details', 35 octets
const VECTOR_AB6 = hex('0008b5ec927bf71a96a20101bf00070111556e6dc3b6676c696368657220436f646521');
// Figure AB-7: BVLC-Result NAK without 'Error Details', 17 octets
const VECTOR_AB7 = hex('0008b5ec927bf71a96a201013f00070117');

// Deterministic PRNG for the property/fuzz loops (no Math.random in tests)
const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('golden vector AB-5: decode every field', () => {
  assert.strictEqual(VECTOR_AB5.length, 40);
  const msg = bvlcSc.decodeMessage(VECTOR_AB5);
  assert.strictEqual(msg.func, FN.ENCAPSULATED_NPDU);
  assert.strictEqual(msg.controlFlags, 0x07);
  assert.strictEqual(msg.messageId, 0xB5EC);
  assert.strictEqual(msg.origVmac, null);
  assert.strictEqual(bvlcSc.vmacToString(msg.destVmac), '92:7B:F7:1A:96:A2');
  assert.strictEqual(msg.isBroadcast, false);

  assert.strictEqual(msg.destOptions.length, 2);
  const [opt1, opt2] = msg.destOptions;
  assert.strictEqual(opt1.marker, 0xBF);
  assert.strictEqual(opt1.type, SC.HeaderOptionType.PROPRIETARY);
  assert.strictEqual(opt1.mustUnderstand, false);
  assert.strictEqual(opt1.more, true);
  assert.strictEqual(opt1.headerData.readUInt16BE(0), 555);
  assert.deepStrictEqual(opt1.headerData.subarray(2), hex('bac5ecc099'));
  assert.strictEqual(opt2.marker, 0x3F);
  assert.strictEqual(opt2.more, false);
  assert.strictEqual(opt2.headerData.readUInt16BE(0), 777);
  assert.deepStrictEqual(opt2.headerData.subarray(2), hex('39'));

  assert.strictEqual(msg.dataOptions.length, 1);
  assert.strictEqual(msg.dataOptions[0].type, SC.HeaderOptionType.SECURE_PATH);
  assert.strictEqual(msg.dataOptions[0].marker, 0x01);
  assert.strictEqual(msg.dataOptions[0].headerData, null);

  assert.deepStrictEqual(msg.payload, hex('01040000010c0c000000051955'));
});

test('golden vector AB-5: re-encode reproduces identical bytes', () => {
  const msg = bvlcSc.decodeMessage(VECTOR_AB5);
  const reEncoded = bvlcSc.encodeMessage({
    func: msg.func,
    messageId: msg.messageId,
    destVmac: msg.destVmac,
    destOptions: msg.destOptions.map((o) => ({
      type: o.type,
      mustUnderstand: o.mustUnderstand,
      headerData: o.headerData
    })),
    dataOptions: msg.dataOptions.map((o) => ({
      type: o.type,
      mustUnderstand: o.mustUnderstand,
      headerData: o.headerData
    })),
    payload: msg.payload
  });
  assert.deepStrictEqual(reEncoded, VECTOR_AB5);
  // and via raw options pass-through
  const passThrough = bvlcSc.encodeEncapsulatedNpdu({
    messageId: msg.messageId,
    destVmac: msg.destVmac,
    destOptions: msg.destOptionsRaw,
    dataOptions: msg.dataOptionsRaw,
    npdu: msg.payload
  });
  assert.deepStrictEqual(passThrough, VECTOR_AB5);
});

test('golden vector AB-6: BVLC-Result NAK with error details', () => {
  assert.strictEqual(VECTOR_AB6.length, 35);
  const msg = bvlcSc.decodeMessage(VECTOR_AB6);
  assert.strictEqual(msg.func, FN.BVLC_RESULT);
  assert.strictEqual(msg.controlFlags, 0x08);
  assert.strictEqual(msg.messageId, 0xB5EC);
  assert.strictEqual(bvlcSc.vmacToString(msg.origVmac), '92:7B:F7:1A:96:A2');
  assert.strictEqual(msg.destVmac, null);
  assert.deepStrictEqual(msg.result, {
    resultForFunction: FN.ENCAPSULATED_NPDU,
    resultCode: SC.ResultCode.NAK,
    errorHeaderMarker: 0xBF,
    errorClass: SC.ScErrorClass.COMMUNICATION,
    errorCode: 273,
    errorDetails: 'Unmöglicher Code!'
  });
  const reEncoded = bvlcSc.encodeResult({
    messageId: msg.messageId,
    origVmac: msg.origVmac,
    resultForFunction: msg.result.resultForFunction,
    resultCode: msg.result.resultCode,
    errorHeaderMarker: msg.result.errorHeaderMarker,
    errorClass: msg.result.errorClass,
    errorCode: msg.result.errorCode,
    errorDetails: msg.result.errorDetails
  });
  assert.deepStrictEqual(reEncoded, VECTOR_AB6);
});

test('golden vector AB-7: BVLC-Result NAK without error details', () => {
  assert.strictEqual(VECTOR_AB7.length, 17);
  const msg = bvlcSc.decodeMessage(VECTOR_AB7);
  assert.deepStrictEqual(msg.result, {
    resultForFunction: FN.ENCAPSULATED_NPDU,
    resultCode: SC.ResultCode.NAK,
    errorHeaderMarker: 0x3F,
    errorClass: SC.ScErrorClass.COMMUNICATION,
    errorCode: 279,
    errorDetails: ''
  });
  const reEncoded = bvlcSc.encodeResult({
    messageId: msg.messageId,
    origVmac: msg.origVmac,
    resultForFunction: msg.result.resultForFunction,
    resultCode: msg.result.resultCode,
    errorHeaderMarker: msg.result.errorHeaderMarker,
    errorClass: msg.result.errorClass,
    errorCode: msg.result.errorCode
  });
  assert.deepStrictEqual(reEncoded, VECTOR_AB7);
});

test('truncation sweep: prefixes throw ScDecodeError below the minimal-valid boundary', () => {
  // A prefix that cuts inside a variable-length trailing field (NPDU payload,
  // BVLC-Result error details) is still a structurally valid BVLC message —
  // MESSAGE_INCOMPLETE applies to BVLC fields, not payload content. The
  // boundary is the shortest structurally valid prefix of each vector.
  const cases = [
    { vector: VECTOR_AB5, minimalValid: 28 }, // header 10 + dest options 16 + data option 1 + >=1 payload octet
    { vector: VECTOR_AB6, minimalValid: 17 }, // header 10 + result 2 + marker 1 + class 2 + code 2 (details may be empty)
    { vector: VECTOR_AB7, minimalValid: 17 }  // identical shape, no details — only the full message is valid
  ];
  for (const { vector, minimalValid } of cases) {
    for (let n = 0; n < vector.length; n++) {
      const prefix = vector.subarray(0, n);
      if (n < minimalValid) {
        assert.throws(
          () => bvlcSc.decodeMessage(prefix),
          bvlcSc.ScDecodeError,
          `prefix length ${n} of ${vector.length} must throw ScDecodeError`
        );
      } else {
        assert.doesNotThrow(
          () => bvlcSc.decodeMessage(prefix),
          `prefix length ${n} of ${vector.length} is structurally valid and must decode`
        );
      }
    }
  }
});

test('malformed input error-code mapping', () => {
  const code = (buf) => {
    try {
      bvlcSc.decodeMessage(buf);
      return null;
    } catch (e) {
      assert.ok(e instanceof bvlcSc.ScDecodeError);
      assert.strictEqual(e.errorClass, SC.ScErrorClass.COMMUNICATION);
      return e.bacnetErrorCode;
    }
  };
  // reserved control-flag bits => PARAMETER_OUT_OF_RANGE
  assert.strictEqual(code(hex('0110 0001')), ERR.PARAMETER_OUT_OF_RANGE);
  // unknown BVLC function => BVLC_FUNCTION_UNKNOWN
  assert.strictEqual(code(hex('0d00 0001')), ERR.BVLC_FUNCTION_UNKNOWN);
  assert.strictEqual(code(hex('ff00 0001')), ERR.BVLC_FUNCTION_UNKNOWN);
  // Heartbeat-Request with a payload => UNEXPECTED_DATA
  assert.strictEqual(code(hex('0a00 0001 aa')), ERR.UNEXPECTED_DATA);
  // Encapsulated-NPDU without payload => PAYLOAD_EXPECTED
  assert.strictEqual(code(hex('0100 0001')), ERR.PAYLOAD_EXPECTED);
  // Connect-Request without payload => PAYLOAD_EXPECTED, truncated => MESSAGE_INCOMPLETE
  assert.strictEqual(code(hex('0600 0001')), ERR.PAYLOAD_EXPECTED);
  assert.strictEqual(code(hex('0600 0001 aabb')), ERR.MESSAGE_INCOMPLETE);
  // Connect-Request carrying VMAC address fields => PARAMETER_OUT_OF_RANGE
  assert.strictEqual(code(Buffer.concat([hex('0608 0001 aabbccddeeff'), Buffer.alloc(26)])), ERR.PARAMETER_OUT_OF_RANGE);
  // data options flag on a non-NPDU message => PARAMETER_OUT_OF_RANGE
  assert.strictEqual(code(hex('0201 0001 01')), ERR.PARAMETER_OUT_OF_RANGE);
  // header option type 0 => HEADER_ENCODING_ERROR
  assert.strictEqual(code(hex('0102 0001 00 aa')), ERR.HEADER_ENCODING_ERROR);
  // option HAS_DATA with missing length octets => HEADER_ENCODING_ERROR
  assert.strictEqual(code(hex('0102 0001 3f')), ERR.HEADER_ENCODING_ERROR);
  // option data overruns the message => MESSAGE_INCOMPLETE
  assert.strictEqual(code(hex('0102 0001 3f 00ff 0309')), ERR.MESSAGE_INCOMPLETE);
  // Secure Path option carrying data => HEADER_ENCODING_ERROR
  assert.strictEqual(code(hex('0102 0001 21 0001 aa 00')), ERR.HEADER_ENCODING_ERROR);
  // proprietary option with fewer than 3 data octets => HEADER_ENCODING_ERROR
  assert.strictEqual(code(hex('0102 0001 3f 0002 0309 00')), ERR.HEADER_ENCODING_ERROR);
  // BVLC-Result ACK with trailing bytes => UNEXPECTED_DATA
  assert.strictEqual(code(hex('0000 0001 0100 aa')), ERR.UNEXPECTED_DATA);
  // BVLC-Result code out of range => PARAMETER_OUT_OF_RANGE
  assert.strictEqual(code(hex('0000 0001 0102')), ERR.PARAMETER_OUT_OF_RANGE);
  // BVLC-Result NAK with truncated error parameters => MESSAGE_INCOMPLETE
  assert.strictEqual(code(hex('0000 0001 0101 bf 0007')), ERR.MESSAGE_INCOMPLETE);
  // Advertisement enum out of range => PARAMETER_OUT_OF_RANGE
  assert.strictEqual(code(hex('0400 0001 03 00 1800 05dd')), ERR.PARAMETER_OUT_OF_RANGE);
  assert.strictEqual(code(hex('0400 0001 01 02 1800 05dd')), ERR.PARAMETER_OUT_OF_RANGE);
  // Proprietary message payload shorter than 3 => MESSAGE_INCOMPLETE
  assert.strictEqual(code(hex('0c00 0001 022b')), ERR.MESSAGE_INCOMPLETE);
});

test('valid control messages decode cleanly', () => {
  const heartbeat = bvlcSc.decodeMessage(bvlcSc.encodeHeartbeatRequest({ messageId: 0x1234 }));
  assert.strictEqual(heartbeat.func, FN.HEARTBEAT_REQUEST);
  assert.strictEqual(heartbeat.messageId, 0x1234);

  const connect = bvlcSc.decodeMessage(bvlcSc.encodeConnectRequest({
    messageId: 1,
    vmac: hex('c2a15e3307b4'),
    uuid: hex('00112233445566778899aabbccddeeff'),
    maxBvlcLength: 6144,
    maxNpduLength: 1497
  }));
  assert.strictEqual(bvlcSc.vmacToString(connect.connect.vmac), 'C2:A1:5E:33:07:B4');
  assert.strictEqual(bvlcSc.uuidToString(connect.connect.uuid), '00112233-4455-6677-8899-aabbccddeeff');
  assert.strictEqual(connect.connect.maxBvlcLength, 6144);
  assert.strictEqual(connect.connect.maxNpduLength, 1497);

  const advertisement = bvlcSc.decodeMessage(bvlcSc.encodeAdvertisement({
    messageId: 2,
    hubConnectionStatus: SC.HubConnectionStatus.CONNECTED_TO_PRIMARY,
    acceptsDirectConnections: 0,
    maxBvlcLength: 6144,
    maxNpduLength: 1497
  }));
  assert.strictEqual(advertisement.advertisement.hubConnectionStatus, 1);

  // empty URI list is a legal Address-Resolution-ACK payload
  const ara = bvlcSc.decodeMessage(bvlcSc.encodeAddressResolutionAck({ messageId: 3, uris: [] }));
  assert.deepStrictEqual(ara.addressResolutionAck.uris, []);
  const ara2 = bvlcSc.decodeMessage(bvlcSc.encodeAddressResolutionAck({
    messageId: 4,
    uris: ['wss://a.example:4443', 'wss://b.example:4443']
  }));
  assert.deepStrictEqual(ara2.addressResolutionAck.uris, ['wss://a.example:4443', 'wss://b.example:4443']);

  const prop = bvlcSc.decodeMessage(bvlcSc.encodeProprietaryMessage({
    messageId: 5,
    vendorId: 1401,
    proprietaryFunction: 7,
    data: hex('c0ffee')
  }));
  assert.strictEqual(prop.proprietary.vendorId, 1401);
  assert.strictEqual(prop.proprietary.proprietaryFunction, 7);
  assert.deepStrictEqual(prop.proprietary.data, hex('c0ffee'));

  const broadcastNpdu = bvlcSc.decodeMessage(bvlcSc.encodeEncapsulatedNpdu({
    messageId: 6,
    destVmac: SC.BROADCAST_VMAC,
    npdu: hex('0100')
  }));
  assert.strictEqual(broadcastNpdu.isBroadcast, true);
});

test('encodeEncapsulatedNpdu honours offset/length windows', () => {
  const backing = hex('deadbeef 0104 0000010c0c000000051955 deadbeef');
  const encoded = bvlcSc.encodeEncapsulatedNpdu({
    messageId: 0xB5EC,
    destVmac: hex('927bf71a96a2'),
    npdu: backing,
    offset: 4,
    length: 13
  });
  const decoded = bvlcSc.decodeMessage(encoded);
  assert.deepStrictEqual(decoded.payload, hex('01040000010c0c000000051955'));
});

test('round-trip property loop across flag/option/payload permutations', () => {
  const rand = mulberry32(0xBAC0);
  const randInt = (max) => Math.floor(rand() * max);
  const randBytes = (n) => {
    const b = Buffer.allocUnsafe(n);
    for (let i = 0; i < n; i++) b[i] = randInt(256);
    return b;
  };
  for (let i = 0; i < 500; i++) {
    // Use Encapsulated-NPDU (the only function allowing every optional field)
    const origVmac = rand() < 0.5 ? randBytes(6) : undefined;
    const destVmac = rand() < 0.5 ? randBytes(6) : undefined;
    const makeOptions = (allowSecurePath) => {
      const count = randInt(4); // 0..3
      const options = [];
      for (let k = 0; k < count; k++) {
        if (allowSecurePath && rand() < 0.3) {
          options.push({ type: SC.HeaderOptionType.SECURE_PATH, mustUnderstand: rand() < 0.5, headerData: null });
        } else {
          options.push({
            type: SC.HeaderOptionType.PROPRIETARY,
            mustUnderstand: rand() < 0.5,
            headerData: Buffer.concat([randBytes(3), randBytes(randInt(20))])
          });
        }
      }
      return options;
    };
    const message = {
      func: FN.ENCAPSULATED_NPDU,
      messageId: randInt(0x10000),
      origVmac,
      destVmac,
      destOptions: makeOptions(true),
      dataOptions: makeOptions(true),
      payload: randBytes(1 + randInt(2000))
    };
    const encoded = bvlcSc.encodeMessage(message);
    const decoded = bvlcSc.decodeMessage(encoded);
    assert.strictEqual(decoded.messageId, message.messageId);
    assert.deepStrictEqual(decoded.origVmac, origVmac || null);
    assert.deepStrictEqual(decoded.destVmac, destVmac || null);
    assert.strictEqual(decoded.destOptions.length, message.destOptions.length);
    assert.strictEqual(decoded.dataOptions.length, message.dataOptions.length);
    assert.deepStrictEqual(decoded.payload, message.payload);
    const reEncoded = bvlcSc.encodeMessage({
      func: decoded.func,
      messageId: decoded.messageId,
      origVmac: decoded.origVmac,
      destVmac: decoded.destVmac,
      destOptions: decoded.destOptionsRaw,
      dataOptions: decoded.dataOptionsRaw,
      payload: decoded.payload
    });
    assert.deepStrictEqual(reEncoded, encoded);
  }
});

test('random-bytes fuzz: decode throws ScDecodeError or returns, never crashes', () => {
  const rand = mulberry32(0x5EC);
  for (let i = 0; i < 10000; i++) {
    const length = Math.floor(rand() * 64);
    const buffer = Buffer.allocUnsafe(length);
    for (let k = 0; k < length; k++) buffer[k] = Math.floor(rand() * 256);
    try {
      bvlcSc.decodeMessage(buffer);
    } catch (e) {
      assert.ok(e instanceof bvlcSc.ScDecodeError, `iteration ${i}: threw ${e.name}: ${e.message}`);
    }
  }
});

test('generateRandom48: nibble rule holds, never broadcast, plausibly uniform', () => {
  const seenFirstOctets = new Set();
  for (let i = 0; i < 5000; i++) {
    const vmac = bvlcSc.generateRandom48();
    assert.strictEqual(vmac.length, 6);
    assert.strictEqual(vmac[0] & 0x0F, 0x02, 'low nibble of first octet must be X\'2\'');
    assert.ok(!bvlcSc.isBroadcastVmac(vmac));
    seenFirstOctets.add(vmac[0]);
  }
  // 16 possible high nibbles — with 5000 samples all should appear
  assert.strictEqual(seenFirstOctets.size, 16);
});

test('VMAC and UUID string round-trips', () => {
  assert.strictEqual(bvlcSc.vmacToString(hex('c2a15e3307b4')), 'C2:A1:5E:33:07:B4');
  assert.deepStrictEqual(bvlcSc.vmacFromString('C2:A1:5E:33:07:B4'), hex('c2a15e3307b4'));
  assert.deepStrictEqual(bvlcSc.vmacFromString('c2a15e3307b4'), hex('c2a15e3307b4'));
  assert.strictEqual(bvlcSc.tryVmacFromString('192.168.1.43'), null);
  assert.strictEqual(bvlcSc.tryVmacFromString('192.168.1.43:47808'), null);
  assert.strictEqual(bvlcSc.tryVmacFromString(''), null);
  assert.strictEqual(bvlcSc.tryVmacFromString(null), null);
  assert.throws(() => bvlcSc.vmacFromString('not-a-vmac'), TypeError);
  const uuid = '00112233-4455-6677-8899-aabbccddeeff';
  assert.strictEqual(bvlcSc.uuidToString(bvlcSc.uuidFromString(uuid)), uuid);
  assert.throws(() => bvlcSc.uuidFromString('short'), TypeError);
});

test('peekMessage: best-effort extraction, never throws', () => {
  assert.deepStrictEqual(bvlcSc.peekMessage(Buffer.alloc(0)), {
    func: null, messageId: null, destVmac: null, isBroadcast: false
  });
  const short = bvlcSc.peekMessage(hex('01'));
  assert.strictEqual(short.func, 0x01);
  assert.strictEqual(short.messageId, null);
  const peeked = bvlcSc.peekMessage(VECTOR_AB5);
  assert.strictEqual(peeked.func, FN.ENCAPSULATED_NPDU);
  assert.strictEqual(peeked.messageId, 0xB5EC);
  assert.strictEqual(bvlcSc.vmacToString(peeked.destVmac), '92:7B:F7:1A:96:A2');
  const broadcast = bvlcSc.peekMessage(bvlcSc.encodeEncapsulatedNpdu({
    messageId: 9, destVmac: SC.BROADCAST_VMAC, npdu: hex('0100')
  }));
  assert.strictEqual(broadcast.isBroadcast, true);
  // reserved-bit garbage still peeks without throwing
  const garbage = bvlcSc.peekMessage(hex('01f0 0001'));
  assert.strictEqual(garbage.messageId, 1);
});
