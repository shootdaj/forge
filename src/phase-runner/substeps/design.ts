/**
 * Frontend Design Selection
 *
 * Used during `forge init` to generate multiple design options for GUI apps.
 * Presents options to the user and saves the selected design to .planning/DESIGN.md.
 * All subsequent phases read DESIGN.md and follow the chosen direction.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { buildDesignPrompt } from "../prompts.js";
import type { ForgeConfig } from "../../config/schema.js";
import type { QueryResult } from "../../sdk/types.js";
import { executeQuery } from "../../sdk/query-wrapper.js";

const DESIGN_FILE = "DESIGN.md";
const DESIGNS_FILE = "DESIGNS.md";

export interface DesignSelectionOptions {
  executeQueryFn?: typeof executeQuery;
}

/**
 * Run the interactive design selection flow during `forge init`.
 *
 * Flow:
 * 1. Ask user if they want design input for their GUI app
 * 2. If yes, generate N design options via agent
 * 3. Present options, let user pick or mix-match
 * 4. Save selected design to .planning/DESIGN.md
 *
 * @param config - Forge config (for model, frontend settings)
 * @param requirementsContent - The gathered requirements for context
 * @param options - Injectable dependencies
 * @returns true if a design was selected, false if skipped
 */
export async function runDesignSelection(
  config: ForgeConfig,
  requirementsContent: string,
  options?: DesignSelectionOptions,
): Promise<boolean> {
  const queryFn = options?.executeQueryFn ?? executeQuery;
  const designCount = config.frontend?.designOptionsCount ?? 3;

  // Check if design already selected
  const designPath = path.resolve(process.cwd(), ".planning", DESIGN_FILE);
  if (fs.existsSync(designPath)) {
    console.log("[forge] Design already selected (.planning/DESIGN.md exists).");
    return true;
  }

  // Ask user if they want to provide design input
  console.log("");
  console.log("=".repeat(60));
  console.log("FORGE — Frontend Design");
  console.log("=".repeat(60));
  console.log("");
  console.log("This project has a GUI. Would you like to choose a design direction?");
  console.log("Forge will generate several design concepts for you to pick from,");
  console.log("or you can mix-and-match elements from multiple designs.");
  console.log("");

  const wantsDesign = await promptUser("Generate design options? (y/n): ");
  if (wantsDesign.trim().toLowerCase() !== "y") {
    console.log("[forge] Skipping design selection — agent will decide the design.");
    return false;
  }

  // Generate design options
  console.log(`\n[forge] Generating ${designCount} design concepts...`);

  const designsDir = path.resolve(process.cwd(), ".planning");
  fs.mkdirSync(designsDir, { recursive: true });
  const designsPath = path.join(designsDir, DESIGNS_FILE);

  const prompt = buildDesignPrompt(0, requirementsContent, designCount, designsDir);

  const result: QueryResult = await queryFn({
    prompt,
    model: config.model,
    cwd: process.cwd(),
    maxBudgetUsd: config.maxBudgetPerStep,
    maxTurns: 20,
    useClaudeCodePreset: true,
    loadSettings: true,
  });

  if (!result.ok) {
    console.warn(`[forge] Design generation failed: ${result.error.message}`);
    return false;
  }

  // Read generated designs
  let designsContent = "";
  try {
    designsContent = fs.readFileSync(designsPath, "utf-8");
  } catch {
    // The agent might have written the designs into its output instead of a file
    if (result.result) {
      designsContent = result.result;
      fs.writeFileSync(designsPath, designsContent, "utf-8");
    } else {
      console.warn("[forge] No design options generated.");
      return false;
    }
  }

  // Parse and present options
  const designOptions = parseDesignOptions(designsContent);
  if (designOptions.length === 0) {
    console.warn("[forge] Could not parse design options.");
    return false;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Generated ${designOptions.length} design concepts:`);
  console.log(`Full details: ${designsPath}`);
  console.log(`${"=".repeat(60)}\n`);

  for (let i = 0; i < designOptions.length; i++) {
    const opt = designOptions[i];
    console.log(`  [${i + 1}] ${opt.name}`);
    if (opt.summary) {
      console.log(`      Style: ${opt.summary}`);
    }
  }
  console.log(`  [${designOptions.length + 1}] Mix — describe your own combination`);
  console.log(`  [0] Skip — no design preference`);
  console.log("");

  const choice = await promptUser("Your choice (number): ");
  const choiceNum = parseInt(choice.trim(), 10);

  let selectedDesign: string;

  if (choiceNum === 0 || isNaN(choiceNum)) {
    console.log("[forge] Skipping design selection.");
    return false;
  } else if (choiceNum > 0 && choiceNum <= designOptions.length) {
    selectedDesign = designOptions[choiceNum - 1].fullContent;
    console.log(`[forge] Selected: ${designOptions[choiceNum - 1].name}`);
  } else if (choiceNum === designOptions.length + 1) {
    console.log("\nDescribe your ideal design (mix elements from the options above).");
    console.log("Press Enter twice when done:\n");
    const description = await promptMultiline();
    selectedDesign = `# User's Custom Design Direction\n\n${description}\n\n---\n\nReference designs:\n${designsContent}`;
    console.log("[forge] Custom design direction saved.");
  } else {
    console.log("[forge] Invalid choice, skipping.");
    return false;
  }

  // Save selected design
  fs.writeFileSync(designPath, selectedDesign, "utf-8");
  console.log(`[forge] Design saved to .planning/DESIGN.md`);
  return true;
}

