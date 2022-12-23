'use strict';

const baAsn1      = require('./asn1');
const baEnum      = require('./enum');
const debug       = require('debug')('bacnet:apdu:debug');
const trace       = require('debug')('bacnet:apdu:trace');

const getDecodedType = module.exports.getDecodedType = (buffer, offset) => {
  return buffer[offset];
};

module.exports.setDecodedType = (buffer, offset, type) => {
  buffer[offset] = type;
};

module.exports.getDecodedInvokeId = (buffer, offset) => {
  const type = getDecodedType(buffer, offset);
  switch (type & baEnum.PDU_TYPE_MASK) {
    case baEnum.PduType.SIMPLE_ACK:
    case baEnum.PduType.COMPLEX_ACK:
    case baEnum.PduType.ERROR:
    case baEnum.PduType.REJECT:
    case baEnum.PduType.ABORT:
      return buffer[offset + 1];
    case baEnum.PduType.CONFIRMED_REQUEST:
      return buffer[offset + 2];
    default:
      return undefined;
  }
};

module.exports.encodeConfirmedServiceRequest = (buffer, type, service, maxSegments, maxApdu, invokeId, sequencenumber, proposedWindowSize) => {
  buffer.buffer[buffer.offset++] = type;
  buffer.buffer[buffer.offset++] = maxSegments | maxApdu;
  buffer.buffer[buffer.offset++] = invokeId;
  if ((type & baEnum.PduConReqBit.SEGMENTED_MESSAGE) > 0) {
    buffer.buffer[buffer.offset++] = sequencenumber;
    buffer.buffer[buffer.offset++] = proposedWindowSize;
  }
  buffer.buffer[buffer.offset++] = service;
};

module.exports.decodeConfirmedServiceRequest = (buffer, offset) => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const maxSegments = buffer[offset] & 0xF0;
  const maxApdu = buffer[offset++] & 0x0F;
  const invokeId = buffer[offset++];
  let sequencenumber = 0;
  let proposedWindowNumber = 0;
  if ((type & baEnum.PduConReqBit.SEGMENTED_MESSAGE) > 0) {
    sequencenumber = buffer[offset++];
    proposedWindowNumber = buffer[offset++];
  }
  const service = buffer[offset++];
  return {
    len: offset - orgOffset,
    type,
    service,
    maxSegments,
    maxApdu,
    invokeId,
    sequencenumber,
    proposedWindowNumber
  };
};

module.exports.encodeUnconfirmedServiceRequest = (buffer, type, service) => {
  buffer.buffer[buffer.offset++] = type;
  buffer.buffer[buffer.offset++] = service;
};

module.exports.decodeUnconfirmedServiceRequest = (buffer, offset) => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const service = buffer[offset++];
  return {
    len: offset - orgOffset,
    type,
    service
  };
};

module.exports.encodeSimpleAck = (buffer, type, service, invokeId) => {
  buffer.buffer[buffer.offset++] = type;
  buffer.buffer[buffer.offset++] = invokeId;
  buffer.buffer[buffer.offset++] = service;
};

module.exports.decodeSimpleAck = (buffer, offset) => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const invokeId = buffer[offset++];
  const service = buffer[offset++];
  return {
    len: offset - orgOffset,
    type,
    service,
    invokeId
  };
};

module.exports.encodeComplexAck = (buffer, type, service, invokeId, sequencenumber, proposedWindowNumber) => {
  let len = 3;
  buffer.buffer[buffer.offset++] = type;
  buffer.buffer[buffer.offset++] = invokeId;
  if ((type & baEnum.PduConReqBit.SEGMENTED_MESSAGE) > 0) {
    buffer.buffer[buffer.offset++] = sequencenumber;
    buffer.buffer[buffer.offset++] = proposedWindowNumber;
    len += 2;
  }
  buffer.buffer[buffer.offset++] = service;
  return len;
};

module.exports.decodeComplexAck = (buffer, offset) => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const invokeId = buffer[offset++];
  let sequencenumber = 0;
  let proposedWindowNumber = 0;
  if ((type & baEnum.PduConReqBit.SEGMENTED_MESSAGE) > 0) {
    sequencenumber = buffer[offset++];
    proposedWindowNumber = buffer[offset++];
  }
  const service = buffer[offset++];
  return {
    len: offset - orgOffset,
    type,
    service,
    invokeId,
    sequencenumber,
    proposedWindowNumber
  };
};

module.exports.encodeSegmentAck = (buffer, type, originalInvokeId, sequencenumber, actualWindowSize) => {
  buffer.buffer[buffer.offset++] = type;
  buffer.buffer[buffer.offset++] = originalInvokeId;
  buffer.buffer[buffer.offset++] = sequencenumber;
  buffer.buffer[buffer.offset++] = actualWindowSize;
};

module.exports.decodeSegmentAck = (buffer, offset) => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const originalInvokeId = buffer[offset++];
  const sequencenumber = buffer[offset++];
  const actualWindowSize = buffer[offset++];
  return {
    len: offset - orgOffset,
    type,
    originalInvokeId,
    sequencenumber,
    actualWindowSize
  };
};

module.exports.encodeResult = (buffer, /* BvlcResultFormat */ resultCode) => {
  baAsn1.encodeUnsigned(buffer, resultCode, 2);
};

module.exports.decodeResult = (buffer, offset) => {
  const orgOffset = offset;
  const decode = baAsn1.decodeUnsigned(buffer, offset, 2);
  offset += decode.len;
  return {
    len: offset - orgOffset,
    resultCode: decode.value, // BvlcResultFormat
  };
};

module.exports.encodeError = (buffer, type, service, invokeId) => {
  buffer.buffer[buffer.offset++] = type;
  buffer.buffer[buffer.offset++] = invokeId;
  buffer.buffer[buffer.offset++] = service;
};

module.exports.decodeError = (buffer, offset) => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const invokeId = buffer[offset++];
  const service = buffer[offset++];
  return {
    len: offset - orgOffset,
    type,
    service,
    invokeId
  };
};

module.exports.encodeAbort = (buffer, type, invokeId, reason) => {
  buffer.buffer[buffer.offset++] = type;
  buffer.buffer[buffer.offset++] = invokeId;
  buffer.buffer[buffer.offset++] = reason;
};

module.exports.decodeAbort = (buffer, offset) => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const invokeId = buffer[offset++];
  const reason = buffer[offset++];
  return {
    len: offset - orgOffset,
    type,
    invokeId,
    reason
  };
};
