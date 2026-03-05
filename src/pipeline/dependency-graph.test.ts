/**
 * Dependency Graph Unit Tests
 *
 * Tests for parsing ROADMAP.md, building dependency graphs,
 * and producing topological sort waves.
 *
 * Requirements: PIPE-11, PIPE-03
 */

import { describe, it, expect } from "vitest";
import {
  parseRoadmapPhases,
  buildDependencyGraph,
  topologicalSort,
  getExecutionWaves,
} from "./dependency-graph.js";
import type { PipelinePhase } from "./types.js";

// ---------------------------------------------------------------------------
// Sample roadmap content matching the actual Forge ROADMAP.md format
// ---------------------------------------------------------------------------

const SAMPLE_ROADMAP = `# Roadmap: TestProject

## Phases

- [ ] **Phase 1: Foundation** - Set up the basics
- [ ] **Phase 2: Core Features** - Build core features
- [ ] **Phase 3: Integration** - Integrate services
- [ ] **Phase 4: Polish** - Polish and finalize

## Phase Details

### Phase 1: Foundation
**Goal**: Set up project structure, config loading, and database
**Depends on**: Nothing
**Requirements**: CFG-01, CFG-02, STA-01
**Success Criteria** (what must be TRUE):
  1. Config loads from file
  2. State persists to disk

Plans:
- [ ] 01-01: Config and state

### Phase 2: Core Features
**Goal**: Build the main application features
**Depends on**: Phase 1
**Requirements**: FEAT-01, FEAT-02, FEAT-03
**Success Criteria** (what must be TRUE):
  1. API endpoints work
  2. Auth is functional

Plans:
- [ ] 02-01: API endpoints
- [ ] 02-02: Auth

### Phase 3: Integration
**Goal**: Integrate payment processing with Stripe and email with SendGrid
**Depends on**: Phase 1
**Requirements**: INT-01, INT-02
**Success Criteria** (what must be TRUE):
  1. Stripe payments work
  2. Emails send correctly

Plans:
- [ ] 03-01: Stripe integration
- [ ] 03-02: Email integration

### Phase 4: Polish
**Goal**: Polish the UI and add final touches
**Depends on**: Phase 2
**Requirements**: POL-01, POL-02
**Success Criteria** (what must be TRUE):
  1. UI is polished
  2. Performance is acceptable

Plans:
- [ ] 04-01: UI polish
`;

// ---------------------------------------------------------------------------
// Forge's actual ROADMAP.md dependency pattern
// ---------------------------------------------------------------------------

