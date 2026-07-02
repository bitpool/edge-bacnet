'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeProprietaryMessage = exports.encodeHeartbeatAck = exports.encodeHeartbeatRequest = exports.encodeDisconnectAck = exports.encodeDisconnectRequest = exports.encodeAddressResolutionAck = exports.encodeAddressResolution = exports.encodeAdvertisementSolicitation = exports.encodeAdvertisement = exports.encodeConnectAccept = exports.encodeConnectRequest = exports.encodeResult = exports.encodeEncapsulatedNpdu = exports.encodeMessage = exports.decodeMessage = exports.peekMessage = exports.uuidFromString = exports.uuidToString = exports.isBroadcastVmac = exports.tryVmacFromString = exports.vmacFromString = exports.vmacToString = exports.generateRandom48 = exports.ScDecodeError = void 0;
/**
 * BACnet/SC Virtual Link Layer (BVLC-SC) codec. ANSI/ASHRAE 135-2020 ANNEX AB.2.
 * Pure encode/decode — no I/O, no timers. Malformed wire input throws
 * ScDecodeError carrying the Clause 21 error code the receiver must NAK with
 * (unicast only; the dispatch layer applies the broadcast-drop rule).
 */
const crypto = require("crypto");
const SC = require("./sc-constants");
const FN = SC.BvlcScFunction;
const FLAGS = SC.ControlFlags;
const OPT = SC.HeaderOptionFlags;
const ERR = SC.ScErrorCode;
class ScDecodeError extends Error {
    constructor(message, bacnetErrorCode, headerMarker) {
        super(message);
        this.name = 'ScDecodeError';
        this.bacnetErrorCode = bacnetErrorCode;
        this.errorClass = SC.ScErrorClass.COMMUNICATION;
        // BVLC-Result 'Error Header Marker' — X'00' when unrelated to a header option
        this.headerMarker = headerMarker || 0x00;
    }
}
exports.ScDecodeError = ScDecodeError;
// H.7.3 Random-48 VMAC: least significant 4 bits of the first octet are B'0010',
// the remaining 44 bits are uniformly random.
const generateRandom48 = () => {
    const vmac = crypto.randomBytes(6);
    vmac[0] = (vmac[0] & 0xF0) | 0x02;
    return vmac;
};
exports.generateRandom48 = generateRandom48;
const vmacToString = (vmac) => {
    const hex = vmac.toString('hex').toUpperCase();
    return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}:${hex.slice(8, 10)}:${hex.slice(10, 12)}`;
};
exports.vmacToString = vmacToString;
// Lenient parse used by the transport to recognise VMAC-shaped address strings
// (stale cached IP addresses etc. return null and are dropped by the caller).
const tryVmacFromString = (str) => {
    if (typeof str !== 'string')
        return null;
    const hex = str.replace(/[:]/g, '');
    if (!/^[0-9a-fA-F]{12}$/.test(hex))
        return null;
    return Buffer.from(hex, 'hex');
};
exports.tryVmacFromString = tryVmacFromString;
const vmacFromString = (str) => {
    const vmac = tryVmacFromString(str);
    if (!vmac)
        throw new TypeError(`Invalid VMAC address string: ${str}`);
    return vmac;
};
exports.vmacFromString = vmacFromString;
const isBroadcastVmac = (vmac) => Buffer.isBuffer(vmac) && vmac.length === 6 && vmac.equals(SC.BROADCAST_VMAC);
exports.isBroadcastVmac = isBroadcastVmac;
const uuidToString = (uuid) => {
    const hex = uuid.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
exports.uuidToString = uuidToString;
const uuidFromString = (str) => {
    if (typeof str !== 'string')
        throw new TypeError('Invalid UUID: not a string');
    const hex = str.replace(/-/g, '');
    if (!/^[0-9a-fA-F]{32}$/.test(hex))
        throw new TypeError(`Invalid UUID string: ${str}`);
    return Buffer.from(hex, 'hex');
};
exports.uuidFromString = uuidFromString;
// Best-effort header peek for NAK generation when full decode has failed.
// Never throws; fields are null when the buffer is too short to know.
const peekMessage = (buffer) => {
    const result = { func: null, messageId: null, destVmac: null, isBroadcast: false };
    if (!Buffer.isBuffer(buffer) || buffer.length < 1)
        return result;
    result.func = buffer[0];
    if (buffer.length < 4)
        return result;
    result.messageId = buffer.readUInt16BE(2);
    const flags = buffer[1];
    let offset = 4;
    if (flags & FLAGS.ORIG_VMAC)
        offset += 6;
    if (flags & FLAGS.DEST_VMAC) {
        if (buffer.length >= offset + 6) {
            result.destVmac = Buffer.from(buffer.subarray(offset, offset + 6));
            result.isBroadcast = (0, exports.isBroadcastVmac)(result.destVmac);
        }
    }
    return result;
};
exports.peekMessage = peekMessage;
// Messages exchanged only between connection peers (AB.2.10..AB.2.15) — the
// VMAC address fields shall be absent.
const isPeerOnlyFunction = (func) => func >= FN.CONNECT_REQUEST && func <= FN.HEARTBEAT_ACK;
const decodeOptionsList = (buffer, offset, mustBeAbsentDataOnSecurePath) => {
    const startOffset = offset;
    const options = [];
    let more = true;
    while (more) {
        if (options.length >= SC.Defaults.MAX_HEADER_OPTIONS)
            throw new ScDecodeError('Header options list exceeds implementation cap', ERR.HEADER_ENCODING_ERROR, options[options.length - 1].marker);
        if (offset + 1 > buffer.length)
            throw new ScDecodeError('Truncated header option marker', ERR.MESSAGE_INCOMPLETE);
        const marker = buffer[offset];
        offset += 1;
        const type = marker & OPT.TYPE_MASK;
        if (type === 0)
            throw new ScDecodeError('Header option type 0 is invalid', ERR.HEADER_ENCODING_ERROR, marker);
        let headerData = null;
        if (marker & OPT.HEADER_DATA) {
            if (offset + 2 > buffer.length)
                throw new ScDecodeError('Header option length octets missing', ERR.HEADER_ENCODING_ERROR, marker);
            const dataLength = buffer.readUInt16BE(offset);
            offset += 2;
            if (offset + dataLength > buffer.length)
                throw new ScDecodeError('Header option data overruns message', ERR.MESSAGE_INCOMPLETE, marker);
            headerData = buffer.subarray(offset, offset + dataLength);
            offset += dataLength;
        }
        if (type === SC.HeaderOptionType.SECURE_PATH && headerData !== null)
            throw new ScDecodeError('Secure Path option shall not carry header data', ERR.HEADER_ENCODING_ERROR, marker);
        if (type === SC.HeaderOptionType.PROPRIETARY && (headerData === null || headerData.length < 3))
            throw new ScDecodeError('Proprietary header option requires vendor id and option type', ERR.HEADER_ENCODING_ERROR, marker);
        options.push({
            marker: marker,
            type: type,
            mustUnderstand: (marker & OPT.MUST_UNDERSTAND) !== 0,
            more: (marker & OPT.MORE_OPTIONS) !== 0,
            headerData: headerData
        });
        more = (marker & OPT.MORE_OPTIONS) !== 0;
    }
    return {
        options: options,
        raw: buffer.subarray(startOffset, offset),
        endOffset: offset
    };
};
const decodeMessage = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4)
        throw new ScDecodeError('BVLC-SC message shorter than fixed header', ERR.MESSAGE_INCOMPLETE);
    const func = buffer[0];
    if (func > FN.PROPRIETARY_MESSAGE)
        throw new ScDecodeError(`Unknown BVLC function 0x${func.toString(16)}`, ERR.BVLC_FUNCTION_UNKNOWN);
    const controlFlags = buffer[1];
    if (controlFlags & FLAGS.RESERVED_MASK)
        throw new ScDecodeError('Reserved control flag bits set', ERR.PARAMETER_OUT_OF_RANGE);
    const messageId = buffer.readUInt16BE(2);
    let offset = 4;
    let origVmac = null;
    let destVmac = null;
    if (controlFlags & FLAGS.ORIG_VMAC) {
        if (offset + 6 > buffer.length)
            throw new ScDecodeError('Truncated originating VMAC', ERR.MESSAGE_INCOMPLETE);
        origVmac = buffer.subarray(offset, offset + 6);
        offset += 6;
    }
    if (controlFlags & FLAGS.DEST_VMAC) {
        if (offset + 6 > buffer.length)
            throw new ScDecodeError('Truncated destination VMAC', ERR.MESSAGE_INCOMPLETE);
        destVmac = buffer.subarray(offset, offset + 6);
        offset += 6;
    }
    if (isPeerOnlyFunction(func) && (origVmac || destVmac))
        throw new ScDecodeError('VMAC address fields shall be absent in connection peer messages', ERR.PARAMETER_OUT_OF_RANGE);
    let destOptions = [];
    let destOptionsRaw = null;
    if (controlFlags & FLAGS.DEST_OPTIONS) {
        const decoded = decodeOptionsList(buffer, offset);
        destOptions = decoded.options;
        destOptionsRaw = decoded.raw;
        offset = decoded.endOffset;
    }
    let dataOptions = [];
    let dataOptionsRaw = null;
    if (controlFlags & FLAGS.DATA_OPTIONS) {
        // AB.2.3: data options accompany data payloads for upper layers — for
        // standard messages only Encapsulated-NPDU conveys them
        if (func !== FN.ENCAPSULATED_NPDU)
            throw new ScDecodeError('Data options flag set on a message that shall not convey data options', ERR.PARAMETER_OUT_OF_RANGE);
        const decoded = decodeOptionsList(buffer, offset);
        dataOptions = decoded.options;
        dataOptionsRaw = decoded.raw;
        offset = decoded.endOffset;
    }
    const payload = buffer.subarray(offset);
    const message = {
        func: func,
        controlFlags: controlFlags,
        messageId: messageId,
        origVmac: origVmac,
        destVmac: destVmac,
        isBroadcast: (0, exports.isBroadcastVmac)(destVmac),
        destOptions: destOptions,
        destOptionsRaw: destOptionsRaw,
        dataOptions: dataOptions,
        dataOptionsRaw: dataOptionsRaw,
        payload: payload
    };
    switch (func) {
        case FN.BVLC_RESULT: {
            if (payload.length === 0)
                throw new ScDecodeError('BVLC-Result requires a payload', ERR.PAYLOAD_EXPECTED);
            if (payload.length < 2)
                throw new ScDecodeError('BVLC-Result payload truncated', ERR.MESSAGE_INCOMPLETE);
            const resultForFunction = payload[0];
            const resultCode = payload[1];
            if (resultCode > SC.ResultCode.NAK)
                throw new ScDecodeError('BVLC-Result code out of range', ERR.PARAMETER_OUT_OF_RANGE);
            if (resultCode === SC.ResultCode.ACK) {
                if (payload.length > 2)
                    throw new ScDecodeError('BVLC-Result ACK shall carry no error parameters', ERR.UNEXPECTED_DATA);
                message.result = { resultForFunction: resultForFunction, resultCode: resultCode };
            }
            else {
                if (payload.length < 7)
                    throw new ScDecodeError('BVLC-Result NAK error parameters truncated', ERR.MESSAGE_INCOMPLETE);
                message.result = {
                    resultForFunction: resultForFunction,
                    resultCode: resultCode,
                    errorHeaderMarker: payload[2],
                    errorClass: payload.readUInt16BE(3),
                    errorCode: payload.readUInt16BE(5),
                    // AB.2.4.1: UTF-8 reason text, no character set octet, no terminator
                    errorDetails: payload.subarray(7).toString('utf8')
                };
            }
            break;
        }
        case FN.ENCAPSULATED_NPDU: {
            if (payload.length === 0)
                throw new ScDecodeError('Encapsulated-NPDU requires an NPDU payload', ERR.PAYLOAD_EXPECTED);
            break;
        }
        case FN.ADDRESS_RESOLUTION_ACK: {
            const text = payload.toString('utf8');
            message.addressResolutionAck = {
                uris: text.length === 0 ? [] : text.split(' ').filter((uri) => uri.length > 0)
            };
            break;
        }
        case FN.ADVERTISEMENT: {
            if (payload.length === 0)
                throw new ScDecodeError('Advertisement requires a payload', ERR.PAYLOAD_EXPECTED);
            if (payload.length < 6)
                throw new ScDecodeError('Advertisement payload truncated', ERR.MESSAGE_INCOMPLETE);
            const hubConnectionStatus = payload[0];
            const acceptsDirectConnections = payload[1];
            if (hubConnectionStatus > SC.HubConnectionStatus.CONNECTED_TO_FAILOVER || acceptsDirectConnections > 1)
                throw new ScDecodeError('Advertisement enumeration value out of range', ERR.PARAMETER_OUT_OF_RANGE);
            message.advertisement = {
                hubConnectionStatus: hubConnectionStatus,
                acceptsDirectConnections: acceptsDirectConnections,
                maxBvlcLength: payload.readUInt16BE(2),
                maxNpduLength: payload.readUInt16BE(4)
            };
            break;
        }
        case FN.CONNECT_REQUEST:
        case FN.CONNECT_ACCEPT: {
            if (payload.length === 0)
                throw new ScDecodeError('Connect message requires a payload', ERR.PAYLOAD_EXPECTED);
            if (payload.length < 26)
                throw new ScDecodeError('Connect message payload truncated', ERR.MESSAGE_INCOMPLETE);
            message.connect = {
                vmac: payload.subarray(0, 6),
                uuid: payload.subarray(6, 22),
                maxBvlcLength: payload.readUInt16BE(22),
                maxNpduLength: payload.readUInt16BE(24)
            };
            break;
        }
        case FN.ADDRESS_RESOLUTION:
        case FN.ADVERTISEMENT_SOLICITATION:
        case FN.DISCONNECT_REQUEST:
        case FN.DISCONNECT_ACK:
        case FN.HEARTBEAT_REQUEST:
        case FN.HEARTBEAT_ACK: {
            if (payload.length > 0)
                throw new ScDecodeError('Message shall not carry a payload', ERR.UNEXPECTED_DATA);
            break;
        }
        case FN.PROPRIETARY_MESSAGE: {
            if (payload.length === 0)
                throw new ScDecodeError('Proprietary message requires a payload', ERR.PAYLOAD_EXPECTED);
            if (payload.length < 3)
                throw new ScDecodeError('Proprietary message payload truncated', ERR.MESSAGE_INCOMPLETE);
            message.proprietary = {
                vendorId: payload.readUInt16BE(0),
                proprietaryFunction: payload[2],
                data: payload.subarray(3)
            };
            break;
        }
    }
    return message;
};
exports.decodeMessage = decodeMessage;
const encodedOptionsLength = (options) => {
    if (!options)
        return 0;
    if (Buffer.isBuffer(options))
        return options.length;
    let length = 0;
    for (let i = 0; i < options.length; i++) {
        length += 1;
        if (options[i].headerData != null)
            length += 2 + options[i].headerData.length;
    }
    return length;
};
const writeOptions = (buffer, offset, options) => {
    if (!options)
        return offset;
    if (Buffer.isBuffer(options)) {
        // Pre-encoded pass-through (e.g. data options preserved from an inbound message)
        options.copy(buffer, offset);
        return offset + options.length;
    }
    for (let i = 0; i < options.length; i++) {
        const option = options[i];
        let marker = option.type & OPT.TYPE_MASK;
        if (i < options.length - 1)
            marker |= OPT.MORE_OPTIONS;
        if (option.mustUnderstand)
            marker |= OPT.MUST_UNDERSTAND;
        if (option.headerData != null)
            marker |= OPT.HEADER_DATA;
        buffer[offset++] = marker;
        if (option.headerData != null) {
            buffer.writeUInt16BE(option.headerData.length, offset);
            offset += 2;
            option.headerData.copy(buffer, offset);
            offset += option.headerData.length;
        }
    }
    return offset;
};
const encodeMessage = (message) => {
    const origVmac = message.origVmac || null;
    const destVmac = message.destVmac || null;
    const destOptionsLength = encodedOptionsLength(message.destOptions);
    const dataOptionsLength = encodedOptionsLength(message.dataOptions);
    const payloadLength = message.payload ? message.payload.length : 0;
    const total = 4 + (origVmac ? 6 : 0) + (destVmac ? 6 : 0) + destOptionsLength + dataOptionsLength + payloadLength;
    const buffer = Buffer.allocUnsafe(total);
    buffer[0] = message.func;
    buffer[1] = (origVmac ? FLAGS.ORIG_VMAC : 0)
        | (destVmac ? FLAGS.DEST_VMAC : 0)
        | (destOptionsLength > 0 ? FLAGS.DEST_OPTIONS : 0)
        | (dataOptionsLength > 0 ? FLAGS.DATA_OPTIONS : 0);
    buffer.writeUInt16BE(message.messageId, 2);
    let offset = 4;
    if (origVmac) {
        origVmac.copy(buffer, offset);
        offset += 6;
    }
    if (destVmac) {
        destVmac.copy(buffer, offset);
        offset += 6;
    }
    offset = writeOptions(buffer, offset, destOptionsLength > 0 ? message.destOptions : null);
    offset = writeOptions(buffer, offset, dataOptionsLength > 0 ? message.dataOptions : null);
    if (message.payload)
        message.payload.copy(buffer, offset);
    return buffer;
};
exports.encodeMessage = encodeMessage;
const encodeEncapsulatedNpdu = (params) => {
    let npdu = params.npdu;
    if (params.offset !== undefined || params.length !== undefined) {
        const start = params.offset || 0;
        npdu = npdu.subarray(start, start + (params.length !== undefined ? params.length : npdu.length - start));
    }
    return (0, exports.encodeMessage)({
        func: FN.ENCAPSULATED_NPDU,
        messageId: params.messageId,
        origVmac: params.origVmac,
        destVmac: params.destVmac,
        destOptions: params.destOptions,
        dataOptions: params.dataOptions,
        payload: npdu
    });
};
exports.encodeEncapsulatedNpdu = encodeEncapsulatedNpdu;
const encodeResult = (params) => {
    let payload;
    if (params.resultCode === SC.ResultCode.NAK) {
        const details = params.errorDetails ? Buffer.from(params.errorDetails, 'utf8') : Buffer.alloc(0);
        payload = Buffer.allocUnsafe(7 + details.length);
        payload[0] = params.resultForFunction;
        payload[1] = SC.ResultCode.NAK;
        payload[2] = params.errorHeaderMarker || 0x00;
        payload.writeUInt16BE(params.errorClass !== undefined ? params.errorClass : SC.ScErrorClass.COMMUNICATION, 3);
        payload.writeUInt16BE(params.errorCode, 5);
        details.copy(payload, 7);
    }
    else {
        payload = Buffer.from([params.resultForFunction, SC.ResultCode.ACK]);
    }
    return (0, exports.encodeMessage)({
        func: FN.BVLC_RESULT,
        messageId: params.messageId,
        origVmac: params.origVmac,
        destVmac: params.destVmac,
        payload: payload
    });
};
exports.encodeResult = encodeResult;
const encodeConnectPayload = (params) => {
    const payload = Buffer.allocUnsafe(26);
    params.vmac.copy(payload, 0);
    params.uuid.copy(payload, 6);
    payload.writeUInt16BE(params.maxBvlcLength, 22);
    payload.writeUInt16BE(params.maxNpduLength, 24);
    return payload;
};
const encodeConnectRequest = (params) => (0, exports.encodeMessage)({
    func: FN.CONNECT_REQUEST,
    messageId: params.messageId,
    payload: encodeConnectPayload(params)
});
exports.encodeConnectRequest = encodeConnectRequest;
const encodeConnectAccept = (params) => (0, exports.encodeMessage)({
    func: FN.CONNECT_ACCEPT,
    messageId: params.messageId,
    payload: encodeConnectPayload(params)
});
exports.encodeConnectAccept = encodeConnectAccept;
const encodeAdvertisement = (params) => {
    const payload = Buffer.allocUnsafe(6);
    payload[0] = params.hubConnectionStatus;
    payload[1] = params.acceptsDirectConnections;
    payload.writeUInt16BE(params.maxBvlcLength, 2);
    payload.writeUInt16BE(params.maxNpduLength, 4);
    return (0, exports.encodeMessage)({
        func: FN.ADVERTISEMENT,
        messageId: params.messageId,
        origVmac: params.origVmac,
        destVmac: params.destVmac,
        payload: payload
    });
};
exports.encodeAdvertisement = encodeAdvertisement;
const encodeAdvertisementSolicitation = (params) => (0, exports.encodeMessage)({
    func: FN.ADVERTISEMENT_SOLICITATION,
    messageId: params.messageId,
    origVmac: params.origVmac,
    destVmac: params.destVmac
});
exports.encodeAdvertisementSolicitation = encodeAdvertisementSolicitation;
const encodeAddressResolution = (params) => (0, exports.encodeMessage)({
    func: FN.ADDRESS_RESOLUTION,
    messageId: params.messageId,
    origVmac: params.origVmac,
    destVmac: params.destVmac
});
exports.encodeAddressResolution = encodeAddressResolution;
const encodeAddressResolutionAck = (params) => (0, exports.encodeMessage)({
    func: FN.ADDRESS_RESOLUTION_ACK,
    messageId: params.messageId,
    origVmac: params.origVmac,
    destVmac: params.destVmac,
    payload: Buffer.from((params.uris || []).join(' '), 'utf8')
});
exports.encodeAddressResolutionAck = encodeAddressResolutionAck;
const encodeDisconnectRequest = (params) => (0, exports.encodeMessage)({ func: FN.DISCONNECT_REQUEST, messageId: params.messageId });
exports.encodeDisconnectRequest = encodeDisconnectRequest;
const encodeDisconnectAck = (params) => (0, exports.encodeMessage)({ func: FN.DISCONNECT_ACK, messageId: params.messageId });
exports.encodeDisconnectAck = encodeDisconnectAck;
const encodeHeartbeatRequest = (params) => (0, exports.encodeMessage)({ func: FN.HEARTBEAT_REQUEST, messageId: params.messageId });
exports.encodeHeartbeatRequest = encodeHeartbeatRequest;
const encodeHeartbeatAck = (params) => (0, exports.encodeMessage)({ func: FN.HEARTBEAT_ACK, messageId: params.messageId });
exports.encodeHeartbeatAck = encodeHeartbeatAck;
const encodeProprietaryMessage = (params) => {
    const data = params.data || Buffer.alloc(0);
    const payload = Buffer.allocUnsafe(3 + data.length);
    payload.writeUInt16BE(params.vendorId, 0);
    payload[2] = params.proprietaryFunction;
    data.copy(payload, 3);
    return (0, exports.encodeMessage)({
        func: FN.PROPRIETARY_MESSAGE,
        messageId: params.messageId,
        origVmac: params.origVmac,
        destVmac: params.destVmac,
        payload: payload
    });
};
exports.encodeProprietaryMessage = encodeProprietaryMessage;
