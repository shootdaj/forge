/**
 * Loader Global Config Integration Tests
 *
 * Tests that loadConfig merges global config (~/.forge/config.json)
 * as a base layer under project config (forge.config.json).
 *
 * Requirements: CFG-01
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { GlobalConfigRaw } from "./global.js";

let tmpDir: string;
let projectDir: string;

// Mock loadGlobalConfig to return controlled values
let mockGlobalConfig: GlobalConfigRaw = { notion: { parent_page_id: "" }, model: "" };

vi.mock("./global.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./global.js")>();
  return {
    ...original,
    loadGlobalConfig: () => mockGlobalConfig,
  };
});

// Import after mock setup
const { loadConfig } = await import("./loader.js");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-loader-global-"));
  projectDir = path.join(tmpDir, "project");
  fs.mkdirSync(projectDir, { recursive: true });
  mockGlobalConfig = { notion: { parent_page_id: "" }, model: "" };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig with global config", () => {
  it("TestLoader_InheritsNotionFromGlobal_WhenProjectHasNone", () => {
    mockGlobalConfig = { notion: { parent_page_id: "global-page-123" }, model: "" };

    fs.writeFileSync(
      path.join(projectDir, "forge.config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6" }),
      "utf-8",
    );

    const config = loadConfig(projectDir);
    expect(config.notion.parentPageId).toBe("global-page-123");
    expect(config.model).toBe("claude-sonnet-4-6");
  });

  it("TestLoader_ProjectNotionOverridesGlobal", () => {
    mockGlobalConfig = { notion: { parent_page_id: "global-page" }, model: "" };

    fs.writeFileSync(
      path.join(projectDir, "forge.config.json"),
      JSON.stringify({ notion: { parent_page_id: "project-page" } }),
      "utf-8",
    );

    const config = loadConfig(projectDir);
    expect(config.notion.parentPageId).toBe("project-page");
  });

  it("TestLoader_InheritsModelFromGlobal_WhenProjectHasNone", () => {
    mockGlobalConfig = { notion: { parent_page_id: "" }, model: "claude-opus-4-6" };

    fs.writeFileSync(
      path.join(projectDir, "forge.config.json"),
      "{}",
      "utf-8",
    );

    const config = loadConfig(projectDir);
    expect(config.model).toBe("claude-opus-4-6");
  });

  it("TestLoader_ProjectModelOverridesGlobal", () => {
    mockGlobalConfig = { notion: { parent_page_id: "" }, model: "claude-opus-4-6" };

    fs.writeFileSync(
      path.join(projectDir, "forge.config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6" }),
      "utf-8",
    );

    const config = loadConfig(projectDir);
    expect(config.model).toBe("claude-sonnet-4-6");
  });

  it("TestLoader_WorksWithNoGlobalConfig", () => {
    mockGlobalConfig = { notion: { parent_page_id: "" }, model: "" };

    fs.writeFileSync(
      path.join(projectDir, "forge.config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6" }),
      "utf-8",
    );

    const config = loadConfig(projectDir);
    expect(config.model).toBe("claude-sonnet-4-6");
    expect(config.notion.parentPageId).toBe("");
  });

  it("TestLoader_NoProjectConfig_UsesGlobalValues", () => {
    mockGlobalConfig = { notion: { parent_page_id: "global-notion" }, model: "claude-opus-4-6" };

    // No project config file
    const config = loadConfig(projectDir);
    expect(config.notion.parentPageId).toBe("global-notion");
    expect(config.model).toBe("claude-opus-4-6");
  });
});
