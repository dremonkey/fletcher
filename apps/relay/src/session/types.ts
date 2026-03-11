import type { ServerWebSocket } from "bun";

export type SessionStatus =
  | "idle"
  | "running"
  | "waiting_for_user"
  | "completed"
  | "error"
  | "cancelled";

export interface WebSocketData {
  connId: string;
}

export interface AsyncInputChannel<T = unknown> {
  push(message: T): void;
  close(): void;
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}

export interface Session {
  id: string;
  status: SessionStatus;
  createdAt: number;
  prompt: string;
  ws: ServerWebSocket<WebSocketData>;
  pendingResolve: ((value: unknown) => void) | null;
  abortController: AbortController;
  inputChannel: AsyncInputChannel | null;
}

export function createAsyncInputChannel<T = unknown>(): AsyncInputChannel<T> {
  const queue: T[] = [];
  let pending: { resolve: (value: IteratorResult<T>) => void } | null = null;
  let closed = false;

  return {
    push(message: T): void {
      if (closed) return;
      if (pending) {
        const p = pending;
        pending = null;
        p.resolve({ done: false, value: message });
      } else {
        queue.push(message);
      }
    },

    close(): void {
      if (closed) return;
      closed = true;
      if (pending) {
        const p = pending;
        pending = null;
        p.resolve({ done: true, value: undefined as T });
      }
    },

    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            return Promise.resolve({ done: false, value: queue.shift()! });
          }
          if (closed) {
            return Promise.resolve({ done: true, value: undefined as T });
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            pending = { resolve };
          });
        },

        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
}
