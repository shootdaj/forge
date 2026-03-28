/**
 * Flutter Pub Get Verifier Unit Tests (FV-01, FV-05)
 *
 * Tests that the verifier correctly runs flutter pub get,
 * reports pass/fail, and self-skips when pubspec.yaml is absent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { VerifierConfig } from "./types.js";
import { getDefaultConfig } from "../config/index.js";

vi.mock("./utils.js", () => ({
  execWithTimeout: vi.fn(),
}));

vi.mock("./flutter-lock.js", () => ({
  withFlutterLock: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: vi.fn() };
});

import { execWithTimeout } from "./utils.js";
import { flutterPubGetVerifier } from "./flutter-pub-get.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return { cwd: "/project", forgeConfig: getDefaultConfig(), ...overrides };
}

describe("Flutter Pub Get Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TestFlutterPubGet_SkipsWhenNoPubspec", async () => {
    mockedExistsSync.mockReturnValue(false);
    const result = await flutterPubGetVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.verifier).toBe("flutter-pub-get");
    expect(result.details[0]).toContain("Skipped");
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("TestFlutterPubGet_PassesOnSuccess", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({
      stdout: "Resolving dependencies...\nGot dependencies!",
      stderr: "",
      exitCode: 0,
    });
    const result = await flutterPubGetVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.verifier).toBe("flutter-pub-get");
    expect(result.details[0]).toContain("succeeded");
  });

  it("TestFlutterPubGet_FailsOnNonZeroExit", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({
      stdout: "",
      stderr: "Could not find package foo at https://pub.dev.",
      exitCode: 1,
    });
    const result = await flutterPubGetVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.verifier).toBe("flutter-pub-get");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("foo");
  });

  it("TestFlutterPubGet_HandlesEmptyStderr", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
    const result = await flutterPubGetVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("no output");
  });

  it("TestFlutterPubGet_Uses120sTimeout", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await flutterPubGetVerifier(makeConfig());
    expect(mockedExec).toHaveBeenCalledWith(
      "flutter pub get",
      "/project",
      120_000,
    );
  });
});
