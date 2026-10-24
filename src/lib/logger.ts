import { createHash } from 'node:crypto';
import path from 'node:path';
import pino, { type DestinationStream, type Logger } from 'pino';
import { buildIdentity } from './build-flags';
import { getClock, type Clock } from './clock';

export type { Logger };

// Personal data never belongs in logs; these paths catch it if a caller
// passes it by mistake.
const REDACT_PATHS = ['email', '*.email', 'password', '*.password', 'phone', '*.phone', 'token', '*.token'];

export interface LoggerOptions {
  clock?: () => Clock;
  destination?: DestinationStream;
  tenant?: string;
  product?: string;
  environment?: string;
  /** The commit SHA the build was made from. */
  release?: string;
}

/**
 * Where a container also writes its log lines for SupportAgents'
 * FakeLogSource, which reads a shared read-only volume mounted at
 * /var/log/bookit: `<BOOKIT_LOG_DIR>/<product>/<environment>.jsonl`, with the
 * product code in lower case. Null when BOOKIT_LOG_DIR is not set.
 */
export function logFilePath(env: Readonly<Record<string, string | undefined>>): string | null {
  const dir = (env.BOOKIT_LOG_DIR ?? '').trim();
  if (dir === '') {
    return null;
  }
  const product = (env.BOOKIT_PRODUCT ?? '').trim().toLowerCase() || 'unset';
  const environment = (env.BOOKIT_ENV ?? '').trim() || 'local';
  return path.join(dir, product, `${environment}.jsonl`);
}

function defaultDestination(): DestinationStream {
  const file = logFilePath(process.env);
  // Synchronous writes, so no line is lost when a container stops.
  const stdout = pino.destination({ dest: 1, sync: true });
  if (file === null) {
    return stdout;
  }
  return pino.multistream([
    { stream: stdout },
    { stream: pino.destination({ dest: file, mkdir: true, append: true, sync: true }) },
  ]);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const clock = options.clock ?? getClock;
  const settings = {
    base: {
      service: 'bookit',
      product: options.product ?? process.env.BOOKIT_PRODUCT ?? 'unset',
      tenant: options.tenant ?? process.env.BOOKIT_TENANT ?? 'unset',
      environment: options.environment ?? process.env.BOOKIT_ENV ?? 'local',
      release: options.release ?? (buildIdentity().commit || 'unset'),
    },
    messageKey: 'msg',
    timestamp: () => `,"time":"${clock().now().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
  return pino(settings, options.destination ?? defaultDestination());
}

const LOGGER_KEY = Symbol.for('bookit.logger');

export function getLogger(): Logger {
  const holder = globalThis as { [LOGGER_KEY]?: Logger };
  holder[LOGGER_KEY] ??= createLogger();
  return holder[LOGGER_KEY];
}

/** A stable, non-reversible reference to an email address for log lines. */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}
