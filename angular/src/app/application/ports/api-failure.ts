// A call to the API that failed, as the page reads it: the status (0 when nothing came back), the body the API sent,
// and its headers. Infrastructure's HTTP errors already have this shape, so nothing is converted on the way; what
// changes is that the use cases and the pages depend on this instead of on the HTTP library.
export interface ApiFailure {
  readonly status: number;
  readonly statusText?: string;
  // The body as the API sent it: one sentence, or a problem with detail, title or errors
  readonly error: any;
  readonly headers?: { get(name: string): string | null };
}

export function isApiFailure(value: unknown): value is ApiFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'number' &&
    'error' in value
  );
}
