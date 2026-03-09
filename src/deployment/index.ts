/**
 * Deployment Module
 *
 * Exports the deployment orchestrator, health checker, and types.
 */

export { runDeployment, isWebApp, extractDeployedUrl, extractDeployFailure } from "./deployer.js";
export { checkDeploymentHealth } from "./health-check.js";
export { buildDeployPrompt, buildDeployFixPrompt } from "./prompts.js";
export type {
  DeploymentContext,
  DeploymentResult,
  DeployAttempt,
  DeployTarget,
  HealthCheckResult,
} from "./types.js";
