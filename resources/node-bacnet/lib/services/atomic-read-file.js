'use strict';

const baAsn1      = require('../asn1');
const baEnum      = require('../enum');

module.exports.encode = (buffer, isStream, objectId, position, count) => {
  baAsn1.encodeApplicationObjectId(buffer, objectId.type, objectId.instance);
  if (isStream) {
    baAsn1.encodeOpeningTag(buffer, 0);
    baAsn1.encodeApplicationSigned(buffer, position);
    baAsn1.encodeApplicationUnsigned(buffer, count);
    baAsn1.encodeClosingTag(buffer, 0);
  } else {
    baAsn1.encodeOpeningTag(buffer, 1);
    baAsn1.encodeApplicationSigned(buffer, position);
    baAsn1.encodeApplicationUnsigned(buffer, count);
    baAsn1.encodeClosingTag(buffer, 1);
  }
};

module.exports.decode = (buffer, offset) => {
  let len = 0;
  let result;
  let decodedValue;
  let isStream = true;
  let objectId = {};
  let position = -1;
  let count = 0;
  result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
  len += result.len;
  if (result.tagNumber !== baEnum.ApplicationTag.OBJECTIDENTIFIER) {
    return undefined;
  }
  decodedValue = baAsn1.decodeObjectId(buffer, offset + len);
  len += decodedValue.len;
  objectId = {type: decodedValue.objectType, instance: decodedValue.instance};
  if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 0)) {
    isStream = true;
    len++;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTag.SIGNED_INTEGER) {
      return undefined;
    }
    decodedValue = baAsn1.decodeSigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    position = decodedValue.value;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTag.UNSIGNED_INTEGER) {
      return undefined;
    }
    decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    count = decodedValue.value;
    if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 0)) {
      return undefined;
    }
    len++;
  } else if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 1)) {
    isStream = false;
    len++;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTag.SIGNED_INTEGER) {
      return undefined;
    }
    decodedValue = baAsn1.decodeSigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    position = decodedValue.value;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTag.UNSIGNED_INTEGER) {
      return undefined;
    }
    decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    count = decodedValue.value;
    if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 1)) {
      return undefined;
    }
    len++;
  } else {
    return undefined;
  }
  return {
    len,
    isStream,
    objectId,
    position,
    count
  };
};

module.exports.encodeAcknowledge = (buffer, isStream, endOfFile, position, blockCount, blocks, counts) => {
  baAsn1.encodeApplicationBoolean(buffer, endOfFile);
  if (isStream) {
    baAsn1.encodeOpeningTag(buffer, 0);
    baAsn1.encodeApplicationSigned(buffer, position);
    baAsn1.encodeApplicationOctetString(buffer, blocks[0], 0, counts[0]);
    baAsn1.encodeClosingTag(buffer, 0);
  } else {
    baAsn1.encodeOpeningTag(buffer, 1);
    baAsn1.encodeApplicationSigned(buffer, position);
    baAsn1.encodeApplicationUnsigned(buffer, blockCount);
    for (let i = 0; i < blockCount; i++) {
      baAsn1.encodeApplicationOctetString(buffer, blocks[i], 0, counts[i]);
    }
    baAsn1.encodeClosingTag(buffer, 1);
  }
};

module.exports.decodeAcknowledge = (buffer, offset) => {
  let len = 0;
  let result;
  let decodedValue;
  let endOfFile;
  let isStream;
  let position;
  let targetBuffer;
  result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
  len += result.len;
  if (result.tagNumber !== baEnum.ApplicationTag.BOOLEAN) {
    return undefined;
  }
  endOfFile = result.value > 0;
  if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 0)) {
    isStream = true;
    len++;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTag.SIGNED_INTEGER) {
      return undefined;
    }
    decodedValue = baAsn1.decodeSigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    position = decodedValue.value;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTag.OCTET_STRING) {
      return undefined;
    }
    targetBuffer = buffer.slice(offset + len, offset + len + result.value);
    len += result.value;
    if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 0)) {
      return undefined;
    }
    len++;
  } else if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 1)) {
    isStream = false;
    throw new Error('NotImplemented'); //TODO is this catched somewhere or will it kill the process?
  } else {
    return undefined;
  }
  return {
    len,
    endOfFile,
    isStream,
    position,
    buffer: targetBuffer
  };
};