/**
 * Detect if the project is a GUI app from requirements content.
 * Looks for UX-related requirements or web framework mentions.
 */
export function detectGuiApp(requirementsContent: string): boolean {
  const guiIndicators = [
    /\bcategory:\s*ux\b/i,
    /\bdashboard\b/i,
    /\bfrontend\b/i,
    /\bui\s+component/i,
    /\bresponsive\b/i,
    /\bweb\s+app\b/i,
    /\blanding\s+page\b/i,
    /\bnavigation\b/i,
    /\bform\b/i,
    /\bchart\b/i,
    /\bdesign\s+system\b/i,
    /\baccessibility\b/i,
    /\bwcag\b/i,
  ];
  return guiIndicators.some((pattern) => pattern.test(requirementsContent));
}

/**
 * Parse design options from DESIGNS.md content.
 */
function parseDesignOptions(content: string): Array<{ name: string; summary: string; fullContent: string }> {
  const options: Array<{ name: string; summary: string; fullContent: string }> = [];
  const lines = content.split("\n");

  let currentOption: { name: string; summary: string; lines: string[] } | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(?:Option\s+[A-Z0-9]+:\s*)?(.+)/);
    if (headerMatch && !line.includes("Design Options")) {
      if (currentOption) {
        options.push({
          name: currentOption.name,
          summary: currentOption.summary,
          fullContent: currentOption.lines.join("\n"),
        });
      }
      currentOption = {
        name: headerMatch[1].trim(),
        summary: "",
        lines: [line],
      };
    } else if (currentOption) {
      currentOption.lines.push(line);
      if (!currentOption.summary && line.startsWith("**Style:**")) {
        currentOption.summary = line.replace("**Style:**", "").trim();
      }
    }
  }

  if (currentOption) {
    options.push({
      name: currentOption.name,
      summary: currentOption.summary,
      fullContent: currentOption.lines.join("\n"),
    });
  }

  return options;
}

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

function promptMultiline(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];
  let lastLineEmpty = false;

  return new Promise((resolve) => {
    rl.on("line", (line) => {
      if (line === "" && lastLineEmpty) { rl.close(); resolve(lines.join("\n")); return; }
      lastLineEmpty = line === "";
      lines.push(line);
    });
    rl.on("close", () => resolve(lines.join("\n")));
  });
}
