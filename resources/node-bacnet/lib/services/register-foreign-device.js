'use strict';

const baAsn1      = require('../asn1');
const baEnum      = require('../enum');

module.exports.encode = (buffer, ttl, length = 2) => {
  baAsn1.encodeUnsigned(buffer, ttl, length);
};

module.exports.decode = (buffer, offset, length = 2) => {
  let len = 0;
  let result = baAsn1.decodeUnsigned(buffer, offset + len, length);
  len += result.len;
  return {
    len,
    ttl: result.value,
  };
};
