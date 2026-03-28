/**
 * Flutter Detection Scenario Test
 *
 * End-to-end scenario verifying that:
 * 1. Flutter projects are detected via pubspec.yaml
 * 2. Non-Flutter projects route to existing paths unchanged
 * 3. Safety guardrails include mobile-specific content for Flutter
 * 4. Config schema is backward compatible
 *
 * Requirements: DET-01, DET-02, SAF-01, SAF-02, CFG-04, CFG-05
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { detectAppType } from "../../src/uat/runner.js";
import { buildMobileSafetyBlock, buildSafetyPrompt } from "../../src/uat/workflows.js";
import { buildMobileContextPrompt } from "../../src/pipeline/prompts.js";
import { ForgeConfigSchema } from "../../src/config/schema.js";
import { getDefaultConfig } from "../../src/config/index.js";
import type { SafetyConfig } from "../../src/uat/types.js";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: vi.fn() };
});

const mockedExistsSync = vi.mocked(fs.existsSync);

const defaultSafetyConfig: SafetyConfig = {
  useSandboxCredentials: true,
  useLocalSmtp: true,
  useTestDb: true,
  envFile: ".env.test",
};

describe("TestFlutterDetectionScenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Scenario: Flutter project detected and routed", () => {
    it("Step 1: detects Flutter via pubspec.yaml", () => {
      mockedExistsSync.mockImplementation((p: fs.PathLike) => {
        return String(p).endsWith("pubspec.yaml");
      });
      const config = getDefaultConfig();
      const appType = detectAppType(config, "/my-flutter-app");
      expect(appType).toBe("flutter");
    });

    it("Step 2: detects Flutter via stack config", () => {
      mockedExistsSync.mockReturnValue(false);
      const config = getDefaultConfig();
      config.testing.stack = "flutter";
      const appType = detectAppType(config, "/some-project");
      expect(appType).toBe("flutter");
    });

    it("Step 3: pubspec.yaml takes priority over web stack", () => {
      mockedExistsSync.mockImplementation((p: fs.PathLike) => {
        return String(p).endsWith("pubspec.yaml");
      });
      const config = getDefaultConfig();
      config.testing.stack = "react"; // Would normally be web
      const appType = detectAppType(config, "/flutter-app");
      expect(appType).toBe("flutter");
    });

    it("Step 4: mobile context prompt includes Flutter guidance", () => {
      const prompt = buildMobileContextPrompt();
      expect(prompt).toContain("Flutter");
      expect(prompt).toContain("pubspec.yaml");
      expect(prompt).toContain("ValueKey");
      expect(prompt).toContain("debug keystore");
    });

    it("Step 5: mobile safety guardrails are comprehensive", () => {
      const block = buildMobileSafetyBlock();
      expect(block).toContain("camera");
      expect(block).toContain("Firebase");
      expect(block).toContain("debug keystore");
      expect(block).toContain("localhost");
    });

    it("Step 6: safety prompt includes mobile block for Flutter", () => {
      const prompt = buildSafetyPrompt(defaultSafetyConfig, "flutter");
      expect(prompt).toContain("Mobile Safety Guardrails");
      expect(prompt).toContain("NEVER use production"); // standard guardrail
      expect(prompt).toContain("debug keystore"); // mobile guardrail
    });
  });

  describe("Scenario: Non-Flutter project routes unchanged", () => {
    it("Step 1: web project still detected correctly", () => {
      mockedExistsSync.mockReturnValue(false);
      const config = getDefaultConfig();
      config.testing.stack = "react";
      const appType = detectAppType(config, "/web-project");
      expect(appType).toBe("web");
    });

    it("Step 2: API project still detected correctly", () => {
      mockedExistsSync.mockReturnValue(false);
      const config = getDefaultConfig();
      config.testing.stack = "express";
      const appType = detectAppType(config, "/api-project");
      expect(appType).toBe("api");
    });

    it("Step 3: CLI project still detected correctly", () => {
      mockedExistsSync.mockReturnValue(false);
      const config = getDefaultConfig();
      config.testing.stack = "node";
      const appType = detectAppType(config, "/cli-project");
      expect(appType).toBe("cli");
    });

    it("Step 4: safety prompt does NOT include mobile block for web", () => {
      const prompt = buildSafetyPrompt(defaultSafetyConfig, "web");
      expect(prompt).not.toContain("Mobile Safety Guardrails");
    });

    it("Step 5: safety prompt does NOT include mobile block for api", () => {
      const prompt = buildSafetyPrompt(defaultSafetyConfig, "api");
      expect(prompt).not.toContain("Mobile Safety Guardrails");
    });
  });

  describe("Scenario: Config schema backward compatible", () => {
    it("Step 1: empty config validates with Flutter defaults", () => {
      const config = ForgeConfigSchema.parse({});
      expect(config.testing.flutter_avd_name).toBe("");
      expect(config.testing.flutter_build_flavor).toBe("");
      expect(config.testing.maestro_flows_dir).toBe(".maestro");
      expect(config.verification.mobile_build).toBe(false);
      expect(config.verification.mobile_analyze).toBe(false);
    });

    it("Step 2: existing config without Flutter fields still validates", () => {
      const config = ForgeConfigSchema.parse({
        model: "claude-opus-4-6",
        testing: { stack: "node", unit_command: "npm test" },
        verification: { files: true, tests: true },
      });
      expect(config.verification.mobile_build).toBe(false);
      expect(config.testing.flutter_avd_name).toBe("");
    });

    it("Step 3: Flutter config fields are settable", () => {
      const config = ForgeConfigSchema.parse({
        testing: {
          flutter_avd_name: "Pixel_7_API_34",
          flutter_build_flavor: "staging",
          maestro_flows_dir: "e2e/flows",
        },
        verification: {
          mobile_build: true,
          mobile_analyze: true,
        },
      });
      expect(config.testing.flutter_avd_name).toBe("Pixel_7_API_34");
      expect(config.testing.flutter_build_flavor).toBe("staging");
      expect(config.testing.maestro_flows_dir).toBe("e2e/flows");
      expect(config.verification.mobile_build).toBe(true);
      expect(config.verification.mobile_analyze).toBe(true);
    });
  });
});
