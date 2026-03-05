/**
 * Dependency Graph Builder + Topological Sort
 *
 * Pure functions that parse a ROADMAP.md to extract phases and their
 * dependency relationships, then compute execution waves via topological sort.
 *
 * The dependency graph determines phase execution order for the pipeline
 * controller. Phases with no unresolved dependencies form the first wave;
 * phases whose dependencies are all in earlier waves form subsequent waves.
 *
 * Requirements: PIPE-11, PIPE-03
 */

import type { PipelinePhase } from "./types.js";

// ---------------------------------------------------------------------------
// 1. parseRoadmapPhases -- extract PipelinePhase[] from ROADMAP.md content
// ---------------------------------------------------------------------------

/**
 * Parse ROADMAP.md content to extract phase entries.
 *
 * Looks for `### Phase N:` headers and extracts:
 * - Phase number and name
 * - "Depends on" field (phase numbers or "Nothing")
 * - "Requirements" field (comma-separated IDs)
 * - Goal/description text
 *
 * @param roadmapContent - Full text content of ROADMAP.md
 * @returns Array of PipelinePhase objects
 */
export function parseRoadmapPhases(roadmapContent: string): PipelinePhase[] {
  const phases: PipelinePhase[] = [];

  // Split into lines for parsing
  const lines = roadmapContent.split("\n");

  // Phase header pattern: "### Phase N: Title"
  const phaseHeaderRe = /^###\s+Phase\s+(\d+):\s+(.+)$/;

  let i = 0;
  while (i < lines.length) {
    const headerMatch = lines[i].match(phaseHeaderRe);
    if (!headerMatch) {
      i++;
      continue;
    }

    const phaseNumber = parseInt(headerMatch[1], 10);
    const phaseName = headerMatch[2].trim();

    // Collect lines until the next phase header or end of file
    const blockLines: string[] = [];
    i++;
    while (i < lines.length && !phaseHeaderRe.test(lines[i])) {
      blockLines.push(lines[i]);
      i++;
    }

    const block = blockLines.join("\n");

    // Extract "Depends on" field
    const dependsOn = parseDependsOn(block);

    // Extract "Requirements" field
    const requirementIds = parseRequirements(block);

    // Extract "Goal" as description
    const description = parseGoal(block);

    phases.push({
      number: phaseNumber,
      name: phaseName,
      dependsOn,
      requirementIds,
      description,
    });
  }

  return phases;
}

/**
 * Parse the "Depends on" field from a phase block.
 *
 * Matches patterns like:
 * - "**Depends on**: Nothing"
 * - "**Depends on**: Phase 1"
 * - "**Depends on**: Phase 5"
 *
 * Returns array of phase numbers.
 */
function parseDependsOn(block: string): number[] {
  const dependsOnRe = /\*\*Depends on\*\*:\s*(.+)/i;
  const match = block.match(dependsOnRe);
  if (!match) return [];

  const value = match[1].trim();

  // "Nothing" or "None" means no dependencies
  if (/^(nothing|none)/i.test(value)) return [];

  // Extract all "Phase N" references
  const phaseRefs: number[] = [];
  const phaseRefRe = /Phase\s+(\d+)/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = phaseRefRe.exec(value)) !== null) {
    phaseRefs.push(parseInt(refMatch[1], 10));
  }

  return phaseRefs;
}

/**
 * Parse the "Requirements" field from a phase block.
 *
 * Matches pattern: "**Requirements**: ID-01, ID-02, ..."
 */
