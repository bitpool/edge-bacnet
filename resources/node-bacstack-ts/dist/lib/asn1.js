'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeContextCharacterString = exports.bacappEncodeContextTimestamp = exports.bacappEncodeTimestamp = exports.decodeReadAccessSpecification = exports.decodeApplicationTime = exports.decodeBacnetTime = exports.decodeApplicationDate = exports.decodeDate = exports.decodeBitstring = exports.decodeCharacterString = exports.decodeOctetString = exports.decodeReal = exports.decodeSigned = exports.decodeReadAccessResult = exports.encodeReadAccessResult = exports.bacappDecodeApplicationData = exports.decodeTagNumberAndValue = exports.decodeObjectId = exports.decodeIsOpeningTag = exports.decodeIsClosingTag = exports.decodeIsClosingTagNumber = exports.decodeIsOpeningTagNumber = exports.decodeIsContextTag = exports.decodeTagNumber = exports.encodeContextSigned = exports.encodeContextBitstring = exports.bacappEncodePropertyState = exports.bacappEncodeContextDeviceObjPropertyRef = exports.bacappEncodeApplicationData = exports.encodeContextBoolean = exports.encodeReadAccessSpecification = exports.encodeClosingTag = exports.encodeOpeningTag = exports.encodeContextObjectId = exports.encodeApplicationTime = exports.encodeApplicationDate = exports.encodeApplicationBitstring = exports.encodeApplicationSigned = exports.encodeApplicationEnumerated = exports.encodeApplicationUnsigned = exports.encodeApplicationObjectId = exports.encodeApplicationBoolean = exports.encodeApplicationOctetString = exports.encodeContextEnumerated = exports.encodeContextUnsigned = exports.encodeContextReal = exports.encodeTag = exports.encodeBacnetObjectId = exports.decodeEnumerated = exports.decodeUnsigned = void 0;
exports.encodeContextCharacterString = exports.encodeApplicationCharacterString = exports.decodeContextObjectId = void 0;
const iconv = require("iconv-lite");
const baEnum = require("./enum");
const getBuffer = () => ({
    buffer: Buffer.alloc(1472),
    offset: 0
});
const getSignedLength = (value) => {
    if ((value >= -128) && (value < 128))
        return 1;
    else if ((value >= -32768) && (value < 32768))
        return 2;
    else if ((value > -8388608) && (value < 8388608))
        return 3;
    else
        return 4;
};
const getUnsignedLength = (value) => {
    if (value < 0x100)
        return 1;
    else if (value < 0x10000)
        return 2;
    else if (value < 0x1000000)
        return 3;
    else
        return 4;
};
const getEncodingType = (encoding, decodingBuffer, decodingOffset) => {
    switch (encoding) {
        case baEnum.CharacterStringEncoding.UTF_8:
            return 'utf8';
        case baEnum.CharacterStringEncoding.UCS_2:
            if (decodingBuffer && decodingBuffer[decodingOffset] === 0xFF && decodingBuffer[decodingOffset + 1] === 0xFE) {
                return 'ucs2';
            }
            return 'UTF-16BE'; // Default to big-endian
        case baEnum.CharacterStringEncoding.ISO_8859_1:
            return 'latin1';
        case baEnum.CharacterStringEncoding.UCS_4:
            return 'utf8'; // HACK: There is currently no support for UTF-32
        case baEnum.CharacterStringEncoding.MICROSOFT_DBCS:
            return 'cp850';
        case baEnum.CharacterStringEncoding.JIS_X_0208:
            return 'Shift_JIS';
        default:
            return 'utf8';
    }
};
const encodeUnsigned = (buffer, value, length) => {
    buffer.buffer.writeUIntBE(value, buffer.offset, length);
    buffer.offset += length;
};
const encodeBacnetUnsigned = (buffer, value) => {
    encodeUnsigned(buffer, value, getUnsignedLength(value));
};
const encodeSigned = (buffer, value, length) => {
    buffer.buffer.writeIntBE(value, buffer.offset, length);
    buffer.offset += length;
};
const encodeBacnetSigned = (buffer, value) => {
    encodeSigned(buffer, value, getSignedLength(value));
};
const encodeBacnetReal = (buffer, value) => {
    buffer.buffer.writeFloatBE(value, buffer.offset);
    buffer.offset += 4;
};
const encodeBacnetDouble = (buffer, value) => {
    buffer.buffer.writeDoubleBE(value, buffer.offset);
    buffer.offset += 8;
};
const decodeUnsigned = (buffer, offset, length) => ({
    len: length,
    value: buffer.readUIntBE(offset, length)
});
exports.decodeUnsigned = decodeUnsigned;
const decodeEnumerated = (buffer, offset, lenValue) => {
    return (0, exports.decodeUnsigned)(buffer, offset, lenValue);
};
exports.decodeEnumerated = decodeEnumerated;
const encodeBacnetObjectId = (buffer, objectType, instance) => {
    const value = (((objectType & baEnum.ASN1_MAX_OBJECT) << baEnum.ASN1_INSTANCE_BITS) | (instance & baEnum.ASN1_MAX_INSTANCE)) >>> 0;
    encodeUnsigned(buffer, value, 4);
};
exports.encodeBacnetObjectId = encodeBacnetObjectId;
const encodeTag = (buffer, tagNumber, contextSpecific, lenValueType) => {
    let len = 1;
    const tmp = new Array(3);
    tmp[0] = 0;
    if (contextSpecific) {
        tmp[0] |= 0x8;
    }
    if (tagNumber <= 14) {
        tmp[0] |= (tagNumber << 4);
    }
    else {
        tmp[0] |= 0xF0;
        tmp[1] = tagNumber;
        len++;
    }
    if (lenValueType <= 4) {
        tmp[0] |= lenValueType;
        Buffer.from(tmp).copy(buffer.buffer, buffer.offset, 0, len);
        buffer.offset += len;
    }
    else {
        tmp[0] |= 5;
        if (lenValueType <= 253) {
            tmp[len++] = lenValueType;
            Buffer.from(tmp).copy(buffer.buffer, buffer.offset, 0, len);
            buffer.offset += len;
        }
        else if (lenValueType <= 65535) {
            tmp[len++] = 254;
            Buffer.from(tmp).copy(buffer.buffer, buffer.offset, 0, len);
            buffer.offset += len;
            encodeUnsigned(buffer, lenValueType, 2);
        }
        else {
            tmp[len++] = 255;
            Buffer.from(tmp).copy(buffer.buffer, buffer.offset, 0, len);
            buffer.offset += len;
            encodeUnsigned(buffer, lenValueType, 4);
        }
    }
};
exports.encodeTag = encodeTag;
const encodeBacnetEnumerated = (buffer, value) => {
    encodeBacnetUnsigned(buffer, value);
};
const isExtendedTagNumber = (x) => {
    return (x & 0xF0) === 0xF0;
};
const isExtendedValue = (x) => {
    return (x & 0x07) === 5;
};
const isContextSpecific = (x) => {
    return (x & 0x8) === 0x8;
};
const isOpeningTag = (x) => {
    return (x & 0x07) === 6;
};
const isClosingTag = (x) => {
    return (x & 0x07) === 7;
};
const encodeContextReal = (buffer, tagNumber, value) => {
    (0, exports.encodeTag)(buffer, tagNumber, true, 4);
    encodeBacnetReal(buffer, value);
};
exports.encodeContextReal = encodeContextReal;
const encodeContextUnsigned = (buffer, tagNumber, value) => {
    (0, exports.encodeTag)(buffer, tagNumber, true, getUnsignedLength(value));
    encodeBacnetUnsigned(buffer, value);
};
exports.encodeContextUnsigned = encodeContextUnsigned;
const encodeContextEnumerated = (buffer, tagNumber, value) => {
    (0, exports.encodeContextUnsigned)(buffer, tagNumber, value);
};
exports.encodeContextEnumerated = encodeContextEnumerated;
const encodeOctetString = (buffer, octetString, octetOffset, octetCount) => {
    if (octetString) {
        for (let i = octetOffset; i < (octetOffset + octetCount); i++) {
            buffer.buffer[buffer.offset++] = octetString[i];
        }
    }
};
const encodeApplicationOctetString = (buffer, octetString, octetOffset, octetCount) => {
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.OCTET_STRING, false, octetCount);
    encodeOctetString(buffer, octetString, octetOffset, octetCount);
};
exports.encodeApplicationOctetString = encodeApplicationOctetString;
const encodeApplicationNull = (buffer) => {
    buffer.buffer[buffer.offset++] = baEnum.ApplicationTags.NULL;
};
const encodeApplicationBoolean = (buffer, booleanValue) => {
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.BOOLEAN, false, booleanValue ? 1 : 0);
};
exports.encodeApplicationBoolean = encodeApplicationBoolean;
const encodeApplicationReal = (buffer, value) => {
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.REAL, false, 4);
    encodeBacnetReal(buffer, value);
};
const encodeApplicationDouble = (buffer, value) => {
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.DOUBLE, false, 8);
    encodeBacnetDouble(buffer, value);
};
const bitstringBytesUsed = (bitString) => {
    let len = 0;
    if (bitString.bitsUsed > 0) {
        const lastBit = bitString.bitsUsed - 1;
        const usedBytes = (lastBit / 8) + 1;
        len = Math.floor(usedBytes);
    }
    return len;
};
const encodeApplicationObjectId = (buffer, objectType, instance) => {
    const tmp = getBuffer();
    (0, exports.encodeBacnetObjectId)(tmp, objectType, instance);
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.OBJECTIDENTIFIER, false, tmp.offset);
    tmp.buffer.copy(buffer.buffer, buffer.offset, 0, tmp.offset);
    buffer.offset += tmp.offset;
};
exports.encodeApplicationObjectId = encodeApplicationObjectId;
const encodeApplicationUnsigned = (buffer, value) => {
    const tmp = getBuffer();
    encodeBacnetUnsigned(tmp, value);
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.UNSIGNED_INTEGER, false, tmp.offset);
    tmp.buffer.copy(buffer.buffer, buffer.offset, 0, tmp.offset);
    buffer.offset += tmp.offset;
};
exports.encodeApplicationUnsigned = encodeApplicationUnsigned;
const encodeApplicationEnumerated = (buffer, value) => {
    const tmp = getBuffer();
    encodeBacnetEnumerated(tmp, value);
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.ENUMERATED, false, tmp.offset);
    tmp.buffer.copy(buffer.buffer, buffer.offset, 0, tmp.offset);
    buffer.offset += tmp.offset;
};
exports.encodeApplicationEnumerated = encodeApplicationEnumerated;
const encodeApplicationSigned = (buffer, value) => {
    const tmp = getBuffer();
    encodeBacnetSigned(tmp, value);
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.SIGNED_INTEGER, false, tmp.offset);
    tmp.buffer.copy(buffer.buffer, buffer.offset, 0, tmp.offset);
    buffer.offset += tmp.offset;
};
exports.encodeApplicationSigned = encodeApplicationSigned;
const byteReverseBits = (inByte) => {
    let outByte = 0;
    if ((inByte & 1) > 0) {
        outByte |= 0x80;
    }
    if ((inByte & 2) > 0) {
        outByte |= 0x40;
    }
    if ((inByte & 4) > 0) {
        outByte |= 0x20;
    }
    if ((inByte & 8) > 0) {
        outByte |= 0x10;
    }
    if ((inByte & 16) > 0) {
        outByte |= 0x8;
    }
    if ((inByte & 32) > 0) {
        outByte |= 0x4;
    }
    if ((inByte & 64) > 0) {
        outByte |= 0x2;
    }
    if ((inByte & 128) > 0) {
        outByte |= 1;
    }
    return outByte;
};
const bitstringOctet = (bitString, octetIndex) => {
    let octet = 0;
    if (bitString.value) {
        if (octetIndex < baEnum.ASN1_MAX_BITSTRING_BYTES) {
            octet = bitString.value[octetIndex];
        }
    }
    return octet;
};
const encodeBitstring = (buffer, bitString) => {
    if (bitString.bitsUsed === 0) {
        buffer.buffer[buffer.offset++] = 0;
    }
    else {
        const usedBytes = bitstringBytesUsed(bitString);
        const remainingUsedBits = bitString.bitsUsed - ((usedBytes - 1) * 8);
        buffer.buffer[buffer.offset++] = 8 - remainingUsedBits;
        for (let i = 0; i < usedBytes; i++) {
            buffer.buffer[buffer.offset++] = byteReverseBits(bitstringOctet(bitString, i));
        }
    }
};
const encodeApplicationBitstring = (buffer, bitString) => {
    let bitStringEncodedLength = 1;
    bitStringEncodedLength += bitstringBytesUsed(bitString);
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.BIT_STRING, false, bitStringEncodedLength);
    encodeBitstring(buffer, bitString);
};
exports.encodeApplicationBitstring = encodeApplicationBitstring;
const encodeBacnetDate = (buffer, value) => {
    if (value === new Date(1, 1, 1)) {
        buffer.buffer[buffer.offset++] = 0xFF;
        buffer.buffer[buffer.offset++] = 0xFF;
        buffer.buffer[buffer.offset++] = 0xFF;
        buffer.buffer[buffer.offset++] = 0xFF;
        return;
    }
    if (value.getFullYear() >= 1900) {
        buffer.buffer[buffer.offset++] = (value.getFullYear() - 1900);
    }
    else if (value.getFullYear() < 0x100) {
        buffer.buffer[buffer.offset++] = value.getFullYear();
    }
    else {
        return;
    }
    buffer.buffer[buffer.offset++] = value.getMonth();
    buffer.buffer[buffer.offset++] = value.getDate();
    buffer.buffer[buffer.offset++] = (value.getDay() === 0) ? 7 : value.getDay();
};
const encodeApplicationDate = (buffer, value) => {
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.DATE, false, 4);
    encodeBacnetDate(buffer, value);
};
exports.encodeApplicationDate = encodeApplicationDate;
const encodeBacnetTime = (buffer, value) => {
    buffer.buffer[buffer.offset++] = value.getHours();
    buffer.buffer[buffer.offset++] = value.getMinutes();
    buffer.buffer[buffer.offset++] = value.getSeconds();
    buffer.buffer[buffer.offset++] = value.getMilliseconds() / 10;
};
const encodeApplicationTime = (buffer, value) => {
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.TIME, false, 4);
    encodeBacnetTime(buffer, value);
};
exports.encodeApplicationTime = encodeApplicationTime;
const bacappEncodeDatetime = (buffer, value) => {
    if (value !== new Date(1, 1, 1)) {
        (0, exports.encodeApplicationDate)(buffer, value);
        (0, exports.encodeApplicationTime)(buffer, value);
    }
};
const encodeContextObjectId = (buffer, tagNumber, objectType, instance) => {
    (0, exports.encodeTag)(buffer, tagNumber, true, 4);
    (0, exports.encodeBacnetObjectId)(buffer, objectType, instance);
};
exports.encodeContextObjectId = encodeContextObjectId;
const encodeOpeningTag = (buffer, tagNumber) => {
    let len = 1;
    const tmp = new Array(2);
    tmp[0] = 0x8;
    if (tagNumber <= 14) {
        tmp[0] |= (tagNumber << 4);
    }
    else {
        tmp[0] |= 0xF0;
        tmp[1] = tagNumber;
        len++;
    }
    tmp[0] |= 6;
    Buffer.from(tmp).copy(buffer.buffer, buffer.offset, 0, len);
    buffer.offset += len;
};
exports.encodeOpeningTag = encodeOpeningTag;
const encodeClosingTag = (buffer, tagNumber) => {
    let len = 1;
    const tmp = new Array(2);
    tmp[0] = 0x8;
    if (tagNumber <= 14) {
        tmp[0] |= (tagNumber << 4);
    }
    else {
        tmp[0] |= 0xF0;
        tmp[1] = tagNumber;
        len++;
    }
    tmp[0] |= 7;
    Buffer.from(tmp).copy(buffer.buffer, buffer.offset, 0, len);
    buffer.offset += len;
};
exports.encodeClosingTag = encodeClosingTag;
const encodeReadAccessSpecification = (buffer, value) => {
    (0, exports.encodeContextObjectId)(buffer, 0, value.objectId.type, value.objectId.instance);
    (0, exports.encodeOpeningTag)(buffer, 1);
    value.properties.forEach((p) => {
        (0, exports.encodeContextEnumerated)(buffer, 0, p.id);
        if (p.index && p.index !== baEnum.ASN1_ARRAY_ALL) {
            (0, exports.encodeContextUnsigned)(buffer, 1, p.index);
        }
    });
    (0, exports.encodeClosingTag)(buffer, 1);
};
exports.encodeReadAccessSpecification = encodeReadAccessSpecification;
const encodeContextBoolean = (buffer, tagNumber, booleanValue) => {
    (0, exports.encodeTag)(buffer, tagNumber, true, 1);
    buffer.buffer.writeUInt8(booleanValue ? 1 : 0, buffer.offset);
    buffer.offset += 1;
};
exports.encodeContextBoolean = encodeContextBoolean;
const encodeCovSubscription = (buffer, value) => {
    (0, exports.encodeOpeningTag)(buffer, 0);
    (0, exports.encodeOpeningTag)(buffer, 0);
    (0, exports.encodeOpeningTag)(buffer, 1);
    (0, exports.encodeApplicationUnsigned)(buffer, value.recipient.network);
    if (value.recipient.network === 0xFFFF) {
        (0, exports.encodeApplicationOctetString)(buffer, [0], 0, 0);
    }
    else {
        (0, exports.encodeApplicationOctetString)(buffer, value.recipient.address, 0, value.recipient.address.length);
    }
    (0, exports.encodeClosingTag)(buffer, 1);
    (0, exports.encodeClosingTag)(buffer, 0);
    (0, exports.encodeContextUnsigned)(buffer, 1, value.subscriptionProcessId);
    (0, exports.encodeClosingTag)(buffer, 0);
    (0, exports.encodeOpeningTag)(buffer, 1);
    (0, exports.encodeContextObjectId)(buffer, 0, value.monitoredObjectId.type, value.monitoredObjectId.instance);
    (0, exports.encodeContextEnumerated)(buffer, 1, value.monitoredProperty.id);
    if (value.monitoredProperty.index !== baEnum.ASN1_ARRAY_ALL) {
        (0, exports.encodeContextUnsigned)(buffer, 2, value.monitoredProperty.index);
    }
    (0, exports.encodeClosingTag)(buffer, 1);
    (0, exports.encodeContextBoolean)(buffer, 2, value.issueConfirmedNotifications);
    (0, exports.encodeContextUnsigned)(buffer, 3, value.timeRemaining);
    if (value.covIncrement > 0) {
        (0, exports.encodeContextReal)(buffer, 4, value.covIncrement);
    }
};
const bacappEncodeApplicationData = (buffer, value) => {
    if (value.value === null) {
        value.type = baEnum.ApplicationTags.NULL;
    }
    switch (value.type) {
        case baEnum.ApplicationTags.NULL:
            encodeApplicationNull(buffer);
            break;
        case baEnum.ApplicationTags.BOOLEAN:
            (0, exports.encodeApplicationBoolean)(buffer, value.value);
            break;
        case baEnum.ApplicationTags.UNSIGNED_INTEGER:
            (0, exports.encodeApplicationUnsigned)(buffer, value.value);
            break;
        case baEnum.ApplicationTags.SIGNED_INTEGER:
            (0, exports.encodeApplicationSigned)(buffer, value.value);
            break;
        case baEnum.ApplicationTags.REAL:
            encodeApplicationReal(buffer, value.value);
            break;
        case baEnum.ApplicationTags.DOUBLE:
            encodeApplicationDouble(buffer, value.value);
            break;
        case baEnum.ApplicationTags.OCTET_STRING:
            (0, exports.encodeApplicationOctetString)(buffer, value.value, 0, value.value.length);
            break;
        case baEnum.ApplicationTags.CHARACTER_STRING:
            (0, exports.encodeApplicationCharacterString)(buffer, value.value, value.encoding);
            break;
        case baEnum.ApplicationTags.BIT_STRING:
            (0, exports.encodeApplicationBitstring)(buffer, value.value);
            break;
        case baEnum.ApplicationTags.ENUMERATED:
            (0, exports.encodeApplicationEnumerated)(buffer, value.value);
            break;
        case baEnum.ApplicationTags.DATE:
            (0, exports.encodeApplicationDate)(buffer, value.value);
            break;
        case baEnum.ApplicationTags.TIME:
            (0, exports.encodeApplicationTime)(buffer, value.value);
            break;
        case baEnum.ApplicationTags.TIMESTAMP:
            (0, exports.bacappEncodeTimestamp)(buffer, value.value);
            break;
        case baEnum.ApplicationTags.DATETIME:
            bacappEncodeDatetime(buffer, value.value);
            break;
        case baEnum.ApplicationTags.OBJECTIDENTIFIER:
            (0, exports.encodeApplicationObjectId)(buffer, value.value.type, value.value.instance);
            break;
        case baEnum.ApplicationTags.COV_SUBSCRIPTION:
            encodeCovSubscription(buffer, value.value);
            break;
        case baEnum.ApplicationTags.READ_ACCESS_RESULT:
            (0, exports.encodeReadAccessResult)(buffer, value.value);
            break;
        case baEnum.ApplicationTags.READ_ACCESS_SPECIFICATION:
            (0, exports.encodeReadAccessSpecification)(buffer, value.value);
            break;
        default:
            throw new Error('Unknown type');
    }
};
exports.bacappEncodeApplicationData = bacappEncodeApplicationData;
const bacappEncodeDeviceObjPropertyRef = (buffer, value) => {
    (0, exports.encodeContextObjectId)(buffer, 0, value.objectId.type, value.objectId.instance);
    (0, exports.encodeContextEnumerated)(buffer, 1, value.id);
    if (value.arrayIndex !== baEnum.ASN1_ARRAY_ALL) {
        (0, exports.encodeContextUnsigned)(buffer, 2, value.arrayIndex);
    }
    if (value.deviceIndentifier.type === baEnum.ObjectType.DEVICE) {
        (0, exports.encodeContextObjectId)(buffer, 3, value.deviceIndentifier.type, value.deviceIndentifier.instance);
    }
};
const bacappEncodeContextDeviceObjPropertyRef = (buffer, tagNumber, value) => {
    (0, exports.encodeOpeningTag)(buffer, tagNumber);
    bacappEncodeDeviceObjPropertyRef(buffer, value);
    (0, exports.encodeClosingTag)(buffer, tagNumber);
};
exports.bacappEncodeContextDeviceObjPropertyRef = bacappEncodeContextDeviceObjPropertyRef;
const bacappEncodePropertyState = (buffer, value) => {
    switch (value.type) {
        case baEnum.PropertyStates.BOOLEAN_VALUE:
            (0, exports.encodeContextBoolean)(buffer, 0, value.state === 1 ? true : false);
            break;
        case baEnum.PropertyStates.BINARY_VALUE:
            (0, exports.encodeContextEnumerated)(buffer, 1, value.state);
            break;
        case baEnum.PropertyStates.EVENT_TYPE:
            (0, exports.encodeContextEnumerated)(buffer, 2, value.state);
            break;
        case baEnum.PropertyStates.POLARITY:
            (0, exports.encodeContextEnumerated)(buffer, 3, value.state);
            break;
        case baEnum.PropertyStates.PROGRAM_CHANGE:
            (0, exports.encodeContextEnumerated)(buffer, 4, value.state);
            break;
        case baEnum.PropertyStates.PROGRAM_STATE:
            (0, exports.encodeContextEnumerated)(buffer, 5, value.state);
            break;
        case baEnum.PropertyStates.REASON_FOR_HALT:
            (0, exports.encodeContextEnumerated)(buffer, 6, value.state);
            break;
        case baEnum.PropertyStates.RELIABILITY:
            (0, exports.encodeContextEnumerated)(buffer, 7, value.state);
            break;
        case baEnum.PropertyStates.STATE:
            (0, exports.encodeContextEnumerated)(buffer, 8, value.state);
            break;
        case baEnum.PropertyStates.SYSTEM_STATUS:
            (0, exports.encodeContextEnumerated)(buffer, 9, value.state);
            break;
        case baEnum.PropertyStates.UNITS:
            (0, exports.encodeContextEnumerated)(buffer, 10, value.state);
            break;
        case baEnum.PropertyStates.UNSIGNED_VALUE:
            (0, exports.encodeContextUnsigned)(buffer, 11, value.state);
            break;
        case baEnum.PropertyStates.LIFE_SAFETY_MODE:
            (0, exports.encodeContextEnumerated)(buffer, 12, value.state);
            break;
        case baEnum.PropertyStates.LIFE_SAFETY_STATE:
            (0, exports.encodeContextEnumerated)(buffer, 13, value.state);
            break;
        default:
            break;
    }
};
exports.bacappEncodePropertyState = bacappEncodePropertyState;
const encodeContextBitstring = (buffer, tagNumber, bitString) => {
    const bitStringEncodedLength = bitstringBytesUsed(bitString) + 1;
    (0, exports.encodeTag)(buffer, tagNumber, true, bitStringEncodedLength);
    encodeBitstring(buffer, bitString);
};
exports.encodeContextBitstring = encodeContextBitstring;
const encodeContextSigned = (buffer, tagNumber, value) => {
    (0, exports.encodeTag)(buffer, tagNumber, true, getSignedLength(value));
    encodeBacnetSigned(buffer, value);
};
exports.encodeContextSigned = encodeContextSigned;
const encodeContextTime = (buffer, tagNumber, value) => {
    (0, exports.encodeTag)(buffer, tagNumber, true, 4);
    encodeBacnetTime(buffer, value);
};
const bacappEncodeContextDatetime = (buffer, tagNumber, value) => {
    if (value !== new Date(1, 1, 1)) {
        (0, exports.encodeOpeningTag)(buffer, tagNumber);
        bacappEncodeDatetime(buffer, value);
        (0, exports.encodeClosingTag)(buffer, tagNumber);
    }
};
const decodeTagNumber = (buffer, offset) => {
    let len = 1;
    let tagNumber;
    if (isExtendedTagNumber(buffer[offset])) {
        tagNumber = buffer[offset + 1];
        len++;
    }
    else {
        tagNumber = buffer[offset] >> 4;
    }
    return {
        len: len,
        tagNumber: tagNumber
    };
};
exports.decodeTagNumber = decodeTagNumber;
const decodeIsContextTag = (buffer, offset, tagNumber) => {
    const result = (0, exports.decodeTagNumber)(buffer, offset);
    return isContextSpecific(buffer[offset]) && result.tagNumber === tagNumber;
};
exports.decodeIsContextTag = decodeIsContextTag;
const decodeIsOpeningTagNumber = (buffer, offset, tagNumber) => {
    const result = (0, exports.decodeTagNumber)(buffer, offset);
    return isOpeningTag(buffer[offset]) && result.tagNumber === tagNumber;
};
exports.decodeIsOpeningTagNumber = decodeIsOpeningTagNumber;
const decodeIsClosingTagNumber = (buffer, offset, tagNumber) => {
    const result = (0, exports.decodeTagNumber)(buffer, offset);
    return isClosingTag(buffer[offset]) && result.tagNumber === tagNumber;
};
exports.decodeIsClosingTagNumber = decodeIsClosingTagNumber;
const decodeIsClosingTag = (buffer, offset) => {
    return (buffer[offset] & 0x07) === 7;
};
exports.decodeIsClosingTag = decodeIsClosingTag;
const decodeIsOpeningTag = (buffer, offset) => {
    return (buffer[offset] & 0x07) === 6;
};
exports.decodeIsOpeningTag = decodeIsOpeningTag;
const decodeObjectId = (buffer, offset) => {
    const result = (0, exports.decodeUnsigned)(buffer, offset, 4);
    const objectType = (result.value >> baEnum.ASN1_INSTANCE_BITS) & baEnum.ASN1_MAX_OBJECT;
    const instance = result.value & baEnum.ASN1_MAX_INSTANCE;
    return {
        len: result.len,
        objectType: objectType,
        instance: instance
    };
};
exports.decodeObjectId = decodeObjectId;
const decodeObjectIdSafe = (buffer, offset, lenValue) => {
    if (lenValue !== 4) {
        return {
            len: 0,
            objectType: 0,
            instance: 0
        };
    }
    else {
        return (0, exports.decodeObjectId)(buffer, offset);
    }
};
const decodeTagNumberAndValue = (buffer, offset) => {
    let value;
    const tag = (0, exports.decodeTagNumber)(buffer, offset);
    let len = tag.len;
    if (isExtendedValue(buffer[offset])) {
        if (buffer[offset + len] === 255) {
            len++;
            const result = (0, exports.decodeUnsigned)(buffer, offset + len, 4);
            len += result.len;
            value = result.value;
        }
        else if (buffer[offset + len] === 254) {
            len++;
            const result = (0, exports.decodeUnsigned)(buffer, offset + len, 2);
            len += result.len;
            value = result.value;
        }
        else {
            value = buffer[offset + len];
            len++;
        }
    }
    else if (isOpeningTag(buffer[offset])) {
        value = 0;
    }
    else if (isClosingTag(buffer[offset])) {
        value = 0;
    }
    else {
        value = buffer[offset] & 0x07;
    }
    return {
        len: len,
        tagNumber: tag.tagNumber,
        value: value
    };
};
exports.decodeTagNumberAndValue = decodeTagNumberAndValue;
const bacappDecodeApplicationData = (buffer, offset, maxOffset, objectType, propertyId) => {
    if (!isContextSpecific(buffer[offset])) {
        const tag = (0, exports.decodeTagNumberAndValue)(buffer, offset);
        if (tag) {
            const len = tag.len;
            const result = bacappDecodeData(buffer, offset + len, maxOffset, tag.tagNumber, tag.value);
            if (!result)
                return;
            let resObj = {
                len: len + result.len,
                type: result.type,
                value: result.value
            };
            if (result.originalBitString) {
                //protocols supported addition
                resObj.originalBitString = result.originalBitString;
            }
            // HACK: Drop string specific handling ASAP
            if (result.encoding !== undefined)
                resObj.encoding = result.encoding;
            return resObj;
        }
    }
    else {
        return bacappDecodeContextApplicationData(buffer, offset, maxOffset, objectType, propertyId);
    }
};
exports.bacappDecodeApplicationData = bacappDecodeApplicationData;
const encodeReadAccessResult = (buffer, value) => {
    (0, exports.encodeContextObjectId)(buffer, 0, value.objectId.type, value.objectId.instance);
    (0, exports.encodeOpeningTag)(buffer, 1);
    value.values.forEach((item) => {
        (0, exports.encodeContextEnumerated)(buffer, 2, item.property.id);
        if (item.property.index !== baEnum.ASN1_ARRAY_ALL) {
            (0, exports.encodeContextUnsigned)(buffer, 3, item.property.index);
        }
        if (item.value && item.value[0] && item.value[0].value && item.value[0].value.type === 'BacnetError') {
            (0, exports.encodeOpeningTag)(buffer, 5);
            (0, exports.encodeApplicationEnumerated)(buffer, item.value[0].value.errorClass);
            (0, exports.encodeApplicationEnumerated)(buffer, item.value[0].value.errorCode);
            (0, exports.encodeClosingTag)(buffer, 5);
        }
        else {
            (0, exports.encodeOpeningTag)(buffer, 4);
            item.value.forEach((subItem) => (0, exports.bacappEncodeApplicationData)(buffer, subItem));
            (0, exports.encodeClosingTag)(buffer, 4);
        }
    });
    (0, exports.encodeClosingTag)(buffer, 1);
};
exports.encodeReadAccessResult = encodeReadAccessResult;
const decodeReadAccessResult = (buffer, offset, apduLen) => {
    let len = 0;
    const value = {};
    if (!(0, exports.decodeIsContextTag)(buffer, offset + len, 0))
        return;
    len++;
    let result = (0, exports.decodeObjectId)(buffer, offset + len);
    value.objectId = {
        type: result.objectType,
        instance: result.instance
    };
    len += result.len;
    if (!(0, exports.decodeIsOpeningTagNumber)(buffer, offset + len, 1))
        return;
    len++;
    const values = [];
    while ((apduLen - len) > 0) {
        const newEntry = {};
        if ((0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 1)) {
            len++;
            break;
        }
        result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
        len += result.len;
        if (result.tagNumber !== 2)
            return;
        result = (0, exports.decodeEnumerated)(buffer, offset + len, result.value);
        newEntry.id = result.value;
        len += result.len;
        result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
        if (result.tagNumber === 3) {
            len += result.len;
            result = (0, exports.decodeUnsigned)(buffer, offset + len, result.value);
            newEntry.index = result.value;
            len += result.len;
        }
        else {
            newEntry.index = baEnum.ASN1_ARRAY_ALL;
        }
        result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
        len += result.len;
        if (result.tagNumber === 4) {
            const localValues = [];
            while ((len + offset) <= buffer.length && !(0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 4)) {
                const localResult = (0, exports.bacappDecodeApplicationData)(buffer, offset + len, apduLen + offset - 1, value.objectId.type, newEntry.id);
                if (!localResult)
                    return;
                len += localResult.len;
                const resObj = {
                    value: localResult.value,
                    type: localResult.type
                };
                // HACK: Drop string specific handling ASAP
                if (localResult.encoding !== undefined)
                    resObj.encoding = localResult.encoding;
                localValues.push(resObj);
            }
            if (!(0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 4))
                return;
            if ((localValues.length === 2) && (localValues[0].type === baEnum.ApplicationTags.DATE) && (localValues[1].type === baEnum.ApplicationTags.TIME)) {
                const date = localValues[0].value;
                const time = localValues[1].value;
                const bdatetime = new Date(date.year, date.month, date.day, time.hour, time.minute, time.second, time.millisecond);
                newEntry.value = [{ type: baEnum.ApplicationTags.DATETIME, value: bdatetime }];
            }
            else {
                newEntry.value = localValues;
            }
            len++;
        }
        else if (result.tagNumber === 5) {
            const err = {};
            result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
            len += result.len;
            result = (0, exports.decodeEnumerated)(buffer, offset + len, result.value);
            len += result.len;
            err.errorClass = result.value;
            result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
            len += result.len;
            result = (0, exports.decodeEnumerated)(buffer, offset + len, result.value);
            len += result.len;
            err.errorCode = result.value;
            if (!(0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 5))
                return;
            len++;
            newEntry.value = [{
                type: baEnum.ApplicationTags.ERROR,
                value: err
            }];
        }
        values.push(newEntry);
    }
    value.values = values;
    return {
        len: len,
        value: value
    };
};
exports.decodeReadAccessResult = decodeReadAccessResult;
const decodeSigned = (buffer, offset, length) => ({
    len: length,
    value: buffer.readIntBE(offset, length)
});
exports.decodeSigned = decodeSigned;
const decodeReal = (buffer, offset) => ({
    len: 4,
    value: buffer.readFloatBE(offset)
});
exports.decodeReal = decodeReal;
const decodeRealSafe = (buffer, offset, lenValue) => {
    if (lenValue !== 4) {
        return {
            len: lenValue,
            value: 0
        };
    }
    else {
        return (0, exports.decodeReal)(buffer, offset);
    }
};
const decodeDouble = (buffer, offset) => ({
    len: 8,
    value: buffer.readDoubleBE(offset)
});
const decodeDoubleSafe = (buffer, offset, lenValue) => {
    if (lenValue !== 8) {
        return {
            len: lenValue,
            value: 0
        };
    }
    else {
        return decodeDouble(buffer, offset);
    }
};
const decodeOctetString = (buffer, offset, maxLength, octetStringOffset, octetStringLength) => {
    const octetString = [];
    for (let i = octetStringOffset; i < (octetStringOffset + octetStringLength); i++) {
        octetString.push(buffer[offset + i]);
    }
    return {
        len: octetStringLength,
        value: octetString
    };
};
exports.decodeOctetString = decodeOctetString;
const multiCharsetCharacterstringDecode = (buffer, offset, maxLength, encoding, length) => {
    const stringBuf = Buffer.alloc(length);
    buffer.copy(stringBuf, 0, offset, offset + length);
    return {
        value: iconv.decode(stringBuf, getEncodingType(encoding, buffer, offset)),
        len: length + 1,
        encoding: encoding
    };
};
const decodeCharacterString = (buffer, offset, maxLength, lenValue) => {
    return multiCharsetCharacterstringDecode(buffer, offset + 1, maxLength, buffer[offset], lenValue - 1);
};
exports.decodeCharacterString = decodeCharacterString;
const bitstringSetBitsUsed = (bitString, bytesUsed, unusedBits) => {
    bitString.bitsUsed = bytesUsed * 8;
    bitString.bitsUsed -= unusedBits;
};
const decodeBitstring = (buffer, offset, lenValue) => {
    let len = 0;
    const bitString = { value: [], bitsUsed: 0 };
    const originalBitString = { value: [] };
    if (lenValue > 0) {
        const bytesUsed = lenValue - 1;
        if (bytesUsed <= baEnum.ASN1_MAX_BITSTRING_BYTES) {
            len = 1;
            for (let i = 0; i < bytesUsed; i++) {
                originalBitString.value.push(buffer[offset + len]);
                bitString.value.push(byteReverseBits(buffer[offset + len++]));
            }
            const unusedBits = buffer[offset] & 0x07;
            bitstringSetBitsUsed(bitString, bytesUsed, unusedBits);
        }
    }
    return {
        len: len,
        value: bitString,
        originalBitString: originalBitString
    };
};
exports.decodeBitstring = decodeBitstring;
const decodeDate = (buffer, offset) => {
    let date;
    const year = buffer[offset] + 1900;
    const month = buffer[offset + 1];
    const day = buffer[offset + 2];
    const wday = buffer[offset + 3];
    if (month === 0xFF && day === 0xFF && wday === 0xFF && (year - 1900) === 0xFF) {
        date = new Date(1, 1, 1);
    }
    else {
        date = new Date(year, month, day);
    }
    return {
        len: 4,
        value: date
    };
};
exports.decodeDate = decodeDate;
const decodeDateSafe = (buffer, offset, lenValue) => {
    if (lenValue !== 4) {
        return {
            len: lenValue,
            value: new Date(1, 1, 1)
        };
    }
    else {
        return (0, exports.decodeDate)(buffer, offset);
    }
};
const decodeApplicationDate = (buffer, offset) => {
    const result = (0, exports.decodeTagNumber)(buffer, offset);
    if (result.tagNumber === baEnum.ApplicationTags.DATE) {
        const value = (0, exports.decodeDate)(buffer, offset + 1);
        return {
            len: value.len + 1,
            value: value.value
        };
    }
};
exports.decodeApplicationDate = decodeApplicationDate;
const decodeBacnetTime = (buffer, offset) => {
    let value;
    const hour = buffer[offset + 0];
    const min = buffer[offset + 1];
    const sec = buffer[offset + 2];
    let hundredths = buffer[offset + 3];
    if (hour === 0xFF && min === 0xFF && sec === 0xFF && hundredths === 0xFF) {
        value = new Date(1, 1, 1);
    }
    else {
        if (hundredths > 100)
            hundredths = 0;
        value = new Date(1, 1, 1, hour, min, sec, hundredths * 10);
    }
    return {
        len: 4,
        value: value
    };
};
exports.decodeBacnetTime = decodeBacnetTime;
const decodeBacnetTimeSafe = (buffer, offset, len) => {
    if (len !== 4) {
        return { len, value: new Date(1, 1, 1) };
    }
    else {
        return (0, exports.decodeBacnetTime)(buffer, offset);
    }
};
const decodeApplicationTime = (buffer, offset) => {
    const result = (0, exports.decodeTagNumber)(buffer, offset);
    if (result.tagNumber === baEnum.ApplicationTags.TIME) {
        const value = (0, exports.decodeBacnetTime)(buffer, offset + 1);
        return {
            len: value.len + 1,
            value: value.value
        };
    }
};
exports.decodeApplicationTime = decodeApplicationTime;
const decodeBacnetDatetime = (buffer, offset) => {
    let len = 0;
    const rawDate = (0, exports.decodeApplicationDate)(buffer, offset + len);
    len += rawDate.len;
    const date = rawDate.value;
    const rawTime = (0, exports.decodeApplicationTime)(buffer, offset + len);
    len += rawTime.len;
    const time = rawTime.value;
    return {
        len: len,
        value: new Date(date.getFullYear(), date.getMonth(), date.getDay(), time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds())
    };
};
const bacappDecodeData = (buffer, offset, maxLength, tagDataType, lenValueType) => {
    let result;
    const value = {
        len: 0,
        type: tagDataType
    };
    switch (tagDataType) {
        case baEnum.ApplicationTags.NULL:
            value.value = null;
            break;
        case baEnum.ApplicationTags.BOOLEAN:
            value.value = lenValueType > 0 ? true : false;
            break;
        case baEnum.ApplicationTags.UNSIGNED_INTEGER:
            result = (0, exports.decodeUnsigned)(buffer, offset, lenValueType);
            value.len += result.len;
            value.value = result.value;
            break;
        case baEnum.ApplicationTags.SIGNED_INTEGER:
            result = (0, exports.decodeSigned)(buffer, offset, lenValueType);
            value.len += result.len;
            value.value = result.value;
            break;
        case baEnum.ApplicationTags.REAL:
            result = decodeRealSafe(buffer, offset, lenValueType);
            value.len += result.len;
            value.value = result.value;
            break;
        case baEnum.ApplicationTags.DOUBLE:
            result = decodeDoubleSafe(buffer, offset, lenValueType);
            value.len += result.len;
            value.value = result.value;
            break;
        case baEnum.ApplicationTags.OCTET_STRING:
            result = (0, exports.decodeOctetString)(buffer, offset, maxLength, 0, lenValueType);
            value.len += result.len;
            value.value = result.value;
            break;
        case baEnum.ApplicationTags.CHARACTER_STRING:
            result = (0, exports.decodeCharacterString)(buffer, offset, maxLength, lenValueType);
            value.len += result.len;
            value.value = result.value;
            value.encoding = result.encoding;
            break;
        case baEnum.ApplicationTags.BIT_STRING:
            result = (0, exports.decodeBitstring)(buffer, offset, lenValueType);
            value.len += result.len;
            value.value = result.value;
            if (result.originalBitString) {
                //protocols supported addition
                value.originalBitString = result.originalBitString;
            }
            break;
        case baEnum.ApplicationTags.ENUMERATED:
            result = (0, exports.decodeEnumerated)(buffer, offset, lenValueType);
            value.len += result.len;
            value.value = result.value;
            break;
        case baEnum.ApplicationTags.DATE:
            result = decodeDateSafe(buffer, offset, lenValueType);
            value.len += result.len;
            value.value = result.value;
            break;
        case baEnum.ApplicationTags.TIME:
            result = decodeBacnetTimeSafe(buffer, offset, lenValueType);
            value.len += result.len;
            value.value = result.value;
            break;
        case baEnum.ApplicationTags.OBJECTIDENTIFIER:
            result = decodeObjectIdSafe(buffer, offset, lenValueType);
            value.len += result.len;
            value.value = { type: result.objectType, instance: result.instance };
            break;
        default:
            break;
    }
    return value;
};
const bacappContextTagType = (property, tagNumber) => {
    let tag = 0;
    switch (property) {
        case baEnum.PropertyIdentifier.ACTUAL_SHED_LEVEL:
        case baEnum.PropertyIdentifier.REQUESTED_SHED_LEVEL:
        case baEnum.PropertyIdentifier.EXPECTED_SHED_LEVEL:
            switch (tagNumber) {
                case 0:
                case 1:
                    tag = baEnum.ApplicationTags.UNSIGNED_INTEGER;
                    break;
                case 2:
                    tag = baEnum.ApplicationTags.REAL;
                    break;
                default:
                    break;
            }
            break;
        case baEnum.PropertyIdentifier.ACTION:
            switch (tagNumber) {
                case 0:
                case 1:
                    tag = baEnum.ApplicationTags.OBJECTIDENTIFIER;
                    break;
                case 2:
                    tag = baEnum.ApplicationTags.ENUMERATED;
                    break;
                case 3:
                case 5:
                case 6:
                    tag = baEnum.ApplicationTags.UNSIGNED_INTEGER;
                    break;
                case 7:
                case 8:
                    tag = baEnum.ApplicationTags.BOOLEAN;
                    break;
                default:
                    break;
            }
            break;
        case baEnum.PropertyIdentifier.LIST_OF_GROUP_MEMBERS:
            switch (tagNumber) {
                case 0:
                    tag = baEnum.ApplicationTags.OBJECTIDENTIFIER;
                    break;
                default:
                    break;
            }
            break;
        case baEnum.PropertyIdentifier.EXCEPTION_SCHEDULE:
            switch (tagNumber) {
                case 1:
                    tag = baEnum.ApplicationTags.OBJECTIDENTIFIER;
                    break;
                case 3:
                    tag = baEnum.ApplicationTags.UNSIGNED_INTEGER;
                    break;
                default:
                    break;
            }
            break;
        case baEnum.PropertyIdentifier.LOG_DEVICE_OBJECT_PROPERTY:
            switch (tagNumber) {
                case 0:
                case 3:
                    tag = baEnum.ApplicationTags.OBJECTIDENTIFIER;
                    break;
                case 1:
                    tag = baEnum.ApplicationTags.ENUMERATED;
                    break;
                case 2:
                    tag = baEnum.ApplicationTags.UNSIGNED_INTEGER;
                    break;
                default:
                    break;
            }
            break;
        case baEnum.PropertyIdentifier.SUBORDINATE_LIST:
            switch (tagNumber) {
                case 0:
                case 1:
                    tag = baEnum.ApplicationTags.OBJECTIDENTIFIER;
                    break;
                default:
                    break;
            }
            break;
        case baEnum.PropertyIdentifier.RECIPIENT_LIST:
            switch (tagNumber) {
                case 0:
                    tag = baEnum.ApplicationTags.OBJECTIDENTIFIER;
                    break;
                default:
                    break;
            }
            break;
        case baEnum.PropertyIdentifier.ACTIVE_COV_SUBSCRIPTIONS:
            switch (tagNumber) {
                case 0:
                case 1:
                    break;
                case 2:
                    tag = baEnum.ApplicationTags.BOOLEAN;
                    break;
                case 3:
                    tag = baEnum.ApplicationTags.UNSIGNED_INTEGER;
                    break;
                case 4:
                    tag = baEnum.ApplicationTags.REAL;
                    break;
                default:
                    break;
            }
            break;
        default:
            break;
    }
    return tag;
};
const decodeDeviceObjPropertyRef = (buffer, offset) => {
    let len = 0;
    let arrayIndex = baEnum.ASN1_ARRAY_ALL;
    if (!(0, exports.decodeIsContextTag)(buffer, offset + len, 0))
        return;
    len++;
    let objectId = (0, exports.decodeObjectId)(buffer, offset + len);
    len += objectId.len;
    let result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== 1)
        return;
    const id = (0, exports.decodeEnumerated)(buffer, offset + len, result.value);
    len += id.len;
    result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    if (result.tagNumber === 2) {
        len += result.len;
        // FIXME: This doesn't seem to be used
        arrayIndex = (0, exports.decodeUnsigned)(buffer, offset + len, result.value);
        len += arrayIndex.len;
    }
    if ((0, exports.decodeIsContextTag)(buffer, offset + len, 3)) {
        if (!isClosingTag(buffer[offset + len])) {
            len++;
            objectId = (0, exports.decodeObjectId)(buffer, offset + len);
            len += objectId.len;
        }
    }
    return {
        len: len,
        value: {
            objectId: objectId,
            id: id
        }
    };
};
const decodeReadAccessSpecification = (buffer, offset, apduLen) => {
    let len = 0;
    const value = {};
    if (!(0, exports.decodeIsContextTag)(buffer, offset + len, 0))
        return;
    len++;
    let decodedValue = (0, exports.decodeObjectId)(buffer, offset + len);
    value.objectId = {
        type: decodedValue.objectType,
        instance: decodedValue.instance
    };
    len += decodedValue.len;
    if (!(0, exports.decodeIsOpeningTagNumber)(buffer, offset + len, 1))
        return;
    len++;
    const propertyIdAndArrayIndex = [];
    while ((apduLen - len) > 1 && !(0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 1)) {
        const propertyRef = {};
        if (!isContextSpecific(buffer[offset + len]))
            return;
        const result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
        len += result.len;
        if (result.tagNumber !== 0)
            return;
        if ((len + result.value) >= apduLen)
            return;
        decodedValue = (0, exports.decodeEnumerated)(buffer, offset + len, result.value);
        propertyRef.id = decodedValue.value;
        len += decodedValue.len;
        propertyRef.index = baEnum.ASN1_ARRAY_ALL;
        if (isContextSpecific(buffer[offset + len]) && !isClosingTag(buffer[offset + len])) {
            const tmp = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
            if (tmp.tagNumber === 1) {
                len += tmp.len;
                if ((len + tmp.value) >= apduLen)
                    return;
                decodedValue = (0, exports.decodeUnsigned)(buffer, offset + len, tmp.value);
                propertyRef.index = decodedValue.value;
                len += decodedValue.len;
            }
        }
        propertyIdAndArrayIndex.push(propertyRef);
    }
    if (!(0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 1))
        return;
    len++;
    value.properties = propertyIdAndArrayIndex;
    return {
        len: len,
        value: value
    };
};
exports.decodeReadAccessSpecification = decodeReadAccessSpecification;
const decodeCovSubscription = (buffer, offset, apduLen) => {
    let len = 0;
    const value = {};
    let result;
    let decodedValue;
    value.recipient = {};
    if (!(0, exports.decodeIsOpeningTagNumber)(buffer, offset + len, 0))
        return;
    len++;
    if (!(0, exports.decodeIsOpeningTagNumber)(buffer, offset + len, 0))
        return;
    len++;
    if (!(0, exports.decodeIsOpeningTagNumber)(buffer, offset + len, 1))
        return;
    len++;
    result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTags.UNSIGNED_INTEGER)
        return;
    decodedValue = (0, exports.decodeUnsigned)(buffer, offset + len, result.value);
    len += decodedValue.len;
    value.recipient.net = decodedValue.value;
    result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTags.OCTET_STRING)
        return;
    decodedValue = (0, exports.decodeOctetString)(buffer, offset + len, apduLen, 0, result.value);
    len += decodedValue.len;
    value.recipient.adr = decodedValue.value;
    if (!(0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 1))
        return;
    len++;
    if (!(0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 0))
        return;
    len++;
    result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== 1)
        return;
    decodedValue = (0, exports.decodeUnsigned)(buffer, offset + len, result.value);
    len += decodedValue.len;
    value.subscriptionProcessId = decodedValue.value;
    if (!(0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 0))
        return;
    len++;
    if (!(0, exports.decodeIsOpeningTagNumber)(buffer, offset + len, 1))
        return;
    len++;
    result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== 0)
        return;
    decodedValue = (0, exports.decodeObjectId)(buffer, offset + len);
    len += decodedValue.len;
    value.monitoredObjectId = {
        type: decodedValue.objectType,
        instance: decodedValue.instance
    };
    result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== 1)
        return;
    decodedValue = (0, exports.decodeEnumerated)(buffer, offset + len, result.value);
    len += decodedValue.len;
    value.monitoredProperty = {};
    value.monitoredProperty.id = decodedValue.value;
    result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    if (result.tagNumber === 2) {
        len += result.len;
        decodedValue = (0, exports.decodeUnsigned)(buffer, offset + len, result.value);
        len += decodedValue.len;
        value.monitoredProperty.index = decodedValue.value;
    }
    else {
        value.monitoredProperty.index = baEnum.ASN1_ARRAY_ALL;
    }
    if (!(0, exports.decodeIsClosingTagNumber)(buffer, offset + len, 1))
        return;
    len++;
    result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== 2)
        return;
    value.issueConfirmedNotifications = buffer[offset + len] > 0 ? true : false;
    len++;
    result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== 3)
        return;
    decodedValue = (0, exports.decodeUnsigned)(buffer, offset + len, result.value);
    len += decodedValue.len;
    value.timeRemaining = decodedValue.value;
    if (len < apduLen && !isClosingTag(buffer[offset + len])) {
        result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
        len += result.len;
        if (result.tagNumber !== 4)
            return;
        decodedValue = (0, exports.decodeReal)(buffer, offset + len);
        len += decodedValue.len;
        value.covIncrement = decodedValue.value;
    }
    return {
        len: len,
        value: value
    };
};
const decodeCalendarDate = (buffer, offset) => ({
    len: 4,
    year: buffer[offset],
    month: buffer[offset + 1],
    day: buffer[offset + 2],
    wday: buffer[offset + 3]
});
const decodeCalendarDateRange = (buffer, offset) => {
    let len = 1;
    const startDate = (0, exports.decodeDate)(buffer, offset + len);
    len += startDate.len + 1;
    const endDate = (0, exports.decodeDate)(buffer, offset + len);
    len += endDate.len + 1;
    return {
        len: len,
        startDate: startDate,
        endDate: endDate
    };
};
const decodeCalendarWeekDay = (buffer, offset) => ({
    len: 3,
    month: buffer[offset],
    week: buffer[offset + 1],
    wday: buffer[offset + 2]
});
const decodeCalendar = (buffer, offset, apduLen) => {
    let len = 0;
    const entries = [];
    while (len < apduLen) {
        const result = (0, exports.decodeTagNumber)(buffer, offset + len);
        len += result.len;
        switch (result.tagNumber) {
            case 0: {
                const decodedValue = decodeCalendarDate(buffer, offset + len);
                len += decodedValue.len;
                entries.push(decodedValue);
                break;
            }
            case 1: {
                const decodedValue = decodeCalendarDateRange(buffer, offset + len);
                len += decodedValue.len;
                entries.push(decodedValue);
                break;
            }
            case 2: {
                const decodedValue = decodeCalendarWeekDay(buffer, offset + len);
                len += decodedValue.len;
                entries.push(decodedValue);
                break;
            }
            default:
                return {
                    len: len - 1,
                    value: entries
                };
        }
    }
};
const bacappDecodeContextApplicationData = (buffer, offset, maxOffset, objectType, propertyId) => {
    let len = 0;
    if (isContextSpecific(buffer[offset])) {
        if (propertyId === baEnum.PropertyIdentifier.LIST_OF_GROUP_MEMBERS) {
            const result = (0, exports.decodeReadAccessSpecification)(buffer, offset, maxOffset);
            if (!result)
                return;
            return {
                type: baEnum.ApplicationTags.READ_ACCESS_SPECIFICATION,
                value: result.value,
                len: result.len
            };
        }
        else if (propertyId === baEnum.PropertyIdentifier.ACTIVE_COV_SUBSCRIPTIONS) {
            const result = decodeCovSubscription(buffer, offset, maxOffset);
            if (!result)
                return;
            return {
                type: baEnum.ApplicationTags.COV_SUBSCRIPTION,
                value: result.value,
                len: result.len
            };
        }
        else if (objectType === baEnum.ObjectType.GROUP && propertyId === baEnum.PropertyIdentifier.PRESENT_VALUE) {
            const result = (0, exports.decodeReadAccessResult)(buffer, offset, maxOffset);
            if (!result)
                return;
            return {
                type: baEnum.ApplicationTags.READ_ACCESS_RESULT,
                value: result.value,
                len: result.len
            };
        }
        else if (propertyId === baEnum.PropertyIdentifier.LIST_OF_OBJECT_PROPERTY_REFERENCES || propertyId === baEnum.PropertyIdentifier.LOG_DEVICE_OBJECT_PROPERTY || propertyId === baEnum.PropertyIdentifier.OBJECT_PROPERTY_REFERENCE) {
            const result = decodeDeviceObjPropertyRef(buffer, offset);
            if (!result)
                return;
            return {
                type: baEnum.ApplicationTags.OBJECT_PROPERTY_REFERENCE,
                value: result.value,
                len: result.len
            };
        }
        else if (propertyId === baEnum.PropertyIdentifier.DATE_LIST) {
            const result = decodeCalendar(buffer, offset, maxOffset);
            if (!result)
                return;
            return {
                type: baEnum.ApplicationTags.CONTEXT_SPECIFIC_DECODED,
                value: result.value,
                len: result.len
            };
        }
        else if (propertyId === baEnum.PropertyIdentifier.EVENT_TIME_STAMPS) {
            let subEvtResult;
            const evtResult = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
            len += 1;
            if (evtResult.tagNumber === 0) {
                subEvtResult = (0, exports.decodeBacnetTime)(buffer, offset + 1);
                return {
                    type: baEnum.ApplicationTags.TIMESTAMP,
                    value: subEvtResult.value,
                    len: subEvtResult.len + 1
                };
            }
            else if (evtResult.tagNumber === 1) {
                subEvtResult = (0, exports.decodeUnsigned)(buffer, offset + len, evtResult.value);
                return {
                    type: baEnum.ApplicationTags.UNSIGNED_INTEGER,
                    value: subEvtResult.value,
                    len: subEvtResult.len + 1
                };
            }
            else if (evtResult.tagNumber === 2) {
                subEvtResult = decodeBacnetDatetime(buffer, offset + len);
                return {
                    type: baEnum.ApplicationTags.TIMESTAMP,
                    value: subEvtResult.value,
                    len: subEvtResult.len + 2
                };
            }
            else {
                return;
            }
        }
        const list = [];
        const tagResult = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
        const multipleValues = isOpeningTag(buffer[offset + len]);
        while (((len + offset) <= maxOffset) && !isClosingTag(buffer[offset + len])) {
            const subResult = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
            if (!subResult)
                return;
            if (subResult.value === 0) {
                len += subResult.len;
                const result = (0, exports.bacappDecodeApplicationData)(buffer, offset + len, maxOffset, baEnum.ASN1_MAX_OBJECT_TYPE, baEnum.ASN1_MAX_PROPERTY_ID);
                if (!result)
                    return;
                list.push(result);
                len += result.len;
            }
            else {
                const overrideTagNumber = bacappContextTagType(propertyId, subResult.tagNumber);
                if (overrideTagNumber !== baEnum.ASN1_MAX_APPLICATION_TAG) {
                    subResult.tagNumber = overrideTagNumber;
                }
                const bacappResult = bacappDecodeData(buffer, offset + len + subResult.len, maxOffset, subResult.tagNumber, subResult.value);
                if (!bacappResult)
                    return;
                if (bacappResult.len === subResult.value) {
                    const resObj = {
                        value: bacappResult.value,
                        type: bacappResult.type
                    };
                    // HACK: Drop string specific handling ASAP
                    if (bacappResult.encoding !== undefined)
                        resObj.encoding = bacappResult.encoding;
                    list.push(resObj);
                    len += subResult.len + subResult.value;
                }
                else {
                    list.push({
                        value: buffer.slice(offset + len + subResult.len, offset + len + subResult.len + subResult.value),
                        type: baEnum.ApplicationTags.CONTEXT_SPECIFIC_ENCODED
                    });
                    len += subResult.len + subResult.value;
                }
            }
            if (multipleValues === false) {
                return {
                    len: len,
                    value: list[0],
                    type: baEnum.ApplicationTags.CONTEXT_SPECIFIC_DECODED
                };
            }
        }
        if ((len + offset) > maxOffset)
            return;
        if ((0, exports.decodeIsClosingTagNumber)(buffer, offset + len, tagResult.tagNumber)) {
            len++;
        }
        return {
            len: len,
            value: list,
            type: baEnum.ApplicationTags.CONTEXT_SPECIFIC_DECODED
        };
    }
    else {
        return;
    }
};
const bacappEncodeTimestamp = (buffer, value) => {
    switch (value.type) {
        case baEnum.TimeStamp.TIME:
            encodeContextTime(buffer, 0, value.value);
            break;
        case baEnum.TimeStamp.SEQUENCE_NUMBER:
            (0, exports.encodeContextUnsigned)(buffer, 1, value.value);
            break;
        case baEnum.TimeStamp.DATETIME:
            bacappEncodeContextDatetime(buffer, 2, value.value);
            break;
        default:
            throw new Error('NOT_IMPLEMENTED');
    }
};
exports.bacappEncodeTimestamp = bacappEncodeTimestamp;
const bacappEncodeContextTimestamp = (buffer, tagNumber, value) => {
    (0, exports.encodeOpeningTag)(buffer, tagNumber);
    (0, exports.bacappEncodeTimestamp)(buffer, value);
    (0, exports.encodeClosingTag)(buffer, tagNumber);
};
exports.bacappEncodeContextTimestamp = bacappEncodeContextTimestamp;
const decodeContextCharacterString = (buffer, offset, maxLength, tagNumber) => {
    let len = 0;
    if (!(0, exports.decodeIsContextTag)(buffer, offset + len, tagNumber))
        return;
    const result = (0, exports.decodeTagNumberAndValue)(buffer, offset + len);
    len += result.len;
    const decodedValue = multiCharsetCharacterstringDecode(buffer, offset + 1 + len, maxLength, buffer[offset + len], result.value - 1);
    if (!decodedValue)
        return;
    len += result.value;
    return {
        len: len,
        value: decodedValue.value,
        encoding: decodedValue.encoding
    };
};
exports.decodeContextCharacterString = decodeContextCharacterString;
const decodeIsContextTagWithLength = (buffer, offset, tagNumber) => {
    const result = (0, exports.decodeTagNumber)(buffer, offset);
    return {
        len: result.len,
        value: isContextSpecific(buffer[offset]) && (result.tagNumber === tagNumber)
    };
};
const decodeContextObjectId = (buffer, offset, tagNumber) => {
    const result = decodeIsContextTagWithLength(buffer, offset, tagNumber);
    if (!result.value)
        return;
    const decodedValue = (0, exports.decodeObjectId)(buffer, offset + result.len);
    decodedValue.len = decodedValue.len + result.len;
    return decodedValue;
};
exports.decodeContextObjectId = decodeContextObjectId;
const encodeBacnetCharacterString = (buffer, value, encoding) => {
    encoding = encoding || baEnum.CharacterStringEncoding.UTF_8;
    buffer.buffer[buffer.offset++] = encoding;
    const bufEncoded = iconv.encode(value, getEncodingType(encoding));
    buffer.offset += bufEncoded.copy(buffer.buffer, buffer.offset);
};
const encodeApplicationCharacterString = (buffer, value, encoding) => {
    const tmp = getBuffer();
    encodeBacnetCharacterString(tmp, value, encoding);
    (0, exports.encodeTag)(buffer, baEnum.ApplicationTags.CHARACTER_STRING, false, tmp.offset);
    tmp.buffer.copy(buffer.buffer, buffer.offset, 0, tmp.offset);
    buffer.offset += tmp.offset;
};
exports.encodeApplicationCharacterString = encodeApplicationCharacterString;
const encodeContextCharacterString = (buffer, tagNumber, value, encoding) => {
    const tmp = getBuffer();
    encodeBacnetCharacterString(tmp, value, encoding);
    (0, exports.encodeTag)(buffer, tagNumber, true, tmp.offset);
    tmp.buffer.copy(buffer.buffer, buffer.offset, 0, tmp.offset);
    buffer.offset += tmp.offset;
};
exports.encodeContextCharacterString = encodeContextCharacterString;
