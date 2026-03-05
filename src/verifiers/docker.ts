/**
 * Docker Verifier (VER-07)
 *
 * Runs docker compose smoke test with proper cleanup in finally block.
 * Skips if no compose file is found.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";

/**
 * Verify that docker compose services start and pass health checks.
 *
 * Behavior:
 * - Check for compose file (from config or default docker-compose.test.yml)
 * - Skip if compose file doesn't exist
 * - Run docker compose up --wait with 120s timeout
 * - Always run docker compose down in finally block
 * - Pass when up --wait exits 0
 *
 * Requirement: VER-07
 */
export const dockerVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const composeFile =
    config.forgeConfig.testing.dockerComposeFile ?? "docker-compose.test.yml";
  const composePath = path.resolve(config.cwd, composeFile);

  if (!fs.existsSync(composePath)) {
    return skippedResult("docker", `No ${composeFile} found`);
  }

  let upResult;
  try {
    upResult = await execWithTimeout(
      `docker compose -f ${composeFile} up --wait`,
      config.cwd,
      120_000,
    );
  } finally {
    // Always clean up containers — even if up failed or timed out
    await execWithTimeout(
      `docker compose -f ${composeFile} down --volumes --remove-orphans`,
      config.cwd,
      30_000,
    );
  }

  const passed = upResult.exitCode === 0;

  return {
    passed,
    verifier: "docker",
    details: [`Docker compose smoke test: ${passed ? "passed" : "failed"}`],
    errors: passed
      ? []
      : [
          `docker compose up --wait failed with exit code ${upResult.exitCode}`,
          ...(upResult.stderr
            ? upResult.stderr.trim().split("\n").slice(0, 20)
            : []),
        ],
  };
};
