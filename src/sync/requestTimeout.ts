import { REQUEST_TIMEOUT_MS } from '../constants';

/**
 * Bound a request with a timeout. `requestUrl` has no timeout option, so race
 * the pending promise against a timer and clear the timer when either settles.
 */
export function withTimeout<T>(
  request: Promise<T>,
  timeoutMessage: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => {
      const error = new Error(timeoutMessage);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([request, timeout]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}
