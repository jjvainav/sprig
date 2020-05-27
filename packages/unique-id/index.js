"use strict";

var uuid = require("uuid/v4");
var baseX = require("base-x");
var base62 = baseX("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");

/** Creates a base62 encoded uuid with an optional length. */
module.exports = function createId(len) {
    var id = uuid();
    var buffer = Buffer.alloc(len || 22, id.replace(/-/g, ""), "hex");
    return base62.encode(buffer);
};