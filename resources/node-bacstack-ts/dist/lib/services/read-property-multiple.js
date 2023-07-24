'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeAcknowledge = exports.encodeAcknowledge = exports.decode = exports.encode = void 0;
const baAsn1 = require("../asn1");
const encode = (buffer, properties) => {
    properties.forEach((value) => baAsn1.encodeReadAccessSpecification(buffer, value));
};
exports.encode = encode;
const decode = (buffer, offset, apduLen) => {
    let len = 0;
    const values = [];
    while ((apduLen - len) > 0) {
        const decodedValue = baAsn1.decodeReadAccessSpecification(buffer, offset + len, apduLen - len);
        if (!decodedValue)
            return;
        len += decodedValue.len;
        values.push(decodedValue.value);
    }
    return {
        len: len,
        properties: values
    };
};
exports.decode = decode;
const encodeAcknowledge = (buffer, values) => {
    values.forEach((value) => baAsn1.encodeReadAccessResult(buffer, value));
};
exports.encodeAcknowledge = encodeAcknowledge;
const decodeAcknowledge = (buffer, offset, apduLen) => {
    let len = 0;
    const values = [];
    while ((apduLen - len) > 0) {
        const result = baAsn1.decodeReadAccessResult(buffer, offset + len, apduLen - len);
        if (!result)
            return;
        len += result.len;
        values.push(result.value);
    }
    return {
        len: len,
        values: values
    };
};
exports.decodeAcknowledge = decodeAcknowledge;
