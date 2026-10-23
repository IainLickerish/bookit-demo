import { describe, expect, it } from 'vitest';
import { BuildConfigurationError, buildIdentityFromArguments, type BuildIdentity } from '@/lib/build-identity';
import { RuntimeConfigurationError, runtimeIdentity } from '@/lib/runtime-identity';
import { SentryConfigurationError } from '@/lib/sentry-options';
import { injectedErrorEnabled } from '@/server/injected-error';
import { checkStartupConfiguration } from '@/server/startup';
import { recordStartedAt, serverStartedAt, versionPayload } from '@/server/version';
import { manualClock } from '../helpers/clock';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const BUILD_TIME = new Date('2026-10-23T10:00:00Z');

const goodBuild: BuildIdentity = {
  commit: SHA,
  buildId: 'ci-run-4242',
  image: `ghcr.io/example-owner/bookit-demo:${SHA}`,
  builtAt: '2026-10-23T09:59:00.000Z',
};

const staging = {
  BOOKIT_ENV: 'staging',
  BOOKIT_PRODUCT: 'ACME',
  BOOKIT_TENANT: 'acme',
  BOOKIT_DEPLOYMENT_ID: 'dep-0001',
};

describe('build identity from build arguments (REQ-18.1-05, plan 12.6, F-39)', () => {
  it('fails the build when GIT_COMMIT is empty or missing', () => {
    expect(() => buildIdentityFromArguments({}, BUILD_TIME)).toThrow(BuildConfigurationError);
    expect(() => buildIdentityFromArguments({ GIT_COMMIT: '' }, BUILD_TIME)).toThrow('GIT_COMMIT is empty');
    expect(() => buildIdentityFromArguments({ GIT_COMMIT: '   ' }, BUILD_TIME)).toThrow('GIT_COMMIT is empty');
  });

  it('takes commit, build ID, image and build time from the arguments', () => {
    expect(
      buildIdentityFromArguments(
        {
          GIT_COMMIT: SHA,
          BUILD_ID: 'ci-run-4242',
          BOOKIT_IMAGE: `ghcr.io/example-owner/bookit-demo:${SHA}`,
          BUILT_AT: '2026-10-23T09:59:00.000Z',
        },
        BUILD_TIME,
      ),
    ).toEqual(goodBuild);
  });

  it('defaults the build ID to local and the build time to when the build ran', () => {
    expect(buildIdentityFromArguments({ GIT_COMMIT: SHA }, BUILD_TIME)).toEqual({
      commit: SHA,
      buildId: 'local',
      image: `bookit-demo:${SHA}`,
      builtAt: '2026-10-23T10:00:00.000Z',
    });
  });

  it('refuses a commit that is not a SHA-like token and a build time that is not UTC', () => {
    expect(() => buildIdentityFromArguments({ GIT_COMMIT: 'abc; rm' }, BUILD_TIME)).toThrow(BuildConfigurationError);
    expect(() => buildIdentityFromArguments({ GIT_COMMIT: SHA, BUILT_AT: 'yesterday' }, BUILD_TIME)).toThrow(
      'BUILT_AT',
    );
    expect(() =>
      buildIdentityFromArguments({ GIT_COMMIT: SHA, BUILT_AT: '2026-10-23T11:00:00+01:00' }, BUILD_TIME),
    ).toThrow('BUILT_AT');
  });
});

describe('version payload (REQ-18.1-05, REQ-15.4-05, plan 12.6, F-39)', () => {
  it('has exactly the plan 12.6 fields plus deploymentId and startedAt', () => {
    const payload = versionPayload(goodBuild, runtimeIdentity(staging), new Date('2026-10-23T12:00:00Z'));
    expect(payload).toStrictEqual({
      service: 'bookit',
      product: 'ACME',
      tenant: 'acme',
      environment: 'staging',
      commit: SHA,
      buildId: 'ci-run-4242',
      image: `ghcr.io/example-owner/bookit-demo:${SHA}`,
      builtAt: '2026-10-23T09:59:00.000Z',
      deploymentId: 'dep-0001',
      startedAt: '2026-10-23T12:00:00.000Z',
    });
  });

  it('reports a missing deployment ID as unset rather than inventing one', () => {
    expect(runtimeIdentity({ ...staging, BOOKIT_DEPLOYMENT_ID: undefined }).deploymentId).toBe('unset');
  });

  it('keeps the recorded start time; the clock is read only when start-up did not record one', () => {
    const clock = manualClock('2026-10-23T12:00:00Z');
    recordStartedAt(new Date('2026-10-23T08:00:00Z'));
    clock.advanceMinutes(30);
    expect(serverStartedAt(clock).toISOString()).toBe('2026-10-23T08:00:00.000Z');
  });
});

