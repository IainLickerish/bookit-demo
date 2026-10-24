import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { runtimeIdentity } from '@/lib/runtime-identity';
import { isLocalReceiver, parseSentryDsn, scrubEvent, sentryOptions } from '@/lib/sentry-options';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const build = {
  commit: SHA,
  buildId: 'ci-1',
  image: `ghcr.io/example-owner/bookit-demo:${SHA}`,
  builtAt: '2026-10-23T09:00:00.000Z',
};
const runtime = runtimeIdentity({
  BOOKIT_ENV: 'production',
  BOOKIT_PRODUCT: 'BEACON',
  BOOKIT_TENANT: 'beacon',
  BOOKIT_DEPLOYMENT_ID: 'dep-7',
});

describe('Sentry options (REQ-18.1-04, REQ-15.4-05)', () => {
  it('reports nothing without BOOKIT_SENTRY_DSN, and ignores the SDK-wide SENTRY_DSN', () => {
    expect(parseSentryDsn({}, false)).toBeNull();
    expect(parseSentryDsn({ BOOKIT_SENTRY_DSN: '  ' }, true)).toBeNull();
    expect(parseSentryDsn({ SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1' }, false)).toBeNull();
  });

  it('sets release to the commit SHA, environment to BOOKIT_ENV and tags product, tenant and deployment', () => {
    const options = sentryOptions(new URL('http://key@fake-sentry:8000/1'), build, runtime);
    expect(options).toMatchObject({
      dsn: 'http://key@fake-sentry:8000/1',
      release: SHA,
      environment: 'production',
      tracesSampleRate: 0,
      initialScope: { tags: { service: 'bookit', product: 'BEACON', tenant: 'beacon', deployment_id: 'dep-7' } },
    });
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    });
    expect(options.beforeBreadcrumb?.({ message: 'GET /bookings?email=x' }, undefined)).toBeNull();
    expect(typeof options.integrations).toBe('function');
    if (typeof options.integrations !== 'function') throw new Error('Integration filter missing');
    expect(options.integrations([{ name: 'Dedupe' }, { name: 'RequestData' }])).toEqual([{ name: 'RequestData' }]);
  });

  it('treats only loopback addresses and Compose service names as local receivers', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'fake-sentry']) {
      expect(isLocalReceiver(host)).toBe(true);
    }
    for (const host of ['o1.ingest.sentry.io', 'sentry.io', 'fake-sentry.example.test', '10.0.0.5']) {
      expect(isLocalReceiver(host)).toBe(false);
    }
  });
});

describe('error report scrubbing (security, brief 18: no personal data)', () => {
  it('drops the user, cookies, headers, body and query string but keeps the request ID as a tag', () => {
    const event = {
      type: undefined,
      user: { email: 'patient1@patients.example.test', ip_address: '192.0.2.10' },
      tags: { product: 'BEACON' },
      request: {
        url: 'http://127.0.0.1:4201/bookings?email=patient1@patients.example.test',
        method: 'POST',
        headers: { 'x-request-id': 'req-000042', cookie: 'bookit_session=abc' },
        cookies: { bookit_session: 'abc' },
        data: { phone: '+44 7700 900001' },
        query_string: 'email=patient1@patients.example.test',
      },
      contexts: {
        nextjs: { request_path: '/bookings?email=patient1%40patients.example.test', router_kind: 'App Router' },
      },
    } as unknown as ErrorEvent;
    const scrubbed = scrubEvent(event);
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.tags).toEqual({ product: 'BEACON', request_id: 'req-000042' });
    expect(scrubbed.request).toEqual({ url: 'http://127.0.0.1:4201/bookings', method: 'POST' });
    expect(scrubbed.contexts?.nextjs).toEqual({ request_path: '/bookings', router_kind: 'App Router' });
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain('example.test');
    expect(text).not.toContain('7700');
    expect(text).not.toContain('bookit_session');
  });
});
