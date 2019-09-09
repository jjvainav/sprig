module.exports = {
    globals: {
        "ts-jest": {
            tsConfig: "<rootDir>/test/tsconfig.json"
        }
    },
    roots: [
        "<rootDir>/test"
    ],
    transform: {
        "^.+\\.(js|ts)$": "ts-jest"
    },
    transformIgnorePatterns: [
        "node_modules/?!(@sprig)"
    ],
    testRegex: "((\\.|/)(test))\\.ts$",
    moduleFileExtensions: ["js", "ts"],
    verbose: true
}