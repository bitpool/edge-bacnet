'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.decode = exports.encode = void 0;
const baAsn1 = require("../asn1");
const encode = (buffer, objectId) => {
    baAsn1.encodeApplicationObjectId(buffer, objectId.type, objectId.instance);
};
exports.encode = encode;
const decode = (buffer, offset, apduLen) => {
    const result = baAsn1.decodeTagNumberAndValue(buffer, offset);
    if (result.tagNumber !== 12)
        return;
    let len = 1;
    const value = baAsn1.decodeObjectId(buffer, offset + len);
    len += value.len;
    if (len !== apduLen)
        return;
    value.len = len;
    return value;
};
exports.decode = decode;
