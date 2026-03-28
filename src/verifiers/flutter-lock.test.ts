/**
 * Flutter Startup Lock Unit Tests (FV-06)
 *
 * Tests that the mutex correctly serializes concurrent calls
 * and releases the lock on errors.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { withFlutterLock, _resetFlutterLock } from "./flutter-lock.js";

describe("Flutter Startup Lock", () => {
  beforeEach(() => {
    _resetFlutterLock();
  });

  it("TestFlutterLock_SerializesExecution", async () => {
    const order: number[] = [];

    const task1 = withFlutterLock(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
      return "a";
    });

    const task2 = withFlutterLock(async () => {
      order.push(3);
      await new Promise((r) => setTimeout(r, 10));
      order.push(4);
      return "b";
    });

    const [r1, r2] = await Promise.all([task1, task2]);

    expect(r1).toBe("a");
    expect(r2).toBe("b");
    // Task 1 must complete (1,2) before task 2 starts (3,4)
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("TestFlutterLock_ReleasesOnError", async () => {
    const failTask = withFlutterLock(async () => {
      throw new Error("boom");
    });

    await expect(failTask).rejects.toThrow("boom");

    // Lock should be released — next task should succeed
    const result = await withFlutterLock(async () => "ok");
    expect(result).toBe("ok");
  });

  it("TestFlutterLock_SingleTaskRunsImmediately", async () => {
    const result = await withFlutterLock(async () => 42);
    expect(result).toBe(42);
  });

  it("TestFlutterLock_ThreeTasksSerialize", async () => {
    const order: string[] = [];

    const t1 = withFlutterLock(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("a-end");
    });

    const t2 = withFlutterLock(async () => {
      order.push("b-start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("b-end");
    });

    const t3 = withFlutterLock(async () => {
      order.push("c-start");
      order.push("c-end");
    });

    await Promise.all([t1, t2, t3]);

    expect(order).toEqual([
      "a-start", "a-end",
      "b-start", "b-end",
      "c-start", "c-end",
    ]);
  });
});
