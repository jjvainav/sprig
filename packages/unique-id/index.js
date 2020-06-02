"use strict";

var uuid = require("uuid/v4");
var baseX = require("base-x");
var base62 = baseX("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");

/** Creates a base62 encoded uuid with an optional length. */
module.exports = function createId(len) {
    var id = uuid().replace(/-/g, "");
    var buffer = Buffer.alloc(id.length, id, "hex");
    var result = base62.encode(buffer);
    return len ? result.substr(0, len) : result;
};