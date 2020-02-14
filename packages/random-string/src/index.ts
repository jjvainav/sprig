import base62 from "base62";
import crypto from "crypto";

export = function randomString(length: number): string {
    // this is borrowed from: https://gist.github.com/aseemk/3095925
    const maxNum = Math.pow(62, length);
    const numBytes = Math.ceil(Math.log(maxNum) / Math.log(256));

    if (numBytes === Infinity) {
        throw new Error("Length too large; caused overflow: " + length);
    }

    do {
        var num = 0
        const bytes = crypto.randomBytes(numBytes);
        
        for (let i = 0; i < bytes.length; i++) {
            num += Math.pow(256, i) * bytes[i];
        }
    } while (num >= maxNum);

    return base62.encode(num);
}