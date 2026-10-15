import { describe, expect, it } from "vitest";
import { percentile, Recorder, summarize } from "../load/stats.js";

describe("percentile", () => {
  it("uses nearest rank", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile(hundred, 99)).toBe(99);
    expect(percentile(hundred, 100)).toBe(100);
  });
  it("handles one sample, no samples and out-of-range percentiles", () => {
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 150)).toBe(3);
  });
});

describe("summarize", () => {
  it("sorts its input without changing it", () => {
    const input = [30, 10, 20];
    expect(summarize(input)).toEqual({ count: 3, p50: 20, p95: 30, p99: 30, max: 30 });
    expect(input).toEqual([30, 10, 20]);
  });
  it("is all zeros for no samples", () => {
    expect(summarize([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe("Recorder", () => {
  it("counts outcomes per operation and keeps conflicts apart from errors", () => {
    const recorder = new Recorder();
    recorder.record("vote", 10, "ok");
    recorder.record("vote", 20, "error");
    recorder.record("move", 5, "conflict");
    recorder.recordFailure("broadcast");
    expect(recorder.operations()).toEqual(["broadcast", "move", "vote"]);
    expect(recorder.errorCount("vote")).toBe(1);
    expect(recorder.errorCount("move")).toBe(0);
    expect(recorder.conflictCount("move")).toBe(1);
    expect(recorder.totalErrors()).toBe(2);
    expect(recorder.totalCount(["vote", "move"])).toBe(3);
    expect(recorder.summary("vote").max).toBe(20);
    expect(recorder.summary("unknown").count).toBe(0);
  });
});
