/**
 * Deployment Module
 *
 * Exports the deployment orchestrator, health checker, and types.
 */

export { runDeployment, isWebApp, extractDeployedUrl, extractDeployFailure, extractSmokeTestResult } from "./deployer.js";
export { checkDeploymentHealth } from "./health-check.js";
export { buildDeployPrompt, buildDeployFixPrompt, buildSmokeTestPrompt } from "./prompts.js";
export type {
  DeploymentContext,
  DeploymentResult,
  DeployAttempt,
  DeployTarget,
  HealthCheckResult,
  SmokeTestResult,
  SmokeTestCheck,
} from "./types.js";
