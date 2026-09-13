export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw signal.reason;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal!.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const readOnly = ['GET', 'HEAD'].includes(method.toUpperCase());
  // Conversation mutations can await a bounded model call. Snapshot reads need
  // less time; callers such as the project feed can still cancel them earlier.
  const timeout = setTimeout(() => {
    const error = new Error(readOnly
      ? 'The studio response timed out. Please try loading it again.'
      : 'The studio response timed out. Your request may still be saved or running. Check your project and activity before retrying.');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, readOnly ? 30000 : 150000);
  try {
    const response = await fetch(`/api/studio${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: controller.signal });
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return { error: 'The studio service is unavailable.' };
      });
      throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error
        ? data.error : 'The request could not be completed.');
    }
    // Await the body inside this scope so slow/stalled JSON cannot outlive the
    // request deadline. Native fetch also aborts its response stream.
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
export function download(data: string | Blob, name: string, mime = 'application/json') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
