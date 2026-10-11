// Empty stub for Node built-ins (fs, path, ...) that some WASM/Emscripten
// bundles (e.g. @techstark/opencv-js) reference inside a runtime
// `if (ENVIRONMENT_IS_NODE)` branch that never actually executes in the
// browser — but Turbopack's static resolver still needs SOMETHING to
// resolve to for the client bundle. See next.config.js's
// turbopack.resolveAlias.
export {};
