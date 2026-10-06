'use strict';
/**
 * PLACEHOLDER — live Google Health API connector (not built / not registered in v1).
 *
 * Plan for later:
 *  - Google Cloud project + OAuth client (web), scopes for the Google Health API
 *    (https://health.googleapis.com, v4) — read-only health/fitness scopes.
 *  - authUrl() -> Google consent; handleCallback() stores refresh token in data/ (never in the browser).
 *  - sync({ since }) pulls daily summaries (steps, sleep, heart rate, HRV, SpO2, readiness) and maps them
 *    into the same normalised { days, sleep } shape the Takeout parser emits, then store.mergeReal().
 *  - Unverified apps are limited to test users, which is fine for a single-user app.
 * Enabling it needs: GOOGLE_HEALTH_CLIENT_ID, GOOGLE_HEALTH_CLIENT_SECRET, GOOGLE_HEALTH_REDIRECT_URI.
 */
module.exports = {
  id: 'google-health-api', label: 'Google Health API (live sync)', kind: 'live',
  status: () => ({ available: false, configured: false, note: 'Planned. Not connected in v1 — use the export upload for now.' }),
  authUrl() { throw new Error('Google Health API connector is not implemented in v1'); },
  async handleCallback() { throw new Error('Google Health API connector is not implemented in v1'); },
  async sync() { throw new Error('Google Health API connector is not implemented in v1'); },
};
