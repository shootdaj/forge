/**
 * Flutter iOS Build Verifier (IOS-02)
 *
 * Runs flutter build ios --debug --no-codesign --simulator and confirms
 * .app bundle exists. Self-skips when pubspec.yaml is absent or not on macOS.
 * Acquires Flutter startup lock before running.
 * Respects config.testing.flutterBuildFlavor if set.
 *
 * Requirement: IOS-02
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";
import { withFlutterLock } from "./flutter-lock.js";

/**
 * Verify that Flutter iOS Simulator build succeeds and produces an artifact.
 *
 * Runs `flutter build ios --debug --no-codesign --simulator` (with optional --flavor flag).
 * After successful exit, verifies the .app bundle exists at the expected path.
 * Skips if pubspec.yaml is not found (not a Flutter project).
 * Skips if not running on macOS (iOS builds require Xcode).
 *
 * @param config - Verifier configuration with cwd and forgeConfig
 * @returns VerifierResult indicating pass, fail, or skip
 */
export const flutterBuildIosVerifier: Verifier = async (
  config,
): Promise<VerifierResult> => {
  // Skip on non-macOS platforms
  if (process.platform !== "darwin") {
    return skippedResult(
      "flutter-build-ios",
      "iOS builds only supported on macOS",
    );
  }

  const pubspecPath = path.resolve(config.cwd, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) {
    return skippedResult("flutter-build-ios", "No pubspec.yaml found");
  }

  const flavor = config.forgeConfig.testing.flutterBuildFlavor;
  const flavorArg = flavor ? ` --flavor ${flavor}` : "";
  const command = `flutter build ios --debug --no-codesign --simulator${flavorArg}`;

  const result = await withFlutterLock(() =>
    execWithTimeout(command, config.cwd, 600_000),
  );

  if (result.exitCode !== 0) {
    return {
      passed: false,
      verifier: "flutter-build-ios",
      details: [
        `flutter build ios --no-codesign failed with exit code ${result.exitCode}`,
      ],
      errors: parseBuildErrors(result.stderr || result.stdout),
    };
  }

  // Verify .app bundle exists
  const appPath = path.resolve(
    config.cwd,
    "build",
    "ios",
    "iphonesimulator",
    "Runner.app",
  );
  let appExists = fs.existsSync(appPath);

  if (!appExists && flavor) {
    // Try alternate location with flavor
    const altAppPath = path.resolve(
      config.cwd,
      "build",
      "ios",
      "iphonesimulator",
      `Runner-${flavor}.app`,
    );
    appExists = fs.existsSync(altAppPath);
  }

  if (!appExists) {
    return {
      passed: false,
      verifier: "flutter-build-ios",
      details: [
        "flutter build ios succeeded but .app bundle not found",
      ],
      errors: [`Expected .app at: ${appPath}`],
    };
  }

  return {
    passed: true,
    verifier: "flutter-build-ios",
    details: [
      "flutter build ios --debug --no-codesign --simulator succeeded, .app bundle verified",
    ],
    errors: [],
  };
};

function parseBuildErrors(output: string): string[] {
  if (!output.trim()) return ["flutter build ios failed (no output)"];

  // Extract Xcode/build errors
  const errors = output.split("\n").filter(
    (line) =>
      line.includes("ERROR") ||
      line.includes("FAILURE") ||
      line.includes("error:") ||
      line.includes("Build Failed"),
  );

  return errors.length > 0
    ? errors.slice(0, 20)
    : output.trim().split("\n").slice(0, 20);
}
