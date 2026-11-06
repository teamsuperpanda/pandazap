/**
 * The `obsidian` package ships type declarations only, so it cannot be bundled
 * for the jsdom test environment. This empty module gives the resolver a real
 * file; every test that imports it mocks the module itself.
 */
export {};
