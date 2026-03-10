/**
 * Design Selection Tests
 *
 * Unit tests for design option parsing and GUI detection.
 */

import { describe, it, expect } from "vitest";
import { detectGuiApp } from "./design.js";

describe("detectGuiApp", () => {
  it("detects GUI app from UX category requirements", () => {
    const req = "## R5: User Profile Page\nCategory: UX\nDescription: User profile with navigation and form";
    expect(detectGuiApp(req)).toBe(true);
  });

  it("detects GUI app from dashboard mention", () => {
    const req = "## R1: Main Dashboard\n**Category:** Core\n**Description:** Build the main dashboard with charts";
    expect(detectGuiApp(req)).toBe(true);
  });

  it("detects GUI app from frontend keyword", () => {
    const req = "The frontend should display a list of items";
    expect(detectGuiApp(req)).toBe(true);
  });

  it("detects GUI app from responsive design mention", () => {
    const req = "Must be responsive across mobile and desktop";
    expect(detectGuiApp(req)).toBe(true);
  });

  it("detects GUI app from chart mention", () => {
    const req = "Display a pie chart showing spending by category";
    expect(detectGuiApp(req)).toBe(true);
  });

  it("returns false for CLI-only app", () => {
    const req = "## R1: CLI Parser\n**Category:** Core\n**Description:** Parse command-line arguments";
    expect(detectGuiApp(req)).toBe(false);
  });

  it("returns false for API-only app", () => {
    const req = "## R1: REST API\n**Category:** Core\n**Description:** Expose CRUD endpoints for users";
    expect(detectGuiApp(req)).toBe(false);
  });

  it("detects WCAG accessibility requirement", () => {
    const req = "Must meet WCAG 2.1 AA compliance";
    expect(detectGuiApp(req)).toBe(true);
  });
});

describe("buildDesignPrompt", () => {
  it("includes design count in prompt", async () => {
    const { buildDesignPrompt } = await import("../prompts.js");
    const prompt = buildDesignPrompt(1, "Build a dashboard", 4);
    expect(prompt).toContain("4 distinct design concepts");
  });

  it("includes ui-ux-pro-max skill reference", async () => {
    const { buildDesignPrompt } = await import("../prompts.js");
    const prompt = buildDesignPrompt(1, "Build a dashboard", 3);
    expect(prompt).toContain("ui-ux-pro-max");
  });

  it("includes DESIGNS.md output instruction", async () => {
    const { buildDesignPrompt } = await import("../prompts.js");
    const prompt = buildDesignPrompt(1, "Build a dashboard", 3);
    expect(prompt).toContain("DESIGNS.md");
  });
});

describe("buildDesignExecutionSection", () => {
  it("includes the design content in execution section", async () => {
    const { buildDesignExecutionSection } = await import("../prompts.js");
    const section = buildDesignExecutionSection("## Minimal Dashboard\nClean, spacious layout");
    expect(section).toContain("Minimal Dashboard");
    expect(section).toContain("Clean, spacious layout");
    expect(section).toContain("Frontend Design Direction");
  });

  it("references ui-ux-pro-max skill", async () => {
    const { buildDesignExecutionSection } = await import("../prompts.js");
    const section = buildDesignExecutionSection("Some design");
    expect(section).toContain("ui-ux-pro-max");
  });
});
