/**
 * Gap Graph — Conflict Analysis for Parallel Gap Fixing
 *
 * Builds a conflict graph from gap verification results, colors it to find
 * independent groups, and provides a concurrency limiter for parallel execution.
 *
 * Two gaps conflict if they share at least one source file. Independent gaps
 * (no shared files) can be fixed concurrently without regression risk.
 *
 * Phase 16: Parallel Gap Fixing
 */

/**
 * A gap with associated file information from verification.
 * Files are the source files the agent identified as relevant to the gap.
 */
export interface GapWithFiles {
  /** Requirement ID */
  id: string;
  /** Description of what's missing */
  description: string;
  /** Source files relevant to this gap (from verification verdict) */
  files: string[];
}

/**
 * Build a conflict graph from gaps with file information.
 *
 * Two gaps conflict (have an edge) if they share at least one file.
 * Gaps with empty file lists are treated as conflicting with ALL other gaps
 * (conservative fallback — if we don't know what files a gap touches,
 * assume it could touch anything).
 *
 * @param gaps - Array of gaps with their associated files
 * @returns Adjacency map: gap ID -> set of conflicting gap IDs
 */
export function buildConflictGraph(
  gaps: GapWithFiles[],
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  // Initialize all nodes with empty edge sets
  for (const gap of gaps) {
    graph.set(gap.id, new Set<string>());
  }

  // Build file-to-gaps index for efficient overlap detection
  const fileToGaps = new Map<string, string[]>();
  const noFileGaps: string[] = [];

  for (const gap of gaps) {
    if (gap.files.length === 0) {
      noFileGaps.push(gap.id);
    } else {
      for (const file of gap.files) {
        const normalizedFile = file.toLowerCase();
        const existing = fileToGaps.get(normalizedFile) ?? [];
        existing.push(gap.id);
        fileToGaps.set(normalizedFile, existing);
      }
    }
  }

  // Add edges for gaps sharing files
  for (const gapIds of fileToGaps.values()) {
    for (let i = 0; i < gapIds.length; i++) {
      for (let j = i + 1; j < gapIds.length; j++) {
        graph.get(gapIds[i])!.add(gapIds[j]);
        graph.get(gapIds[j])!.add(gapIds[i]);
      }
    }
  }

  // Gaps with no file info conflict with everything (conservative)
  for (const noFileGapId of noFileGaps) {
    for (const gap of gaps) {
      if (gap.id !== noFileGapId) {
        graph.get(noFileGapId)!.add(gap.id);
        graph.get(gap.id)!.add(noFileGapId);
      }
    }
  }

  return graph;
}

/**
 * Color a conflict graph using greedy graph coloring.
 *
 * Nodes are processed in order of decreasing degree (most conflicts first).
 * Each node is assigned the smallest color not used by its neighbors.
 * Nodes with the same color are independent (no shared files) and can
 * run concurrently.
 *
 * @param adjacencyMap - Conflict graph from buildConflictGraph
 * @returns Map from color number (0-based) to array of gap IDs
 */
export function colorGraph(
  adjacencyMap: Map<string, Set<string>>,
): Map<number, string[]> {
  const colors = new Map<number, string[]>();

  if (adjacencyMap.size === 0) {
    return colors;
  }

  // Sort nodes by decreasing degree for better coloring
  const nodes = [...adjacencyMap.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([id]) => id);

  const nodeColor = new Map<string, number>();

  for (const node of nodes) {
    // Find colors used by neighbors
    const neighborColors = new Set<number>();
    for (const neighbor of adjacencyMap.get(node)!) {
      const nc = nodeColor.get(neighbor);
      if (nc !== undefined) {
        neighborColors.add(nc);
      }
    }

    // Assign smallest color not used by neighbors
    let color = 0;
    while (neighborColors.has(color)) {
      color++;
    }

    nodeColor.set(node, color);

    // Add to color group
    const group = colors.get(color) ?? [];
    group.push(node);
    colors.set(color, group);
  }

  return colors;
}

/**
 * Analyze gap overlap and return independent execution groups.
 *
 * Convenience function combining buildConflictGraph + colorGraph.
 * Returns an array of arrays: each inner array is a group of gap IDs
 * that can be fixed concurrently (no shared files).
 *
 * Groups are ordered by color number (deterministic).
 *
 * @param gaps - Array of gaps with file information
 * @returns Array of groups, each group contains gap IDs safe to run in parallel
 */
export function analyzeGapOverlap(gaps: GapWithFiles[]): string[][] {
  if (gaps.length === 0) {
    return [];
  }

  const graph = buildConflictGraph(gaps);
  const colorMap = colorGraph(graph);

  // Convert to sorted array of groups
  const sortedColors = [...colorMap.keys()].sort((a, b) => a - b);
  return sortedColors.map((color) => colorMap.get(color)!);
}

/**
 * Execute async tasks with a concurrency limit.
 *
 * Uses Promise.allSettled semantics: all tasks run to completion (or rejection),
 * never short-circuits. Results are returned in the same order as input tasks.
 *
 * @param tasks - Array of task factory functions (called to start execution)
 * @param maxConcurrent - Maximum number of tasks running simultaneously
 * @returns Array of PromiseSettledResult in input order
 */
export async function limitConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrent: number,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex++;

      try {
        const value = await tasks[currentIndex]();
        results[currentIndex] = { status: "fulfilled", value };
      } catch (reason) {
        results[currentIndex] = { status: "rejected", reason };
      }
    }
  }

  // Start up to maxConcurrent workers
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(maxConcurrent, tasks.length); i++) {
    workers.push(runNext());
  }

  await Promise.all(workers);

  return results;
}
