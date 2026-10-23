import type { ErrorEvent, NodeOptions } from '@sentry/nextjs';
import type { BuildIdentity } from './build-identity';
import type { RuntimeIdentity } from './runtime-identity';

// Error reporting (plan 12.1, REQ-18.1-04, REQ-15.4-05): `release` is the
// commit SHA and `environment` is BOOKIT_ENV, so post-release monitoring can
// attribute an error to the deployed revision. The DSN comes only from
// BOOKIT_SENTRY_DSN; without it nothing is sent anywhere. Locally and in tests
// it points at fake-sentry or a test receiver.

export class SentryConfigurationError extends Error {
  override readonly name = 'SentryConfigurationError';
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A receiver on this machine or a Compose service such as `fake-sentry`:
 * a single-label host name, never a public domain such as sentry.io.
 */
export function isLocalReceiver(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || /^[a-z0-9-]+$/.test(hostname);
}

export function parseSentryDsn(env: Readonly<Record<string, string | undefined>>, testClockBuild: boolean): URL | null {
  const raw = (env.BOOKIT_SENTRY_DSN ?? '').trim();
  if (raw === '') {
    return null;
  }
  let dsn: URL;
  try {
    dsn = new URL(raw);
  } catch {
    throw new SentryConfigurationError('BOOKIT_SENTRY_DSN is not a valid DSN URL.');
  }
  if ((dsn.protocol !== 'http:' && dsn.protocol !== 'https:') || dsn.username === '') {
    throw new SentryConfigurationError('BOOKIT_SENTRY_DSN must look like https://<key>@<host>/<project>.');
  }
  // Test-clock builds exist only for end-to-end tests, which must never
  // contact a real Sentry.
  if (testClockBuild && !isLocalReceiver(dsn.hostname)) {
    throw new SentryConfigurationError(
      'BOOKIT_SENTRY_DSN must point at a local receiver (such as fake-sentry) in a test-clock build.',
    );
  }
  return dsn;
}

const REQUEST_ID_HEADER = 'x-request-id';

function withoutQuery(url: string): string {
  return url.split('?')[0] ?? '';
}

/**
 * Keeps personal data out of error reports: no user, cookies, body or query
 * string, and only the request ID header, which becomes a tag.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    const headers = event.request.headers ?? {};
    const requestId = headers[REQUEST_ID_HEADER];
    if (typeof requestId === 'string' && requestId !== '') {
      event.tags = { ...event.tags, request_id: requestId };
    }
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) {
      event.request.url = withoutQuery(event.request.url);
    }
  }
  // The Next.js integration repeats the request path, query string included.
  const nextjs = event.contexts?.nextjs;
  if (nextjs && typeof nextjs.request_path === 'string') {
    nextjs.request_path = withoutQuery(nextjs.request_path);
  }
  return event;
}

export function sentryOptions(dsn: URL, build: BuildIdentity, runtime: RuntimeIdentity): NodeOptions {
  return {
    dsn: dsn.toString(),
    release: build.commit,
    environment: runtime.environment,
    // Not the host name of whichever machine runs the container.
    serverName: `bookit-${runtime.tenant}-${runtime.environment}`,
    // Collect nothing about people or payloads; the request ID header is kept
    // only so scrubEvent can turn it into a tag.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: [REQUEST_ID_HEADER] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    },
    tracesSampleRate: 0,
    initialScope: {
      tags: {
        service: 'bookit',
        product: runtime.product,
        tenant: runtime.tenant,
        deployment_id: runtime.deploymentId,
      },
    },
    beforeSend: (event) => scrubEvent(event),
    // Breadcrumbs can carry URLs with query strings and console output.
    beforeBreadcrumb: () => null,
  };
}
