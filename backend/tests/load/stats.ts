// Small statistics helpers for the ramp-up harness (unit-tested in tests/unit/load-stats.test.ts).

/** Nearest-rank percentile of an ascending list; 0 for an empty list. `p` is 0..100. */
export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  return sortedAscending[Math.min(Math.max(rank, 1), sortedAscending.length) - 1]!;
}

export interface Summary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function summarize(samples: number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1]! : 0,
  };
}

/** Collects latencies and outcomes per named operation. */
export class Recorder {
  private latencies = new Map<string, number[]>();
  private errors = new Map<string, number>();
  private conflicts = new Map<string, number>();

  /** `ok` = the answer the contract allows; `conflict` = a legitimate concurrency answer (404/409 after another edit). */
  record(operation: string, ms: number, outcome: "ok" | "conflict" | "error"): void {
    const bucket = this.latencies.get(operation) ?? [];
    bucket.push(ms);
    this.latencies.set(operation, bucket);
    if (outcome === "error")
      this.errors.set(operation, (this.errors.get(operation) ?? 0) + 1);
    if (outcome === "conflict")
      this.conflicts.set(operation, (this.conflicts.get(operation) ?? 0) + 1);
  }

  /** Counts a failure that has no latency (a connection that never opened, a missed broadcast). */
  recordFailure(operation: string): void {
    this.errors.set(operation, (this.errors.get(operation) ?? 0) + 1);
  }

  operations(): string[] {
    return [...new Set([...this.latencies.keys(), ...this.errors.keys()])].sort();
  }
  summary(operation: string): Summary {
    return summarize(this.latencies.get(operation) ?? []);
  }
  errorCount(operation: string): number {
    return this.errors.get(operation) ?? 0;
  }
  conflictCount(operation: string): number {
    return this.conflicts.get(operation) ?? 0;
  }
  totalErrors(operations: string[] = this.operations()): number {
    return operations.reduce((sum, op) => sum + this.errorCount(op), 0);
  }
  totalCount(operations: string[] = this.operations()): number {
    return operations.reduce((sum, op) => sum + this.summary(op).count, 0);
  }
}
