import { HttpErrorResponse } from '@angular/common/http';

// One sentence for the page when a call fails: the API's own sentence when it sent one, a reachable-API line when
// nothing came back, and the caller's fallback for anything else.
export function errorText(
  err: HttpErrorResponse,
  fallback = 'Something went wrong. Try again in a moment',
): string {
  // Nothing came back at all. Checked first: the browser's own error ("Failed to fetch") rides along in the body,
  // and that is not a sentence for the page
  if (err?.status === 0) return 'Could not reach the API. Check if it is running';
  const body = err?.error;
  if (typeof body === 'string' && body) return body;
  if (body?.detail) return body.detail;
  if (body?.message) return body.message;
  if (body?.errors) return Object.values(body.errors).flat().join(' ');
  if (err?.status === 0) return 'Could not reach the API. Check if it is running';
  return fallback;
}
