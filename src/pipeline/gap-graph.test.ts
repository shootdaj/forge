/**
 * Gap Graph — Unit Tests
 *
 * Tests for conflict graph construction, greedy graph coloring,
 * gap overlap analysis, and concurrency limiting.
 *
 * Phase 16: Parallel Gap Fixing
 */

import { describe, it, expect } from "vitest";
import {
  buildConflictGraph,
  colorGraph,
  analyzeGapOverlap,
  limitConcurrency,
  type GapWithFiles,
} from "./gap-graph.js";

// ---------------------------------------------------------------------------
// buildConflictGraph
// ---------------------------------------------------------------------------

describe("buildConflictGraph", () => {
  it("creates edges between gaps sharing files", () => {
    const gaps: GapWithFiles[] = [
      { id: "R1", description: "gap1", files: ["src/app.ts"] },
      { id: "R2", description: "gap2", files: ["src/app.ts", "src/db.ts"] },
      { id: "R3", description: "gap3", files: ["src/auth.ts"] },
    ];
    const graph = buildConflictGraph(gaps);

    // R1 and R2 share src/app.ts -> edge
    expect(graph.get("R1")?.has("R2")).toBe(true);
    expect(graph.get("R2")?.has("R1")).toBe(true);

    // R3 shares no files with R1 or R2 -> no edges
    expect(graph.get("R1")?.has("R3")).toBe(false);
    expect(graph.get("R3")?.has("R1")).toBe(false);
    expect(graph.get("R2")?.has("R3")).toBe(false);
    expect(graph.get("R3")?.has("R2")).toBe(false);
  });

  it("treats gaps with empty files as conflicting with all others", () => {
    const gaps: GapWithFiles[] = [
      { id: "R1", description: "gap1", files: [] },
      { id: "R2", description: "gap2", files: ["src/app.ts"] },
      { id: "R3", description: "gap3", files: ["src/db.ts"] },
    ];
    const graph = buildConflictGraph(gaps);

    // R1 has no files -> conflicts with everything
    expect(graph.get("R1")?.has("R2")).toBe(true);
    expect(graph.get("R1")?.has("R3")).toBe(true);
    expect(graph.get("R2")?.has("R1")).toBe(true);
    expect(graph.get("R3")?.has("R1")).toBe(true);

    // R2 and R3 don't share files -> no edge between them
    expect(graph.get("R2")?.has("R3")).toBe(false);
  });

  it("returns empty edges for single gap", () => {
    const gaps: GapWithFiles[] = [
      { id: "R1", description: "gap1", files: ["src/app.ts"] },
    ];
    const graph = buildConflictGraph(gaps);
    expect(graph.get("R1")?.size).toBe(0);
  });

  it("handles case-insensitive file paths", () => {
    const gaps: GapWithFiles[] = [
      { id: "R1", description: "gap1", files: ["src/App.ts"] },
      { id: "R2", description: "gap2", files: ["src/app.ts"] },
    ];
    const graph = buildConflictGraph(gaps);
    expect(graph.get("R1")?.has("R2")).toBe(true);
    expect(graph.get("R2")?.has("R1")).toBe(true);
  });

  it("returns empty graph for no gaps", () => {
    const graph = buildConflictGraph([]);
    expect(graph.size).toBe(0);
  });

  it("handles multiple shared files between same pair", () => {
    const gaps: GapWithFiles[] = [
      { id: "R1", description: "gap1", files: ["src/a.ts", "src/b.ts"] },
      { id: "R2", description: "gap2", files: ["src/b.ts", "src/c.ts"] },
    ];
    const graph = buildConflictGraph(gaps);
    // Should have exactly one edge (not duplicated)
    expect(graph.get("R1")?.has("R2")).toBe(true);
    expect(graph.get("R1")?.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// colorGraph
// ---------------------------------------------------------------------------

describe("colorGraph", () => {
  it("assigns same color to independent gaps (no edges)", () => {
    const graph = new Map<string, Set<string>>();
    graph.set("R1", new Set());
    graph.set("R2", new Set());
    graph.set("R3", new Set());
    const colors = colorGraph(graph);

    // All independent -> all in color 0
    expect(colors.size).toBe(1);
    expect(colors.get(0)?.sort()).toEqual(["R1", "R2", "R3"]);
  });

  it("assigns different colors to fully connected gaps", () => {
    const graph = new Map<string, Set<string>>();
    graph.set("R1", new Set(["R2", "R3"]));
    graph.set("R2", new Set(["R1", "R3"]));
    graph.set("R3", new Set(["R1", "R2"]));
    const colors = colorGraph(graph);

    // All conflict -> each gets its own color
    expect(colors.size).toBe(3);
    for (const group of colors.values()) {
      expect(group.length).toBe(1);
    }
  });

  it("produces valid coloring (no adjacent same color)", () => {
    const graph = new Map<string, Set<string>>();
    graph.set("R1", new Set(["R2"]));
    graph.set("R2", new Set(["R1", "R3"]));
    graph.set("R3", new Set(["R2"]));
    const colors = colorGraph(graph);

    // Verify no two adjacent nodes share a color
    for (const [, nodes] of colors) {
      for (const nodeA of nodes) {
        for (const nodeB of nodes) {
          if (nodeA !== nodeB) {
            expect(graph.get(nodeA)?.has(nodeB)).toBe(false);
          }
        }
      }
    }
  });

  it("handles empty graph", () => {
    const colors = colorGraph(new Map());
    expect(colors.size).toBe(0);
  });

  it("handles linear chain (A-B-C) with 2 colors", () => {
    const graph = new Map<string, Set<string>>();
    graph.set("A", new Set(["B"]));
    graph.set("B", new Set(["A", "C"]));
    graph.set("C", new Set(["B"]));
    const colors = colorGraph(graph);

    // Linear chain needs at most 2 colors
    expect(colors.size).toBeLessThanOrEqual(2);

    // A and C should be same color (not adjacent)
    let colorOfA = -1;
    let colorOfC = -1;
    for (const [color, nodes] of colors) {
      if (nodes.includes("A")) colorOfA = color;
      if (nodes.includes("C")) colorOfC = color;
    }
    expect(colorOfA).toBe(colorOfC);
  });
});

// ---------------------------------------------------------------------------
// analyzeGapOverlap
// ---------------------------------------------------------------------------

describe("analyzeGapOverlap", () => {
  it("groups independent gaps together", () => {
    const gaps: GapWithFiles[] = [
      { id: "R1", description: "gap1", files: ["src/a.ts"] },
      { id: "R2", description: "gap2", files: ["src/b.ts"] },
      { id: "R3", description: "gap3", files: ["src/c.ts"] },
    ];
    const groups = analyzeGapOverlap(gaps);

    // All independent -> single group
    expect(groups.length).toBe(1);
    expect(groups[0].sort()).toEqual(["R1", "R2", "R3"]);
  });

  it("separates overlapping gaps into different groups", () => {
    const gaps: GapWithFiles[] = [
      { id: "R1", description: "gap1", files: ["src/shared.ts"] },
      { id: "R2", description: "gap2", files: ["src/shared.ts"] },
      { id: "R3", description: "gap3", files: ["src/other.ts"] },
    ];
    const groups = analyzeGapOverlap(gaps);

    // R1 and R2 conflict -> different groups
    expect(groups.length).toBeGreaterThanOrEqual(2);

    // No group should have both R1 and R2
    for (const group of groups) {
      expect(group.includes("R1") && group.includes("R2")).toBe(false);
    }

    // All gap IDs should be present across all groups
    const allGapIds = groups.flat().sort();
    expect(allGapIds).toEqual(["R1", "R2", "R3"]);
  });

  it("returns each gap in own group when all lack file info", () => {
    const gaps: GapWithFiles[] = [
      { id: "R1", description: "gap1", files: [] },
      { id: "R2", description: "gap2", files: [] },
    ];
    const groups = analyzeGapOverlap(gaps);

    // All conflict with each other -> each in own group (sequential)
    expect(groups.length).toBe(2);
    expect(groups[0].length).toBe(1);
    expect(groups[1].length).toBe(1);
  });

  it("returns empty array for no gaps", () => {
    const groups = analyzeGapOverlap([]);
    expect(groups).toEqual([]);
  });

  it("handles complex overlap pattern", () => {
    const gaps: GapWithFiles[] = [
      { id: "R1", description: "g1", files: ["src/a.ts", "src/b.ts"] },
      { id: "R2", description: "g2", files: ["src/b.ts", "src/c.ts"] },
      { id: "R3", description: "g3", files: ["src/d.ts"] },
      { id: "R4", description: "g4", files: ["src/d.ts", "src/e.ts"] },
      { id: "R5", description: "g5", files: ["src/f.ts"] },
    ];
    const groups = analyzeGapOverlap(gaps);

    // R1-R2 overlap (src/b.ts), R3-R4 overlap (src/d.ts), R5 independent
    // Should have at least 2 groups since R1-R2 and R3-R4 form separate clusters
    expect(groups.length).toBeGreaterThanOrEqual(2);

    // No group should have both R1 and R2 (they share src/b.ts)
    for (const group of groups) {
      expect(group.includes("R1") && group.includes("R2")).toBe(false);
    }

    // No group should have both R3 and R4 (they share src/d.ts)
    for (const group of groups) {
      expect(group.includes("R3") && group.includes("R4")).toBe(false);
    }

    // All gaps accounted for
    expect(groups.flat().sort()).toEqual(["R1", "R2", "R3", "R4", "R5"]);
  });
});

// ---------------------------------------------------------------------------
// limitConcurrency
// ---------------------------------------------------------------------------

describe("limitConcurrency", () => {
  it("runs all tasks and returns results in order", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
      () => Promise.resolve("c"),
    ];
    const results = await limitConcurrency(tasks, 2);

    expect(results.length).toBe(3);
    expect(results[0]).toEqual({ status: "fulfilled", value: "a" });
    expect(results[1]).toEqual({ status: "fulfilled", value: "b" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "c" });
  });

  it("limits concurrent execution to maxConcurrent", async () => {
    let activeTasks = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      activeTasks++;
      maxActive = Math.max(maxActive, activeTasks);
      await new Promise((r) => setTimeout(r, 30));
      activeTasks--;
      return i;
    });

    await limitConcurrency(tasks, 2);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("handles rejected promises without stopping others", async () => {
    const tasks = [
      () => Promise.resolve("ok"),
      () => Promise.reject(new Error("fail")),
      () => Promise.resolve("also ok"),
    ];
    const results = await limitConcurrency(tasks, 3);

    expect(results[0]).toEqual({ status: "fulfilled", value: "ok" });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: "also ok" });
  });

  it("handles empty task array", async () => {
    const results = await limitConcurrency([], 3);
    expect(results).toEqual([]);
  });

  it("works with maxConcurrent of 1 (sequential)", async () => {
    const order: number[] = [];
    const tasks = [0, 1, 2].map((i) => async () => {
      order.push(i);
      await new Promise((r) => setTimeout(r, 10));
      return i;
    });

    const results = await limitConcurrency(tasks, 1);
    expect(order).toEqual([0, 1, 2]); // Strictly sequential
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("handles maxConcurrent larger than task count", async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
    ];
    const results = await limitConcurrency(tasks, 10);

    expect(results.length).toBe(2);
    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1]).toEqual({ status: "fulfilled", value: 2 });
  });
});