function parseRequirements(block: string): string[] {
  const reqRe = /\*\*Requirements\*\*:\s*(.+)/i;
  const match = block.match(reqRe);
  if (!match) return [];

  return match[1]
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Parse the "Goal" field from a phase block as description.
 *
 * Matches pattern: "**Goal**: ..."
 */
function parseGoal(block: string): string {
  const goalRe = /\*\*Goal\*\*:\s*(.+)/i;
  const match = block.match(goalRe);
  return match ? match[1].trim() : "";
}

// ---------------------------------------------------------------------------
// 2. buildDependencyGraph -- adjacency list from PipelinePhase[]
// ---------------------------------------------------------------------------

/**
 * Build an adjacency list representing the dependency graph.
 *
 * Key = phase number, value = set of phase numbers it depends on.
 *
 * Validates:
 * - No self-dependencies
 * - No circular dependencies (via DFS with visited/recursion-stack)
 *
 * @param phases - Array of PipelinePhase objects
 * @returns Map where key is phase number and value is set of dependency phase numbers
 * @throws Error on self-dependency or circular dependency
 */
export function buildDependencyGraph(
  phases: PipelinePhase[],
): Map<number, Set<number>> {
  const graph = new Map<number, Set<number>>();

  // Initialize all nodes
  for (const phase of phases) {
    graph.set(phase.number, new Set<number>());
  }

  // Add edges
  for (const phase of phases) {
    for (const dep of phase.dependsOn) {
      // Validate no self-dependency
      if (dep === phase.number) {
        throw new Error(
          `Self-dependency detected: Phase ${phase.number} depends on itself`,
        );
      }
      graph.get(phase.number)!.add(dep);
    }
  }

  // Detect circular dependencies via DFS
  detectCycles(graph);

  return graph;
}

/**
 * Detect circular dependencies in the graph using DFS with three-color marking.
 *
 * - WHITE (unvisited): not yet processed
 * - GRAY (in recursion stack): currently being processed
 * - BLACK (completed): fully processed
 *
 * If we encounter a GRAY node, we have a cycle.
 *
 * @throws Error on circular dependency detection
 */
function detectCycles(graph: Map<number, Set<number>>): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<number, number>();
  for (const node of graph.keys()) {
    color.set(node, WHITE);
  }

  function dfs(node: number, path: number[]): void {
    color.set(node, GRAY);
    path.push(node);

    const deps = graph.get(node);
    if (deps) {
      for (const dep of deps) {
        const depColor = color.get(dep);
        if (depColor === GRAY) {
          // Found a cycle -- build the cycle path for the error message
          const cycleStart = path.indexOf(dep);
          const cycle = path.slice(cycleStart).concat(dep);
          throw new Error(
            `Circular dependency detected: ${cycle.map((n) => `Phase ${n}`).join(" -> ")}`,
          );
        }
        if (depColor === WHITE) {
          dfs(dep, path);
        }
      }
    }

    color.set(node, BLACK);
    path.pop();
  }

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE) {
      dfs(node, []);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. topologicalSort -- Kahn's algorithm producing execution waves
// ---------------------------------------------------------------------------

/**
 * Produce execution waves via a modified Kahn's algorithm (topological sort).
 *
 * Returns array of arrays where each inner array is a "wave" of independent
 * phases that can execute concurrently:
 * - Wave 1: phases with no dependencies
 * - Wave 2: phases whose dependencies are all in wave 1
 * - Wave N: phases whose dependencies are all in earlier waves
 *
 * @param graph - Dependency graph from buildDependencyGraph()
 * @returns Array of waves, where each wave is an array of phase numbers
 * @throws Error if graph has unresolvable dependencies (shouldn't happen if cycle detection passed)
 */
export function topologicalSort(
  graph: Map<number, Set<number>>,
): number[][] {
  if (graph.size === 0) return [];

  const waves: number[][] = [];
  const resolved = new Set<number>();

  // Track in-degree for each node (number of unresolved dependencies)
  const remaining = new Map<number, Set<number>>();
  for (const [node, deps] of graph) {
    remaining.set(node, new Set(deps));
  }

  let totalResolved = 0;

  while (totalResolved < graph.size) {
    // Find all nodes whose dependencies are fully resolved
    const wave: number[] = [];
    for (const [node, deps] of remaining) {
      if (resolved.has(node)) continue;

      // Check if all deps are resolved
      let allResolved = true;
      for (const dep of deps) {
        if (!resolved.has(dep)) {
          allResolved = false;
          break;
        }
      }

      if (allResolved) {
        wave.push(node);
      }
    }

    if (wave.length === 0) {
      // Should not happen if cycle detection is correct
      const unresolved = [...remaining.keys()].filter(
        (n) => !resolved.has(n),
      );
      throw new Error(
        `Unable to resolve dependencies for phases: ${unresolved.join(", ")}`,
      );
    }

    // Sort wave for deterministic output
    wave.sort((a, b) => a - b);
    waves.push(wave);

    // Mark this wave as resolved
    for (const node of wave) {
      resolved.add(node);
      totalResolved++;
    }
  }

  return waves;
}

// ---------------------------------------------------------------------------
// 4. getExecutionWaves -- convenience: parse -> build graph -> toposort
// ---------------------------------------------------------------------------

/**
 * Convenience function that chains the full pipeline:
 * 1. Parse roadmap content to extract phases
 * 2. Build dependency graph
 * 3. Topological sort to get execution waves
 *
 * @param roadmapContent - Full text content of ROADMAP.md
 * @returns Object with execution waves and parsed phases
 */
export function getExecutionWaves(roadmapContent: string): {
  waves: number[][];
  phases: PipelinePhase[];
} {
  const phases = parseRoadmapPhases(roadmapContent);
  if (phases.length === 0) {
    return { waves: [], phases: [] };
  }

  const graph = buildDependencyGraph(phases);
  const waves = topologicalSort(graph);

  return { waves, phases };
}
