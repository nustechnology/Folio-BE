/**
 * Prisma's `contains` compiles to `LIKE`/`ILIKE` without escaping the pattern,
 * so `%` and `_` from user input act as wildcards — `?search=100%` would match
 * "100X done". Postgres treats backslash as the default escape character, so
 * escaping it first keeps a literal backslash searchable.
 */
export const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, (char) => `\\${char}`);
