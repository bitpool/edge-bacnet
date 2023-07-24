'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeAbort = exports.encodeAbort = exports.decodeError = exports.encodeError = exports.decodeSegmentAck = exports.encodeSegmentAck = exports.decodeComplexAck = exports.encodeComplexAck = exports.decodeSimpleAck = exports.encodeSimpleAck = exports.decodeUnconfirmedServiceRequest = exports.encodeUnconfirmedServiceRequest = exports.decodeConfirmedServiceRequest = exports.encodeConfirmedServiceRequest = exports.getDecodedInvokeId = exports.setDecodedType = exports.getDecodedType = void 0;
const baEnum = require("./enum");
const getDecodedType = (buffer, offset) => {
    return buffer[offset];
};
exports.getDecodedType = getDecodedType;
const setDecodedType = (buffer, offset, type) => {
    buffer[offset] = type;
};
exports.setDecodedType = setDecodedType;
const getDecodedInvokeId = (buffer, offset) => {
    const type = (0, exports.getDecodedType)(buffer, offset);
    switch (type & baEnum.PDU_TYPE_MASK) {
        case baEnum.PduTypes.SIMPLE_ACK:
        case baEnum.PduTypes.COMPLEX_ACK:
        case baEnum.PduTypes.ERROR:
        case baEnum.PduTypes.REJECT:
        case baEnum.PduTypes.ABORT:
            return buffer[offset + 1];
        case baEnum.PduTypes.CONFIRMED_REQUEST:
            return buffer[offset + 2];
        default:
            return;
    }
};
exports.getDecodedInvokeId = getDecodedInvokeId;
const encodeConfirmedServiceRequest = (buffer, type, service, maxSegments, maxApdu, invokeId, sequencenumber, proposedWindowSize) => {
    buffer.buffer[buffer.offset++] = type;
    buffer.buffer[buffer.offset++] = maxSegments | maxApdu;
    buffer.buffer[buffer.offset++] = invokeId;
    if ((type & baEnum.PduConReqBits.SEGMENTED_MESSAGE) > 0) {
        buffer.buffer[buffer.offset++] = sequencenumber;
        buffer.buffer[buffer.offset++] = proposedWindowSize;
    }
    buffer.buffer[buffer.offset++] = service;
};
exports.encodeConfirmedServiceRequest = encodeConfirmedServiceRequest;
const decodeConfirmedServiceRequest = (buffer, offset) => {
    const orgOffset = offset;
    const type = buffer[offset++];
    const maxSegments = buffer[offset] & 0xF0;
    const maxApdu = buffer[offset++] & 0x0F;
    const invokeId = buffer[offset++];
    let sequencenumber = 0;
    let proposedWindowNumber = 0;
    if ((type & baEnum.PduConReqBits.SEGMENTED_MESSAGE) > 0) {
        sequencenumber = buffer[offset++];
        proposedWindowNumber = buffer[offset++];
    }
    const service = buffer[offset++];
    return {
        len: offset - orgOffset,
        type: type,
        service: service,
        maxSegments: maxSegments,
        maxApdu: maxApdu,
        invokeId: invokeId,
        sequencenumber: sequencenumber,
        proposedWindowNumber: proposedWindowNumber
    };
};
exports.decodeConfirmedServiceRequest = decodeConfirmedServiceRequest;
const encodeUnconfirmedServiceRequest = (buffer, type, service) => {
    buffer.buffer[buffer.offset++] = type;
    buffer.buffer[buffer.offset++] = service;
};
exports.encodeUnconfirmedServiceRequest = encodeUnconfirmedServiceRequest;
const decodeUnconfirmedServiceRequest = (buffer, offset) => {
    const orgOffset = offset;
    const type = buffer[offset++];
    const service = buffer[offset++];
    return {
        len: offset - orgOffset,
        type: type,
        service: service
    };
};
exports.decodeUnconfirmedServiceRequest = decodeUnconfirmedServiceRequest;
const encodeSimpleAck = (buffer, type, service, invokeId) => {
    buffer.buffer[buffer.offset++] = type;
    buffer.buffer[buffer.offset++] = invokeId;
    buffer.buffer[buffer.offset++] = service;
};
exports.encodeSimpleAck = encodeSimpleAck;
const decodeSimpleAck = (buffer, offset) => {
    const orgOffset = offset;
    const type = buffer[offset++];
    const invokeId = buffer[offset++];
    const service = buffer[offset++];
    return {
        len: offset - orgOffset,
        type: type,
        service: service,
        invokeId: invokeId
    };
};
exports.decodeSimpleAck = decodeSimpleAck;
const encodeComplexAck = (buffer, type, service, invokeId, sequencenumber, proposedWindowNumber) => {
    let len = 3;
    buffer.buffer[buffer.offset++] = type;
    buffer.buffer[buffer.offset++] = invokeId;
    if ((type & baEnum.PduConReqBits.SEGMENTED_MESSAGE) > 0) {
        buffer.buffer[buffer.offset++] = sequencenumber;
        buffer.buffer[buffer.offset++] = proposedWindowNumber;
        len += 2;
    }
    buffer.buffer[buffer.offset++] = service;
    return len;
};
exports.encodeComplexAck = encodeComplexAck;
const decodeComplexAck = (buffer, offset) => {
    const orgOffset = offset;
    const type = buffer[offset++];
    const invokeId = buffer[offset++];
    let sequencenumber = 0;
    let proposedWindowNumber = 0;
    if ((type & baEnum.PduConReqBits.SEGMENTED_MESSAGE) > 0) {
        sequencenumber = buffer[offset++];
        proposedWindowNumber = buffer[offset++];
    }
    const service = buffer[offset++];
    return {
        len: offset - orgOffset,
        type: type,
        service: service,
        invokeId: invokeId,
        sequencenumber: sequencenumber,
        proposedWindowNumber: proposedWindowNumber
    };
};
exports.decodeComplexAck = decodeComplexAck;
const encodeSegmentAck = (buffer, type, originalInvokeId, sequencenumber, actualWindowSize) => {
    buffer.buffer[buffer.offset++] = type;
    buffer.buffer[buffer.offset++] = originalInvokeId;
    buffer.buffer[buffer.offset++] = sequencenumber;
    buffer.buffer[buffer.offset++] = actualWindowSize;
};
exports.encodeSegmentAck = encodeSegmentAck;
const decodeSegmentAck = (buffer, offset) => {
    const orgOffset = offset;
    const type = buffer[offset++];
    const originalInvokeId = buffer[offset++];
    const sequencenumber = buffer[offset++];
    const actualWindowSize = buffer[offset++];
    return {
        len: offset - orgOffset,
        type: type,
        originalInvokeId: originalInvokeId,
        sequencenumber: sequencenumber,
        actualWindowSize: actualWindowSize
    };
};
exports.decodeSegmentAck = decodeSegmentAck;
const encodeError = (buffer, type, service, invokeId) => {
    buffer.buffer[buffer.offset++] = type;
    buffer.buffer[buffer.offset++] = invokeId;
    buffer.buffer[buffer.offset++] = service;
};
exports.encodeError = encodeError;
const decodeError = (buffer, offset) => {
    const orgOffset = offset;
    const type = buffer[offset++];
    const invokeId = buffer[offset++];
    const service = buffer[offset++];
    return {
        len: offset - orgOffset,
        type: type,
        service: service,
        invokeId: invokeId
    };
};
exports.decodeError = decodeError;
const encodeAbort = (buffer, type, invokeId, reason) => {
    buffer.buffer[buffer.offset++] = type;
    buffer.buffer[buffer.offset++] = invokeId;
    buffer.buffer[buffer.offset++] = reason;
};
exports.encodeAbort = encodeAbort;
const decodeAbort = (buffer, offset) => {
    const orgOffset = offset;
    const type = buffer[offset++];
    const invokeId = buffer[offset++];
    const reason = buffer[offset++];
    return {
        len: offset - orgOffset,
        type: type,
        invokeId: invokeId,
        reason: reason
    };
};
exports.decodeAbort = decodeAbort;
