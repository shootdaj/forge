/**
 * Pipeline Controller Module - Public API
 *
 * Exposes the dependency graph, mock manager, human checkpoint,
 * spec compliance, prompt builders, and all pipeline types
 * needed by consumers (CLI, tests).
 *
 * Requirements: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06,
 *               PIPE-07, PIPE-08, PIPE-09, PIPE-10, PIPE-11,
 *               MOCK-01, MOCK-02, MOCK-03, MOCK-04
 */

export { runPipeline, didMakeProgress } from "./pipeline-controller.js";

export {
  buildDependencyGraph,
  topologicalSort,
  getExecutionWaves,
  parseRoadmapPhases,
} from "./dependency-graph.js";

export { MockManager } from "./mock-manager.js";

export {
  generateCheckpointReport,
  formatCheckpointDisplay,
  writeCheckpointFile,
  loadResumeData,
  needsHumanCheckpoint,
} from "./human-checkpoint.js";

export {
  runSpecComplianceLoop,
  checkConvergence,
  verifyRequirement,
  verifyRequirementsBatch,
} from "./spec-compliance.js";

export {
  buildNewProjectPrompt,
  buildScaffoldPrompt,
  buildIntegrationPrompt,
  buildSkippedItemPrompt,
  buildComplianceGapPrompt,
  buildBatchGapFixPrompt,
} from "./prompts.js";

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
