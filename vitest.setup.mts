// `src/config/enviroment.ts` throws at import time when JWT_TOKEN_SECRET or
// REFRESH_TOKEN_SECRET are missing, and any service module transitively imports
// it. Without these, whether a test runs at all depends on a developer having a
// local `.env` — so the suite would pass here and fail in CI for a reason that
// has nothing to do with the code under test.
//
// Only filled in when absent, so a real `.env` still wins.
const defaults: Record<string, string> = {
  JWT_TOKEN_SECRET: 'test-jwt-secret',
  REFRESH_TOKEN_SECRET: 'test-refresh-secret'
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
