/**
 * Flutter Pub Get Verifier (FV-01)
 *
 * Checks that Flutter dependency resolution succeeds.
 * Self-skips when pubspec.yaml is absent.
 * Acquires Flutter startup lock before running.
 *
 * Requirement: FV-01, FV-05, FV-06
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";
import { withFlutterLock } from "./flutter-lock.js";

/**
 * Verify that Flutter dependency resolution succeeds.
 *
 * Runs `flutter pub get` in the project directory.
 * Skips if pubspec.yaml is not found (not a Flutter project).
 * Uses the Flutter startup lock to prevent concurrent CLI calls.
 *
 * @param config - Verifier configuration with cwd and forgeConfig
 * @returns VerifierResult indicating pass, fail, or skip
 */
export const flutterPubGetVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const pubspecPath = path.resolve(config.cwd, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) {
    return skippedResult("flutter-pub-get", "No pubspec.yaml found");
  }

  const result = await withFlutterLock(() =>
    execWithTimeout("flutter pub get", config.cwd, 120_000),
  );

  if (result.exitCode === 0) {
    return {
      passed: true,
      verifier: "flutter-pub-get",
      details: ["flutter pub get succeeded"],
      errors: [],
    };
  }

  return {
    passed: false,
    verifier: "flutter-pub-get",
    details: [`flutter pub get failed with exit code ${result.exitCode}`],
    errors: parseErrors(result.stderr || result.stdout),
  };
};

function parseErrors(output: string): string[] {
  if (!output.trim()) return ["flutter pub get failed (no output)"];
  return output.trim().split("\n").slice(0, 20);
}
