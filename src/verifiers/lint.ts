/**
 * Lint Verifier (VER-04)
 *
 * Runs the project's lint command. Auto-detects the lint tool if not configured.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";

/**
 * Detect the lint command for the project.
 * Checks package.json scripts, then looks for common lint configs.
 */
function detectLintCommand(cwd: string): string | null {
  // Check package.json for a lint script
  try {
    const pkgPath = path.resolve(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.lint) return "npm run lint";
    }
  } catch {
    // ignore parse errors
  }

  // Check for common lint configs
  const eslintConfigs = [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs"];
  for (const config of eslintConfigs) {
    if (fs.existsSync(path.resolve(cwd, config))) {
      return "npx eslint . --no-color";
    }
  }

  // Check for biome
  if (fs.existsSync(path.resolve(cwd, "biome.json"))) {
    return "npx biome check .";
  }

  return null;
}

/**
 * Verify that the project passes linting.
 *
 * Requirement: VER-04
 */
export const lintVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const lintCommand = detectLintCommand(config.cwd);

  if (!lintCommand) {
    return skippedResult("lint", "No lint configuration found");
  }

  const result = await execWithTimeout(lintCommand, config.cwd, 30_000);

  const passed = result.exitCode === 0;
  const combinedOutput = (result.stdout + "\n" + result.stderr).trim();

  return {
    passed,
    verifier: "lint",
    details: [`Lint check (${lintCommand}): ${passed ? "passed" : "failed"}`],
    errors: passed
      ? []
      : combinedOutput
          .split("\n")
          .slice(0, 50)
          .filter((line) => line.trim().length > 0),
  };
};
