/**
 * UAT Module Public API
 *
 * Re-exports all types and functions for the UAT runner,
 * emulator lifecycle, and KVM pre-flight check.
 *
 * Requirements: UAT-01 through UAT-06, EMU-01 through EMU-06
 */

// Types
export type {
  AppType,
  UATWorkflow,
  WorkflowResult,
  UATResult,
  UATContext,
  SafetyConfig,
} from "./types.js";

// Emulator types and errors
export type {
  EmulatorHandle,
  EmulatorStartOptions,
  BootWaitOptions,
  KvmCheckResult,
} from "./emulator-types.js";
export {
  EmulatorError,
  EmulatorBootTimeoutError,
  KvmUnavailableError,
  EmulatorStartError,
} from "./emulator-types.js";

// Workflow extraction and gap closure
export {
  extractUserWorkflows,
  buildSafetyPrompt,
  runUATGapClosure,
} from "./workflows.js";

// Runner functions
export {
  detectAppType,
  startApplication,
  stopApplication,
  waitForHealth,
  buildUATPrompt,
  verifyUATResults,
  runUAT,
} from "./runner.js";

// Emulator lifecycle
export {
  startEmulator,
  waitForBoot,
  stopEmulator,
  withEmulator,
  registerCleanupHandler,
  killOrphanEmulators,
  persistEmulatorState,
  clearEmulatorState,
  listEmulatorSerials,
} from "./emulator.js";

// KVM pre-flight
export { checkKvmAvailability, assertKvmAvailable } from "./kvm-check.js";

// Flutter run daemon types and errors
export type {
  FlutterRunHandle,
  FlutterRunOptions,
  FlutterRunWaitOptions,
} from "./flutter-run-types.js";
export {
  FlutterRunError,
  FlutterRunReadyTimeoutError,
  FlutterRunStartError,
} from "./flutter-run-types.js";

// Flutter run daemon lifecycle
export {
  startFlutterRun,
  waitForFlutterRunReady,
  stopFlutterRun,
  registerFlutterRunCleanup,
  withFlutterRun,
} from "./flutter-run.js";

// Maestro types and errors
export type {
  MaestroFlowResult,
  MaestroResult,
  MaestroTestOptions,
} from "./maestro-types.js";
export {
  MaestroError,
  MaestroTestError,
} from "./maestro-types.js";

// Maestro test execution
export {
  runMaestroTest,
  parseMaestroJUnit,
  reconcileResult,
  executeMaestroUAT,
  maestroResultToWorkflowResults,
} from "./maestro.js";
