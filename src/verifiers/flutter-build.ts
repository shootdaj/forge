/**
 * Flutter Build Verifier (FV-04)
 *
 * Runs flutter build apk --debug and confirms APK artifact exists.
 * Self-skips when pubspec.yaml is absent.
 * Acquires Flutter startup lock before running.
 * Respects config.testing.flutterBuildFlavor if set.
 *
 * Requirement: FV-04, FV-05, FV-06
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";
import { withFlutterLock } from "./flutter-lock.js";

/**
 * Verify that Flutter APK build succeeds and produces an artifact.
 *
 * Runs `flutter build apk --debug` (with optional --flavor flag).
 * After successful exit, verifies the APK file exists at the expected path.
 * Skips if pubspec.yaml is not found (not a Flutter project).
 *
 * @param config - Verifier configuration with cwd and forgeConfig
 * @returns VerifierResult indicating pass, fail, or skip
 */
export const flutterBuildVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const pubspecPath = path.resolve(config.cwd, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) {
    return skippedResult("flutter-build", "No pubspec.yaml found");
  }

  const flavor = config.forgeConfig.testing.flutterBuildFlavor;
  const flavorArg = flavor ? ` --flavor ${flavor}` : "";
  const command = `flutter build apk --debug${flavorArg}`;

  const result = await withFlutterLock(() =>
    execWithTimeout(command, config.cwd, 300_000),
  );

  if (result.exitCode !== 0) {
    return {
      passed: false,
      verifier: "flutter-build",
      details: [`flutter build apk failed with exit code ${result.exitCode}`],
      errors: parseBuildErrors(result.stderr || result.stdout),
    };
  }

  // Verify APK artifact exists
  const apkPath = path.resolve(config.cwd, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
  let apkExists = fs.existsSync(apkPath);

  if (!apkExists && flavor) {
    // Try alternate location with flavor
    const altApkPath = path.resolve(
      config.cwd, "build", "app", "outputs", "flutter-apk", `app-${flavor}-debug.apk`,
    );
    apkExists = fs.existsSync(altApkPath);
  }

  if (!apkExists) {
    return {
      passed: false,
      verifier: "flutter-build",
      details: ["flutter build apk succeeded but APK artifact not found"],
      errors: [`Expected APK at: ${apkPath}`],
    };
  }

  return {
    passed: true,
    verifier: "flutter-build",
    details: ["flutter build apk --debug succeeded, APK artifact verified"],
    errors: [],
  };
};

function parseBuildErrors(output: string): string[] {
  if (!output.trim()) return ["flutter build apk failed (no output)"];

  // Extract Gradle/build errors
  const errors = output.split("\n").filter(
    (line) => line.includes("ERROR") || line.includes("FAILURE") || line.includes("error:"),
  );

  return errors.length > 0
    ? errors.slice(0, 20)
    : output.trim().split("\n").slice(0, 20);
}
