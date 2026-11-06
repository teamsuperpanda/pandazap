import { requestUrl } from 'obsidian';
import { ANKI_CONNECT_VERSION, REQUEST_TIMEOUT_MS, RETRY_BACKOFF_BASE_MS } from '../constants';

/** Why an AnkiConnect request failed. */
export type AnkiConnectErrorKind = 'network' | 'timeout' | 'http' | 'protocol' | 'remote';

export interface AnkiConnectErrorInit {
  kind: AnkiConnectErrorKind;
  action: string;
  message: string;
  status?: number;
  cause?: unknown;
}

/** A transport failure, tagged with its kind, the action and the original cause. */
export class AnkiConnectError extends Error {
  readonly kind: AnkiConnectErrorKind;
  readonly action: string;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(init: AnkiConnectErrorInit) {
    super(init.message);
    this.name = 'AnkiConnectError';
    this.kind = init.kind;
    this.action = init.action;
    this.status = init.status;
    this.cause = init.cause;
  }
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof AnkiConnectError) return error.kind === 'network';
  return (
    error instanceof Error &&
    (error.name === 'TypeError' ||
      error.message === 'Failed to fetch' ||
      error.message.includes('net::'))
  );
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof AnkiConnectError) return error.kind === 'timeout';
  return error instanceof Error && error.name === 'TimeoutError';
}

export interface AnkiConnectRequestOptions<T> {
  /** Validates the action's result. Throw to fail with a protocol error. */
  parse?: (result: unknown) => T;
  /** Overrides the action's default retry eligibility. */
  idempotent?: boolean;
}

export interface AnkiConnectTransportRequest {
  url: string;
  method: string;
  contentType: string;
  body: string;
  throw: boolean;
}

export interface AnkiConnectTransportResponse {
  status: number;
  json: unknown;
}

export interface AnkiConnectClientOptions {
  request?: (request: AnkiConnectTransportRequest) => Promise<AnkiConnectTransportResponse>;
  delay?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
}

// A lost response for these would create a duplicate note or media file, so
// they are sent once and never retried.
const NON_IDEMPOTENT_ACTIONS = new Set(['addNote', 'storeMediaFile']);
const MAX_RETRIES = 2;
const BACKOFF_JITTER_RATIO = 0.15;

type TimerHandle = number;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * AnkiConnect HTTP JSON-RPC transport: envelope validation, typed errors,
 * timeout and retry/backoff. It knows nothing about notes, settings or sync
 * state, so callers inject the request, clock and randomness it uses.
 */
export class AnkiConnectClient {
  private readonly endpoint: string;
  private readonly send: (
    request: AnkiConnectTransportRequest
  ) => Promise<AnkiConnectTransportResponse>;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;

  constructor(endpoint: string, options: AnkiConnectClientOptions = {}) {
    this.endpoint = endpoint;
    this.send = options.request ?? requestUrl;
    this.delay = options.delay ?? defaultDelay;
    this.random = options.random ?? Math.random;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.backoffBaseMs = options.backoffBaseMs ?? RETRY_BACKOFF_BASE_MS;
  }

  async request<T = unknown>(
    action: string,
    params?: Record<string, unknown>,
    options: AnkiConnectRequestOptions<T> = {}
  ): Promise<T> {
    const body = JSON.stringify({ action, version: ANKI_CONNECT_VERSION, params });
    const idempotent = options.idempotent ?? !NON_IDEMPOTENT_ACTIONS.has(action);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt<T>(action, body, options.parse);
      } catch (error: unknown) {
        const retryable =
          (isNetworkError(error) || isTimeoutError(error)) &&
          idempotent &&
          attempt < this.maxRetries;
        if (!retryable) throw error;
        await this.delay(this.backoffFor(attempt));
      }
    }
  }

  /** Backoff before the retry that follows a given zero-based attempt. */
  private backoffFor(attempt: number): number {
    return (
      this.backoffBaseMs * Math.pow(2, attempt) +
      this.random() * (this.backoffBaseMs * BACKOFF_JITTER_RATIO)
    );
  }

  private async attempt<T>(
    action: string,
    body: string,
    parse?: (result: unknown) => T
  ): Promise<T> {
    const timeoutMessage = `Anki Connect request "${action}" timed out after ${this.timeoutMs} ms. Make sure Anki is running with the AnkiConnect addon and that ${this.endpoint} is reachable.`;

    let response: AnkiConnectTransportResponse;
    try {
      response = await this.withTimeout(
        this.send({
          url: this.endpoint,
          method: 'POST',
          contentType: 'application/json',
          body,
          throw: false,
        }),
        timeoutMessage
      );
    } catch (error: unknown) {
      if (isTimeoutError(error)) {
        throw new AnkiConnectError({
          kind: 'timeout',
          action,
          message: timeoutMessage,
          cause: error,
        });
      }
      if (isNetworkError(error)) {
        throw new AnkiConnectError({
          kind: 'network',
          action,
          message: errorMessage(error),
          cause: error,
        });
      }
      // Anything else the transport threw is not retry-safe; keep its message
      // and report it as a failure to understand the exchange.
      throw new AnkiConnectError({
        kind: 'protocol',
        action,
        message: errorMessage(error),
        cause: error,
      });
    }

    if (response.status < 200 || response.status >= 300) {
      throw new AnkiConnectError({
        kind: 'http',
        action,
        status: response.status,
        message: `Anki Connect HTTP ${response.status}`,
      });
    }

    const data = response.json as { result?: unknown; error?: unknown } | null | undefined;
    if (
      !data ||
      typeof data !== 'object' ||
      !Object.prototype.hasOwnProperty.call(data, 'result') ||
      !Object.prototype.hasOwnProperty.call(data, 'error') ||
      (data.error !== null && typeof data.error !== 'string')
    ) {
      throw new AnkiConnectError({
        kind: 'protocol',
        action,
        message: 'Invalid response from Anki Connect',
      });
    }
    if (typeof data.error === 'string' && data.error.length > 0) {
      throw new AnkiConnectError({ kind: 'remote', action, message: data.error });
    }

    if (parse) {
      try {
        return parse(data.result);
      } catch (error: unknown) {
        throw new AnkiConnectError({
          kind: 'protocol',
          action,
          message: errorMessage(error),
          cause: error,
        });
      }
    }
    return data.result as T;
  }

  /** Reject with a timeout error when the request outlives `timeoutMs`. */
  private withTimeout<T>(request: Promise<T>, timeoutMessage: string): Promise<T> {
    let timer: TimerHandle | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = window.setTimeout(() => {
        const error = new Error(timeoutMessage);
        error.name = 'TimeoutError';
        reject(error);
      }, this.timeoutMs);
    });

    return Promise.race([request, timeout]).finally(() => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