describe('start-up refusal on identity (REQ-18.1-05, plan 12.6, security)', () => {
  it('starts a staging or production container with a full SHA, product and tenant', () => {
    expect(checkStartupConfiguration(staging, false, goodBuild)).toMatchObject({
      product: 'ACME',
      environment: 'staging',
    });
    expect(checkStartupConfiguration({ ...staging, BOOKIT_ENV: 'production' }, false, goodBuild).environment).toBe(
      'production',
    );
  });

  it('refuses a staging or production container whose build has no full commit SHA', () => {
    for (const commit of ['', 'local', SHA.slice(0, 7), SHA.toUpperCase()]) {
      for (const environment of ['staging', 'production']) {
        expect(() =>
          checkStartupConfiguration({ ...staging, BOOKIT_ENV: environment }, false, { ...goodBuild, commit }),
        ).toThrow(`GIT_COMMIT must be a 40-character commit SHA when BOOKIT_ENV is ${environment}`);
      }
    }
  });

  it('refuses a staging or production container without BOOKIT_PRODUCT or BOOKIT_TENANT', () => {
    expect(() => checkStartupConfiguration({ ...staging, BOOKIT_PRODUCT: '' }, false, goodBuild)).toThrow(
      'BOOKIT_PRODUCT must be set when BOOKIT_ENV is staging.',
    );
    expect(() =>
      checkStartupConfiguration({ ...staging, BOOKIT_ENV: 'production', BOOKIT_PRODUCT: undefined }, false, goodBuild),
    ).toThrow('BOOKIT_PRODUCT must be set when BOOKIT_ENV is production.');
    expect(() => checkStartupConfiguration({ ...staging, BOOKIT_TENANT: '' }, false, goodBuild)).toThrow(
      'BOOKIT_TENANT must be set',
    );
  });

  it('refuses an unknown or missing BOOKIT_ENV and malformed identity values', () => {
    expect(() => checkStartupConfiguration({ ...staging, BOOKIT_ENV: undefined }, false, goodBuild)).toThrow(
      RuntimeConfigurationError,
    );
    expect(() => checkStartupConfiguration({ ...staging, BOOKIT_ENV: 'prod' }, false, goodBuild)).toThrow(
      'BOOKIT_ENV must be one of local, staging, production.',
    );
    expect(() => checkStartupConfiguration({ ...staging, BOOKIT_PRODUCT: 'acme' }, false, goodBuild)).toThrow(
      'BOOKIT_PRODUCT must be an upper-case product code',
    );
    expect(() => checkStartupConfiguration({ ...staging, BOOKIT_DEPLOYMENT_ID: 'a b' }, false, goodBuild)).toThrow(
      'BOOKIT_DEPLOYMENT_ID',
    );
  });

  it('lets a local run start without a full SHA or product', () => {
    expect(checkStartupConfiguration({ BOOKIT_ENV: 'local' }, false, { ...goodBuild, commit: 'development' })).toEqual({
      product: 'unset',
      tenant: 'unset',
      environment: 'local',
      deploymentId: 'unset',
    });
  });

  it('never puts configuration values in refusal messages', () => {
    try {
      checkStartupConfiguration({ ...staging, BOOKIT_PRODUCT: 'Secret-Value' }, false, goodBuild);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('Secret-Value');
    }
  });
});

describe('error-reporting DSN at start-up (REQ-18.1-04, security: tests never contact real Sentry)', () => {
  it('refuses a DSN that is not a local receiver in a test-clock build', () => {
    const real = { ...staging, BOOKIT_SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1' };
    expect(() => checkStartupConfiguration(real, true, goodBuild)).toThrow(SentryConfigurationError);
    expect(() => checkStartupConfiguration(real, true, goodBuild)).toThrow('must point at a local receiver');
    for (const dsn of ['http://key@127.0.0.1:9000/1', 'http://key@localhost:9000/1', 'http://key@fake-sentry:8000/1']) {
      expect(() => checkStartupConfiguration({ ...staging, BOOKIT_SENTRY_DSN: dsn }, true, goodBuild)).not.toThrow();
    }
  });

  it('accepts a hosted DSN in an ordinary build, and refuses a malformed one in any build', () => {
    const hosted = { ...staging, BOOKIT_SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1' };
    expect(() => checkStartupConfiguration(hosted, false, goodBuild)).not.toThrow();
    expect(() => checkStartupConfiguration({ ...staging, BOOKIT_SENTRY_DSN: 'not a url' }, false, goodBuild)).toThrow(
      'BOOKIT_SENTRY_DSN is not a valid DSN URL.',
    );
    expect(() =>
      checkStartupConfiguration({ ...staging, BOOKIT_SENTRY_DSN: 'https://o1.ingest.sentry.io/1' }, false, goodBuild),
    ).toThrow('BOOKIT_SENTRY_DSN must look like');
  });
});

describe('injected test error route (REQ-18.1-04)', () => {
  it('exists only in test-clock builds and local runs', () => {
    expect(injectedErrorEnabled(true, 'staging')).toBe(true);
    expect(injectedErrorEnabled(false, 'local')).toBe(true);
    expect(injectedErrorEnabled(false, 'staging')).toBe(false);
    expect(injectedErrorEnabled(false, 'production')).toBe(false);
  });
});
