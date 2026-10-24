// Who a running container is, from its configuration (plan 12.6, 12.8):
// BOOKIT_PRODUCT, BOOKIT_TENANT and BOOKIT_ENV are set by the Compose files
// locally and by the deploy workflow on AWS; BOOKIT_DEPLOYMENT_ID is set per
// deployment by `deploy` and `bun run demo:deploy`.

export const ENVIRONMENTS = ['local', 'staging', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export interface RuntimeIdentity {
  /** Product code, for example `ACME`; `unset` only in local runs. */
  product: string;
  /** Tenant slug, for example `acme`; `unset` only in local runs. */
  tenant: string;
  environment: Environment;
  /** Set per deployment; `unset` when the container was started without one. */
  deploymentId: string;
}

export class RuntimeConfigurationError extends Error {
  override readonly name = 'RuntimeConfigurationError';
}

const PRODUCT_CODE = /^[A-Z][A-Z0-9]{1,31}$/;
const TENANT_SLUG = /^[a-z][a-z0-9-]{1,31}$/;
const DEPLOYMENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function value(env: Readonly<Record<string, string | undefined>>, name: string): string {
  return (env[name] ?? '').trim();
}

function isEnvironment(candidate: string): candidate is Environment {
  return (ENVIRONMENTS as readonly string[]).includes(candidate);
}

/**
 * Reads and checks the container's identity. Messages name variables, never
 * their values. Outside local runs a missing product or tenant is refused, so
 * a misconfigured container can never answer /api/version as another product.
 */
export function runtimeIdentity(env: Readonly<Record<string, string | undefined>> = process.env): RuntimeIdentity {
  const environment = value(env, 'BOOKIT_ENV');
  if (!isEnvironment(environment)) {
    throw new RuntimeConfigurationError(`BOOKIT_ENV must be one of ${ENVIRONMENTS.join(', ')}.`);
  }
  const product = value(env, 'BOOKIT_PRODUCT');
  const tenant = value(env, 'BOOKIT_TENANT');
  const deploymentId = value(env, 'BOOKIT_DEPLOYMENT_ID');
  if (environment !== 'local') {
    if (product === '') {
      throw new RuntimeConfigurationError(`BOOKIT_PRODUCT must be set when BOOKIT_ENV is ${environment}.`);
    }
    if (tenant === '') {
      throw new RuntimeConfigurationError(`BOOKIT_TENANT must be set when BOOKIT_ENV is ${environment}.`);
    }
  }
  if (product !== '' && !PRODUCT_CODE.test(product)) {
    throw new RuntimeConfigurationError('BOOKIT_PRODUCT must be an upper-case product code such as ACME.');
  }
  if (tenant !== '' && !TENANT_SLUG.test(tenant)) {
    throw new RuntimeConfigurationError('BOOKIT_TENANT must be a lower-case tenant slug such as acme.');
  }
  if (deploymentId !== '' && !DEPLOYMENT_ID.test(deploymentId)) {
    throw new RuntimeConfigurationError('BOOKIT_DEPLOYMENT_ID may contain only letters, digits and . _ : -');
  }
  return {
    product: product || 'unset',
    tenant: tenant || 'unset',
    environment,
    deploymentId: deploymentId || 'unset',
  };
}

/** The base URL local runs use when BOOKIT_PUBLIC_URL is not set: `next start` on its default port. */
export const LOCAL_PUBLIC_URL = 'http://localhost:3000';

/**
 * The address patients reach this container at, for links in emails such as
 * password resets. It comes only from BOOKIT_PUBLIC_URL, never from the
 * request's Host header, which a client controls. Required outside local runs.
 */
export function publicBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): URL {
  const raw = value(env, 'BOOKIT_PUBLIC_URL');
  if (raw === '') {
    if (value(env, 'BOOKIT_ENV') === 'local') {
      return new URL(LOCAL_PUBLIC_URL);
    }
    throw new RuntimeConfigurationError('BOOKIT_PUBLIC_URL must be set outside local runs.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RuntimeConfigurationError('BOOKIT_PUBLIC_URL must be an absolute http or https URL.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/'
  ) {
    throw new RuntimeConfigurationError(
      'BOOKIT_PUBLIC_URL must be an http or https origin such as https://acme-staging.example.test, with no path, query or credentials.',
    );
  }
  return url;
}
