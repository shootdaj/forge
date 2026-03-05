/**
 * Pipeline Controller Module - Public API
 *
 * Exposes the dependency graph, mock manager, and all pipeline types
 * needed by consumers (CLI, tests).
 *
 * Requirements: PIPE-11, PIPE-02, PIPE-03, MOCK-01, MOCK-02, MOCK-03, MOCK-04
 */

export {
  buildDependencyGraph,
  topologicalSort,
  getExecutionWaves,
  parseRoadmapPhases,
} from "./dependency-graph.js";

export { MockManager } from "./mock-manager.js";

export type {
  PipelineContext,
  PipelineResult,
  PipelinePhase,
  MockEntry,
  ServiceDetection,
  CheckpointReport,
  SpecComplianceResult,
  WaveResult,
  SkippedItem,
} from "./types.js";
