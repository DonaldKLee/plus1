/** Minimal logger contract, console-compatible. Pass `console` or pino/winston or your own. */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Default: warnings and errors to the console, nothing else. */
export const defaultLogger: Logger = {
  debug() {},
  info() {},
  warn: (...a) => console.warn("[liveavatar]", ...a),
  error: (...a) => console.error("[liveavatar]", ...a),
};

export function prefixed(logger: Logger, prefix: string): Logger {
  return {
    debug: (...a) => logger.debug(prefix, ...a),
    info: (...a) => logger.info(prefix, ...a),
    warn: (...a) => logger.warn(prefix, ...a),
    error: (...a) => logger.error(prefix, ...a),
  };
}
