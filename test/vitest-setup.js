// Vitest global setup — provide mocha-compatible aliases
// before/after are mocha names for beforeAll/afterAll; vitest only injects the *All variants
globalThis.before = beforeAll;
globalThis.after = afterAll;
