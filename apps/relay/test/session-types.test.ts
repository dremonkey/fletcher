import { describe, test, expect } from "bun:test";
import { createAsyncInputChannel } from "../src/session/types";

describe("createAsyncInputChannel", () => {
  test("push then iterate: push a value, async iterate, get it back", async () => {
    const channel = createAsyncInputChannel<string>();
    channel.push("hello");

    const results: string[] = [];
    // Use the iterator directly to pull one value, then close
    const iter = channel[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value).toBe("hello");

    channel.close();
    const end = await iter.next();
    expect(end.done).toBe(true);
  });

  test("push multiple values, iterate to get them in order", async () => {
    const channel = createAsyncInputChannel<number>();
    channel.push(1);
    channel.push(2);
    channel.push(3);
    channel.close();

    const results: number[] = [];
    for await (const value of channel) {
      results.push(value);
    }
    expect(results).toEqual([1, 2, 3]);
  });

  test("close the channel, iterator completes (done: true)", async () => {
    const channel = createAsyncInputChannel<string>();
    channel.close();

    const iter = channel[Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result.done).toBe(true);
  });

  test("push before any consumer: values are buffered", async () => {
    const channel = createAsyncInputChannel<string>();
    channel.push("a");
    channel.push("b");
    channel.push("c");

    // No consumer was waiting — values should be buffered
    const iter = channel[Symbol.asyncIterator]();
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toBe("a");

    const r2 = await iter.next();
    expect(r2.done).toBe(false);
    expect(r2.value).toBe("b");

    const r3 = await iter.next();
    expect(r3.done).toBe(false);
    expect(r3.value).toBe("c");

    channel.close();
    const r4 = await iter.next();
    expect(r4.done).toBe(true);
  });

  test("interleaved push/pull works correctly", async () => {
    const channel = createAsyncInputChannel<string>();
    const iter = channel[Symbol.asyncIterator]();

    // Start waiting before any value is pushed
    const promise1 = iter.next();
    channel.push("first");
    const r1 = await promise1;
    expect(r1.done).toBe(false);
    expect(r1.value).toBe("first");

    // Push then pull
    channel.push("second");
    const r2 = await iter.next();
    expect(r2.done).toBe(false);
    expect(r2.value).toBe("second");

    // Wait again, then push
    const promise3 = iter.next();
    channel.push("third");
    const r3 = await promise3;
    expect(r3.done).toBe(false);
    expect(r3.value).toBe("third");

    // Close while waiting
    const promise4 = iter.next();
    channel.close();
    const r4 = await promise4;
    expect(r4.done).toBe(true);
  });
});
