import { expect } from "vitest";
import type { Socket } from "socket.io-client";

/** Collects what a socket receives, so a test can wait for a message or prove there was none. */
export class Inbox<T> {
  readonly messages: T[] = [];
  private waiters: (() => void)[] = [];

  constructor(socket: Socket, event: string) {
    socket.on(event, (message: T) => {
      this.messages.push(message);
      this.waiters.splice(0).forEach((wake) => wake());
    });
  }

  /** Resolves once `count` messages have arrived in total. */
  async waitFor(count: number, timeoutMs = 3000): Promise<T[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.messages.length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error(`expected ${count} messages, got ${this.messages.length}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return this.messages;
  }

  /** Waits a moment and proves that nothing (more) arrived. */
  async expectNoMoreThan(count: number, quietMs = 400): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, quietMs));
    expect(this.messages.length).toBeLessThanOrEqual(count);
  }
}
