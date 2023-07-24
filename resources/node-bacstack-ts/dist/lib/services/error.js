'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.decode = exports.encode = void 0;
const baAsn1 = require("../asn1");
const encode = (buffer, errorClass, errorCode) => {
    baAsn1.encodeApplicationEnumerated(buffer, errorClass);
    baAsn1.encodeApplicationEnumerated(buffer, errorCode);
};
exports.encode = encode;
const decode = (buffer, offset) => {
    const orgOffset = offset;
    let result;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset);
    offset += result.len;
    const errorClass = baAsn1.decodeEnumerated(buffer, offset, result.value);
    offset += errorClass.len;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset);
    offset += result.len;
    const errorCode = baAsn1.decodeEnumerated(buffer, offset, result.value);
    offset += errorClass.len;
    return {
        len: offset - orgOffset,
        class: errorClass.value,
        code: errorCode.value
    };
};
exports.decode = decode;
