import { DrizzleQueryError } from 'drizzle-orm/errors';

interface PostgresErrorFields {
  code: string;
  constraint?: string;
}

/** The PostgreSQL error behind an error, following `cause` links. */
export function postgresErrorOf(error: unknown): PostgresErrorFields | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      typeof current.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(current.code)
    ) {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string' ? current.constraint : undefined;
      return constraint === undefined ? { code: current.code } : { code: current.code, constraint };
    }
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
  return null;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = postgresErrorOf(error);
  return pg?.code === '23505' && pg.constraint === constraint;
}

/**
 * A database failure with the query parameters removed. Drizzle's query
 * errors carry every parameter (emails, phone numbers, password hashes), so
 * they must never reach logs, error pages or error reporting as they are.
 */
export class DatabaseError extends Error {
  override readonly name = 'DatabaseError';
  readonly code: string | undefined;
  readonly constraint: string | undefined;

  constructor(fields: PostgresErrorFields | null) {
    super(
      fields ? `Database error ${fields.code}${fields.constraint ? ` on ${fields.constraint}` : ''}` : 'Database error',
    );
    this.code = fields?.code;
    this.constraint = fields?.constraint;
  }
}

/** Replaces database errors with a parameter-free DatabaseError. */
export function withoutQueryDetails(error: unknown): unknown {
  if (error instanceof DrizzleQueryError || postgresErrorOf(error)) {
    return new DatabaseError(postgresErrorOf(error));
  }
  return error;
}