const FORGE_ROADMAP = `# Roadmap: Forge

## Phase Details

### Phase 1: SDK Proof of Concept
**Goal**: Validate Agent SDK API surface
**Depends on**: Nothing (first phase)
**Requirements**: SDK-01, SDK-02, SDK-03, SDK-04, SDK-05

### Phase 2: Foundation (Config + State)
**Goal**: Project config loading and crash-safe state persistence
**Depends on**: Phase 1
**Requirements**: CFG-01, CFG-02, CFG-03, STA-01, STA-02, STA-03, STA-04, STA-05

### Phase 3: Step Runner + Cost Controller
**Goal**: Core primitive wrapping query() with budget enforcement
**Depends on**: Phase 2
**Requirements**: STEP-01, STEP-02, STEP-03, STEP-04, STEP-05, STEP-06, COST-01, COST-02, COST-03, COST-04

### Phase 4: Programmatic Verifiers
**Goal**: Deterministic code checks after every step
**Depends on**: Phase 3
**Requirements**: VER-01, VER-02, VER-03, VER-04, VER-05, VER-06, VER-07, VER-08, VER-09

### Phase 5: Phase Runner + Plan Verification + Gap Closure
**Goal**: Full phase lifecycle orchestration
**Depends on**: Phase 4
**Requirements**: PHA-01, PHA-02, PHA-03, PHA-04, PHA-05, PHA-06, PHA-07, PHA-08, PHA-09, PHA-10, PHA-11, PHA-12, GAP-01, GAP-02, GAP-03

### Phase 6: Pipeline Controller (Wave Model)
**Goal**: Wave model FSM with dependency graph and mock management
**Depends on**: Phase 5
**Requirements**: PIPE-01, PIPE-02, PIPE-03, MOCK-01, MOCK-02, MOCK-03, MOCK-04

### Phase 7: CLI + Git + Testing Infrastructure
**Goal**: User-facing commands and git workflow
**Depends on**: Phase 6
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05

### Phase 8: Enhancement Layer
**Goal**: Requirements gathering, UAT, and Notion docs
**Depends on**: Phase 7
**Requirements**: REQ-01, REQ-02, UAT-01, UAT-02
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseRoadmapPhases", () => {
  it("TestDependencyGraph_ParseRoadmapPhases", () => {
    const phases = parseRoadmapPhases(SAMPLE_ROADMAP);

    expect(phases).toHaveLength(4);

    // Phase 1
    expect(phases[0].number).toBe(1);
    expect(phases[0].name).toBe("Foundation");
    expect(phases[0].dependsOn).toEqual([]);
    expect(phases[0].requirementIds).toEqual(["CFG-01", "CFG-02", "STA-01"]);
    expect(phases[0].description).toContain("project structure");

    // Phase 2
    expect(phases[1].number).toBe(2);
    expect(phases[1].name).toBe("Core Features");
    expect(phases[1].dependsOn).toEqual([1]);
    expect(phases[1].requirementIds).toEqual([
      "FEAT-01",
      "FEAT-02",
      "FEAT-03",
    ]);

    // Phase 3 (parallel with Phase 2, both depend on Phase 1)
    expect(phases[2].number).toBe(3);
    expect(phases[2].name).toBe("Integration");
    expect(phases[2].dependsOn).toEqual([1]);
    expect(phases[2].requirementIds).toEqual(["INT-01", "INT-02"]);

    // Phase 4
    expect(phases[3].number).toBe(4);
    expect(phases[3].name).toBe("Polish");
    expect(phases[3].dependsOn).toEqual([2]);
  });

  it("TestDependencyGraph_ParseRoadmapPhases_ForgeRoadmap", () => {
    const phases = parseRoadmapPhases(FORGE_ROADMAP);

    expect(phases).toHaveLength(8);
    expect(phases[0].number).toBe(1);
    expect(phases[0].dependsOn).toEqual([]);
    expect(phases[7].number).toBe(8);
    expect(phases[7].dependsOn).toEqual([7]);
  });
});

describe("buildDependencyGraph", () => {
  it("TestDependencyGraph_BuildsCorrectAdjacencyList", () => {
    const phases = parseRoadmapPhases(SAMPLE_ROADMAP);
    const graph = buildDependencyGraph(phases);

    expect(graph.size).toBe(4);
    expect(graph.get(1)).toEqual(new Set());
    expect(graph.get(2)).toEqual(new Set([1]));
    expect(graph.get(3)).toEqual(new Set([1]));
    expect(graph.get(4)).toEqual(new Set([2]));
  });

  it("TestDependencyGraph_CircularDependencyThrows", () => {
    const phases: PipelinePhase[] = [
      {
        number: 1,
        name: "A",
        dependsOn: [2],
        requirementIds: [],
        description: "",
      },
      {
        number: 2,
        name: "B",
        dependsOn: [3],
        requirementIds: [],
        description: "",
      },
      {
        number: 3,
        name: "C",
        dependsOn: [1],
        requirementIds: [],
        description: "",
      },
    ];

    expect(() => buildDependencyGraph(phases)).toThrow(
      /circular dependency/i,
    );
  });

  it("TestDependencyGraph_SelfDependencyThrows", () => {
    const phases: PipelinePhase[] = [
      {
        number: 1,
        name: "SelfRef",
        dependsOn: [1],
        requirementIds: [],
        description: "",
      },
    ];

    expect(() => buildDependencyGraph(phases)).toThrow(
      /self-dependency/i,
    );
  });
});

describe("topologicalSort", () => {
  it("TestDependencyGraph_LinearChain", () => {
    // 1 -> 2 -> 3
    const graph = new Map<number, Set<number>>([
      [1, new Set<number>()],
      [2, new Set([1])],
      [3, new Set([2])],
    ]);

    const waves = topologicalSort(graph);
    expect(waves).toEqual([[1], [2], [3]]);
  });

  it("TestDependencyGraph_ParallelPhases", () => {
    // 2 and 3 both depend only on 1
    const graph = new Map<number, Set<number>>([
      [1, new Set<number>()],
      [2, new Set([1])],
      [3, new Set([1])],
    ]);

    const waves = topologicalSort(graph);
    expect(waves).toEqual([[1], [2, 3]]);
  });

  it("TestDependencyGraph_ComplexGraph", () => {
    // Forge-like pattern: linear chain 1->2->3->4->5->6->7->8
    const graph = new Map<number, Set<number>>([
      [1, new Set<number>()],
      [2, new Set([1])],
      [3, new Set([2])],
      [4, new Set([3])],
      [5, new Set([4])],
      [6, new Set([5])],
      [7, new Set([6])],
      [8, new Set([7])],
    ]);

    const waves = topologicalSort(graph);
    expect(waves).toEqual([[1], [2], [3], [4], [5], [6], [7], [8]]);
  });

  it("TestDependencyGraph_ComplexGraph_Diamond", () => {
    // Diamond: 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 4
    const graph = new Map<number, Set<number>>([
      [1, new Set<number>()],
      [2, new Set([1])],
      [3, new Set([1])],
      [4, new Set([2, 3])],
    ]);

    const waves = topologicalSort(graph);
    expect(waves).toEqual([[1], [2, 3], [4]]);
  });

  it("TestDependencyGraph_NoPhases", () => {
    const graph = new Map<number, Set<number>>();
    const waves = topologicalSort(graph);
    expect(waves).toEqual([]);
  });

  it("TestDependencyGraph_SinglePhase", () => {
    const graph = new Map<number, Set<number>>([[5, new Set<number>()]]);
    const waves = topologicalSort(graph);
    expect(waves).toEqual([[5]]);
  });

  it("TestDependencyGraph_MultipleRoots", () => {
    // Two independent roots
    const graph = new Map<number, Set<number>>([
      [1, new Set<number>()],
      [2, new Set<number>()],
      [3, new Set([1, 2])],
    ]);

    const waves = topologicalSort(graph);
    expect(waves).toEqual([[1, 2], [3]]);
  });
});

describe("getExecutionWaves", () => {
  it("TestDependencyGraph_GetExecutionWaves_SampleRoadmap", () => {
    const result = getExecutionWaves(SAMPLE_ROADMAP);

    expect(result.phases).toHaveLength(4);
    // Phase 1 has no deps -> wave 1
    // Phases 2, 3 both depend on 1 -> wave 2
    // Phase 4 depends on 2 -> wave 3
    expect(result.waves).toEqual([[1], [2, 3], [4]]);
  });

  it("TestDependencyGraph_GetExecutionWaves_ForgeRoadmap", () => {
    const result = getExecutionWaves(FORGE_ROADMAP);

    expect(result.phases).toHaveLength(8);
    // Forge is a linear chain: each phase depends on the previous
    expect(result.waves).toEqual([[1], [2], [3], [4], [5], [6], [7], [8]]);
  });

  it("TestDependencyGraph_GetExecutionWaves_EmptyInput", () => {
    const result = getExecutionWaves("# Empty Roadmap\n\nNo phases here.");
    expect(result.phases).toEqual([]);
    expect(result.waves).toEqual([]);
  });
});
