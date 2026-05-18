import { createConsola, type ConsolaInstance } from 'consola';

interface LoggerOptions {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly noColor: boolean;
}

const DEFAULT_OPTIONS: LoggerOptions = { json: false, verbose: false, noColor: false };

let currentLogger: ConsolaInstance = build(DEFAULT_OPTIONS);

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
            process.stdout.write(JSON.stringify(record) + '\n');
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
  currentLogger = build({ ...DEFAULT_OPTIONS, ...opts });
}

export function logger(): ConsolaInstance {
  return currentLogger;
}
