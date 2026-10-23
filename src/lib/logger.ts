import pino, { type DestinationStream, type Logger } from 'pino';
import { getClock, type Clock } from './clock';

export type { Logger };

// Personal data never belongs in logs; these paths catch it if a caller
// passes it by mistake.
const REDACT_PATHS = ['email', '*.email', 'password', '*.password', 'phone', '*.phone', 'token', '*.token'];

export interface LoggerOptions {
  clock?: () => Clock;
  destination?: DestinationStream;
  tenant?: string;
  environment?: string;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const clock = options.clock ?? getClock;
  const settings = {
    base: {
      service: 'bookit',
      tenant: options.tenant ?? process.env.BOOKIT_TENANT ?? 'unset',
      environment: options.environment ?? process.env.BOOKIT_ENV ?? 'local',
    },
    messageKey: 'msg',
    timestamp: () => `,"time":"${clock().now().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
  return options.destination ? pino(settings, options.destination) : pino(settings);
}

const LOGGER_KEY = Symbol.for('bookit.logger');

export function getLogger(): Logger {
  const holder = globalThis as { [LOGGER_KEY]?: Logger };
  holder[LOGGER_KEY] ??= createLogger();
  return holder[LOGGER_KEY];
}
