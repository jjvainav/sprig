module.exports = {
    preset: "ts-jest",
    roots: [
        "<rootDir>/test"
    ],
    transform: {
        "^.+\\.ts$": ["ts-jest", { 
            tsconfig: "<rootDir>/test/tsconfig.json",
            verbose: true
        }]
    },
    transformIgnorePatterns: [
        "node_modules/?!(@sprig)"
    ],
    testRegex: "((\\.|/)(test))\\.ts$",
    moduleFileExtensions: ["js", "ts"]
}