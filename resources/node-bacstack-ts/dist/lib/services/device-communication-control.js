'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.decode = exports.encode = void 0;
const baAsn1 = require("../asn1");
const encode = (buffer, timeDuration, enableDisable, password) => {
    if (timeDuration > 0) {
        baAsn1.encodeContextUnsigned(buffer, 0, timeDuration);
    }
    baAsn1.encodeContextEnumerated(buffer, 1, enableDisable);
    if (password && password !== '') {
        baAsn1.encodeContextCharacterString(buffer, 2, password);
    }
};
exports.encode = encode;
const decode = (buffer, offset, apduLen) => {
    let len = 0;
    const value = {};
    let decodedValue;
    let result;
    if (baAsn1.decodeIsContextTag(buffer, offset + len, 0)) {
        result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
        len += result.len;
        decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value);
        value.timeDuration = decodedValue.value;
        len += decodedValue.len;
    }
    if (!baAsn1.decodeIsContextTag(buffer, offset + len, 1))
        return;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    decodedValue = baAsn1.decodeEnumerated(buffer, offset + len, result.value);
    value.enableDisable = decodedValue.value;
    len += decodedValue.len;
    if (len < apduLen) {
        if (!baAsn1.decodeIsContextTag(buffer, offset + len, 2))
            return;
        result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
        len += result.len;
        decodedValue = baAsn1.decodeCharacterString(buffer, offset + len, apduLen - (offset + len), result.value);
        value.password = decodedValue.value;
        len += decodedValue.len;
    }
    value.len = len;
    return value;
};
exports.decode = decode;
