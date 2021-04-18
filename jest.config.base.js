module.exports = {
    globals: {
        "ts-jest": {
            tsconfig: "<rootDir>/test/tsconfig.json"
        }
    },
    preset: "ts-jest",
    roots: [
        "<rootDir>/test"
    ],
    transform: {
        "^.+\\.ts$": "ts-jest"
    },
    transformIgnorePatterns: [
        "node_modules/?!(@sprig)"
    ],
    testRegex: "((\\.|/)(test))\\.ts$",
    moduleFileExtensions: ["js", "ts"],
    verbose: true
}