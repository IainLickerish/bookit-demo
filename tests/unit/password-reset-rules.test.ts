import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { pathInManifest, routeManifest } from '@/lib/route-manifest';
import { redactPath, redactUrl, resetPasswordPath } from '@/lib/routes';
import { LOCAL_PUBLIC_URL, publicBaseUrl, RuntimeConfigurationError } from '@/lib/runtime-identity';
import { scrubEvent } from '@/lib/sentry-options';
import { SlidingWindowLimiter } from '@/server/auth/rate-limit';
import { composePasswordResetEmail } from '@/server/notifications/password-reset-email';

const TOKEN = 'Q2hvb3NlIGEgbmV3IHBhc3N3b3JkIGZvciBCb29rSXQ';

describe('route manifest (bead supportagents-8uvs, DEF-05 baseline)', () => {
  const manifest = routeManifest();

  it('lists the password reset routes and not the old /account/reset-password path', () => {
    expect(manifest).toContain('/auth/forgot-password');
    expect(manifest).toContain('/auth/reset-password/[token]');
    expect(manifest).toContain('/auth/sign-in');
    expect(manifest).toContain('/api/version');
    expect(manifest.some((route) => route.startsWith('/account'))).toBe(false);
    expect(pathInManifest('/account/reset-password', manifest)).toBe(false);
  });

  it('matches concrete paths against dynamic segments, ignoring query strings', () => {
    expect(pathInManifest('/auth/forgot-password', manifest)).toBe(true);
    expect(pathInManifest('/auth/forgot-password?sent=1', manifest)).toBe(true);
    expect(pathInManifest(`/auth/reset-password/${TOKEN}`, manifest)).toBe(true);
    expect(pathInManifest('/auth/reset-password', manifest)).toBe(false);
    expect(pathInManifest('/auth/reset-password/a/b', manifest)).toBe(false);
    expect(pathInManifest('/', manifest)).toBe(true);
  });
});

describe('reset tokens never reach logs or error reports (security)', () => {
  it('redacts the token from paths and URLs and drops query strings', () => {
    expect(redactPath(resetPasswordPath(TOKEN))).toBe('/auth/reset-password/[token]');
    expect(redactPath(`/auth/reset-password/${TOKEN}?error=mismatch`)).toBe('/auth/reset-password/[token]');
    expect(redactPath('/auth/forgot-password?sent=1')).toBe('/auth/forgot-password');
    expect(redactPath('/bookings')).toBe('/bookings');
    expect(redactUrl(`https://acme.example.test/auth/reset-password/${TOKEN}`)).toBe(
      'https://acme.example.test/auth/reset-password/[token]',
    );
  });

  it('scrubs the token from an error event', () => {
    const event = {
      type: undefined,
      transaction: `POST /auth/reset-password/${TOKEN}`,
      request: { url: `http://127.0.0.1:4101/auth/reset-password/${TOKEN}`, method: 'POST' },
      contexts: { nextjs: { request_path: `/auth/reset-password/${TOKEN}?error=weak_password` } },
    } as unknown as ErrorEvent;
    expect(JSON.stringify(scrubEvent(event))).not.toContain(TOKEN);
  });
});

describe('public base URL for email links (security: never the Host header)', () => {
  it('requires BOOKIT_PUBLIC_URL outside local runs and defaults it locally', () => {
    expect(() => publicBaseUrl({ BOOKIT_ENV: 'staging' })).toThrow('BOOKIT_PUBLIC_URL must be set outside local runs.');
    expect(publicBaseUrl({ BOOKIT_ENV: 'local' }).toString()).toBe(`${LOCAL_PUBLIC_URL}/`);
    expect(publicBaseUrl({ BOOKIT_ENV: 'production', BOOKIT_PUBLIC_URL: 'https://acme.example.test' }).origin).toBe(
      'https://acme.example.test',
    );
  });

  it('accepts only a bare http or https origin', () => {
    for (const bad of [
      'acme.example.test',
      'ftp://acme.example.test',
      'https://user:pw@acme.example.test',
      'https://acme.example.test/app',
      'https://acme.example.test/?x=1',
      'javascript:alert(1)',
    ]) {
      expect(() => publicBaseUrl({ BOOKIT_ENV: 'staging', BOOKIT_PUBLIC_URL: bad })).toThrow(RuntimeConfigurationError);
    }
  });
});

describe('reset request rate limit (bead supportagents-8uvs)', () => {
  it('allows up to the limit within the window and again once it has passed', () => {
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMinutes: 15 });
    const start = new Date('2026-10-20T07:00:00Z');
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.allows('email:a@b.test', start)).toBe(true);
      limiter.record('email:a@b.test', start);
    }
    expect(limiter.allows('email:a@b.test', start)).toBe(false);
    expect(limiter.allows('email:other@b.test', start)).toBe(true);
    expect(limiter.allows('email:a@b.test', new Date('2026-10-20T07:15:00.001Z'))).toBe(true);
  });
});

describe('password reset email (bead supportagents-8uvs)', () => {
  it('sends the link only in the body, says how long it works, and names the clinic', () => {
    const link = `https://acme.example.test${resetPasswordPath(TOKEN)}`;
    const email = composePasswordResetEmail({
      to: 'patient1@patients.example.test',
      name: 'Pat One',
      clinicName: 'Test Physio Clinic',
      link,
      validMinutes: 30,
      from: 'noreply@clinic.example.test',
    });
    expect(email.subject).toBe('Reset your Test Physio Clinic password');
    expect(email.subject).not.toContain(TOKEN);
    expect(email.text).toContain(`\n${link}\n`);
    expect(email.text).toContain('within 30 minutes');
    expect(email.text).toContain('The link works once.');
  });
});
