import { createConsola, type ConsolaInstance } from 'consola';

interface LoggerOptions {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly noColor: boolean;
}

const DEFAULT_OPTIONS: LoggerOptions = { json: false, verbose: false, noColor: false };

let currentLogger: ConsolaInstance = build(DEFAULT_OPTIONS);
let jsonModeActive = false;

function build(opts: LoggerOptions): ConsolaInstance {
  const level = opts.verbose ? 5 : 3;
  if (opts.json) {
    return createConsola({
      level,
      reporters: [
        {
          log: (logObj) => {
            const record = {
              level: logObj.type,
              tag: logObj.tag ?? null,
              args: logObj.args,
              date: logObj.date,
            };
            writeStdoutSync(JSON.stringify(record) + '\n');
          },
        },
      ],
    });
  }
  if (opts.noColor) {
    process.env['NO_COLOR'] = '1';
  }
  return createConsola({ level });
}

export function configureLogger(opts: Partial<LoggerOptions>): void {
  const merged = { ...DEFAULT_OPTIONS, ...opts };
  jsonModeActive = merged.json;
  currentLogger = build(merged);
}

export function logger(): ConsolaInstance {
  return currentLogger;
}

export function isJsonMode(): boolean {
  return jsonModeActive;
}

export function emitJsonResult(payload: unknown): void {
  writeStdoutSync(JSON.stringify(payload) + '\n');
}

/**
 * Writes `text` to stdout so that it is complete once this returns (devaudit-installer#1234).
 * `process.stdout.write` is asynchronous when stdout is a pipe, and the commands end with
 * `process.exit`, which cut a `--json` report larger than the 64 KiB pipe buffer off mid-string.
 * Making the stream's handle blocking turns the write into a synchronous one (a file or a
 * terminal needs nothing). The write still goes through `process.stdout.write`.
 */
export function writeStdoutSync(text: string): void {
  const stream = process.stdout as NodeJS.WriteStream & { _handle?: { setBlocking?: (blocking: boolean) => void } };
  stream._handle?.setBlocking?.(true);
  stream.write(text);
}
