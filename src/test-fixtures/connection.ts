import type { ConnectionDiagnostics } from '../types';

// Synthetic UI fixtures, not records of a live provider connection.
export function diagnosticFixture(status = 'not_tested', live = false): ConnectionDiagnostics {
  const entry = { provider: 'meta', model: 'muse-spark-1.3', configuration: { status: 'configured_not_verified', credentials_configured: true, message: 'A key is present; it is not verified.' }, last_test: { status, message: status === 'invalid_credentials' ? 'Credential rejected.' : 'Synthetic test fixture.', last_attempt_at: status === 'not_tested' ? null : '2026-10-26T12:00:00+00:00', last_success_at: live ? '2026-10-26T12:00:00+00:00' : null, live_request_succeeded: live, ever_live_request_succeeded: live, test_in_progress: false, provider_http_status: status === 'not_tested' ? null : live ? 200 : 401 }, test_scope: 'text_inference' };
  return { selected_sam_provider: 'meta', integrations: { muse: entry, sam: { ...entry, model: 'sam-3.1', last_test: { ...entry.last_test, status: 'not_tested', last_attempt_at: null, last_success_at: null, live_request_succeeded: false, ever_live_request_succeeded: false }, test_scope: 'synthetic_image_segmentation' } } };
}
