/**
 * Global Config Unit Tests
 *
 * Tests for ~/.forge/config.json loading, saving, and merging.
 *
 * Requirements: CFG-01
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  GlobalConfigSchema,
  loadGlobalConfig,
  saveGlobalConfig,
  updateGlobalConfig,
  getGlobalConfigDir,
  getGlobalConfigPath,
} from "./global.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-global-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GlobalConfigSchema", () => {
  it("TestGlobalConfig_DefaultValues", () => {
    const result = GlobalConfigSchema.parse({});
    expect(result.notion.parent_page_id).toBe("");
    expect(result.model).toBe("");
  });

  it("TestGlobalConfig_ParsesValidConfig", () => {
    const result = GlobalConfigSchema.parse({
      notion: { parent_page_id: "abc-123" },
      model: "claude-sonnet-4-6",
    });
    expect(result.notion.parent_page_id).toBe("abc-123");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("TestGlobalConfig_ParsesPartialConfig", () => {
    const result = GlobalConfigSchema.parse({
      model: "claude-opus-4-6",
    });
    expect(result.notion.parent_page_id).toBe("");
    expect(result.model).toBe("claude-opus-4-6");
  });
});

describe("Global Config File Operations", () => {
  it("TestGlobalConfig_GetConfigDir", () => {
    const dir = getGlobalConfigDir(tmpDir);
    expect(dir).toBe(path.join(tmpDir, ".forge"));
  });

  it("TestGlobalConfig_GetConfigPath", () => {
    const configPath = getGlobalConfigPath(tmpDir);
    expect(configPath).toBe(path.join(tmpDir, ".forge", "config.json"));
  });

  it("TestGlobalConfig_LoadReturnsDefaults_WhenNoFile", () => {
    const config = loadGlobalConfig(tmpDir);
    expect(config.notion.parent_page_id).toBe("");
    expect(config.model).toBe("");
  });

  it("TestGlobalConfig_SaveAndLoad", () => {
    const config = GlobalConfigSchema.parse({
      notion: { parent_page_id: "page-123" },
      model: "claude-sonnet-4-6",
    });

    saveGlobalConfig(config, tmpDir);
    const loaded = loadGlobalConfig(tmpDir);

    expect(loaded.notion.parent_page_id).toBe("page-123");
    expect(loaded.model).toBe("claude-sonnet-4-6");
  });

  it("TestGlobalConfig_SaveCreatesDir", () => {
    const forgeDir = path.join(tmpDir, ".forge");
    expect(fs.existsSync(forgeDir)).toBe(false);

    saveGlobalConfig(GlobalConfigSchema.parse({}), tmpDir);

    expect(fs.existsSync(forgeDir)).toBe(true);
    expect(fs.existsSync(path.join(forgeDir, "config.json"))).toBe(true);
  });

  it("TestGlobalConfig_LoadReturnsDefaults_WhenCorruptFile", () => {
    const forgeDir = path.join(tmpDir, ".forge");
    fs.mkdirSync(forgeDir, { recursive: true });
    fs.writeFileSync(path.join(forgeDir, "config.json"), "not json!", "utf-8");

    const config = loadGlobalConfig(tmpDir);
    expect(config.notion.parent_page_id).toBe("");
    expect(config.model).toBe("");
  });
});

describe("Global Config Update", () => {
  it("TestGlobalConfig_UpdateMergesFields", () => {
    saveGlobalConfig(
      GlobalConfigSchema.parse({
        notion: { parent_page_id: "page-abc" },
      }),
      tmpDir,
    );

    const result = updateGlobalConfig({ model: "claude-opus-4-6" }, tmpDir);

    expect(result.model).toBe("claude-opus-4-6");
    expect(result.notion.parent_page_id).toBe("page-abc");
  });

  it("TestGlobalConfig_UpdateMergesNotion", () => {
    saveGlobalConfig(
      GlobalConfigSchema.parse({
        model: "claude-sonnet-4-6",
      }),
      tmpDir,
    );

    const result = updateGlobalConfig(
      { notion: { parent_page_id: "new-page-id" } },
      tmpDir,
    );

    expect(result.notion.parent_page_id).toBe("new-page-id");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("TestGlobalConfig_UpdateFromEmpty", () => {
    const result = updateGlobalConfig(
      {
        notion: { parent_page_id: "first-page" },
        model: "claude-opus-4-6",
      },
      tmpDir,
    );

    expect(result.notion.parent_page_id).toBe("first-page");
    expect(result.model).toBe("claude-opus-4-6");

    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.notion.parent_page_id).toBe("first-page");
  });
});
