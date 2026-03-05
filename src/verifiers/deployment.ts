/**
 * Deployment Verifier (VER-08)
 *
 * Checks Dockerfile existence and env var consistency between
 * .env.example and Dockerfile ENV/ARG declarations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";

/**
 * Verify deployment readiness.
 *
 * Behavior:
 * - Skip if no Dockerfile exists
 * - Check Dockerfile exists and is non-empty
 * - If .env.example exists, compare variable names against Dockerfile ENV/ARG declarations
 * - Env var warnings are informational (many vars are runtime-injected)
 * - Pass when Dockerfile exists (minimum bar)
 *
 * Requirement: VER-08
 */
export const deploymentVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const dockerfilePath = path.resolve(config.cwd, "Dockerfile");

  if (!fs.existsSync(dockerfilePath)) {
    return skippedResult("deployment", "No Dockerfile found");
  }

  const details: string[] = [];
  const dockerfileContent = fs.readFileSync(dockerfilePath, "utf-8");

  if (dockerfileContent.trim().length === 0) {
    return {
      passed: false,
      verifier: "deployment",
      details: ["Dockerfile exists but is empty"],
      errors: ["Dockerfile is empty"],
    };
  }

  details.push("Dockerfile: EXISTS (non-empty)");

  // Check env var consistency if .env.example exists
  const envExamplePath = path.resolve(config.cwd, ".env.example");
  if (fs.existsSync(envExamplePath)) {
    const envContent = fs.readFileSync(envExamplePath, "utf-8");
    const envVars = parseEnvVarNames(envContent);
    const dockerVars = parseDockerfileVars(dockerfileContent);

    const missingInDocker = envVars.filter(
      (v) => !dockerVars.includes(v),
    );

    if (missingInDocker.length === 0) {
      details.push(
        `Env var consistency: ${envVars.length} vars in .env.example, all declared in Dockerfile`,
      );
    } else {
      details.push(
        `Env var consistency: ${missingInDocker.length} of ${envVars.length} vars from .env.example not found in Dockerfile ENV/ARG (may be runtime-injected)`,
      );
      details.push(`Missing in Dockerfile: ${missingInDocker.join(", ")}`);
    }
  } else {
    details.push("No .env.example found (env var consistency check skipped)");
  }

  // Dockerfile exists = minimum bar for deployment readiness
  return {
    passed: true,
    verifier: "deployment",
    details,
    errors: [],
  };
};

/**
 * Parse environment variable names from .env.example content.
 * Ignores comments and blank lines.
 */
function parseEnvVarNames(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=")[0].trim())
    .filter((name) => name.length > 0);
}

/**
 * Parse ENV and ARG variable names from Dockerfile content.
 */
function parseDockerfileVars(content: string): string[] {
  const vars: string[] = [];

  // Match ENV VAR_NAME=value or ENV VAR_NAME value
  const envPattern = /^ENV\s+(\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = envPattern.exec(content)) !== null) {
    vars.push(match[1]);
  }

  // Match ARG VAR_NAME or ARG VAR_NAME=default
  const argPattern = /^ARG\s+(\w+)/gm;
  while ((match = argPattern.exec(content)) !== null) {
    vars.push(match[1]);
  }

  return vars;
}
