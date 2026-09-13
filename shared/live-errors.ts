/** A rejected Live command is distinct from a terminated voice session. */
export function isRecoverableLiveError(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const value = event as Record<string, unknown>;
  if (value.type !== 'error' || !value.error || typeof value.error !== 'object') return false;
  return (value.error as Record<string, unknown>).type === 'invalid_request_error';
}
