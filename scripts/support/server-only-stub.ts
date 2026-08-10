/**
 * A no-op stand-in for the `server-only` package.
 *
 * `server-only` exists to make it a build error to pull server modules into a
 * client bundle, and it enforces that by throwing the moment it is imported
 * outside Next's server graph. The seed and the integration tests run under
 * plain `tsx`, which is outside that graph — so importing the real thing kills
 * the process before a single row is written or a single assertion runs.
 *
 * Mapped in only by `tsconfig.scripts.json`, which nothing in the application
 * build uses. The app keeps the real package and the real guarantee.
 */
export {};
