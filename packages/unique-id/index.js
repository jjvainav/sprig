"use strict";

const { v4: uuid } = require("uuid");
const baseX = require("base-x");
const base62 = baseX("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");

/** Creates a base62 encoded uuid with an optional length. */
module.exports = function createId(len) {
    const buffer = Buffer.alloc(16);
    uuid(null, buffer, 0);

    var id = base62.encode(buffer);
    len = len || 22;

    if (id.length < len) {
        id = id.padStart(len, "0");
    }
    else if (id.length > len) {
        id = id.slice(id.length - len);
    }

    return id;
};