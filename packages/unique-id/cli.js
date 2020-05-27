var createId = require("./index");
const len = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : undefined;
console.log(createId(len));