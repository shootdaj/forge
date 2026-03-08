/**
 * CLI Entry Point
 *
 * Commander-based CLI with five Forge commands: init, run, phase, status, resume.
 * Each command is a thin handler that loads config, creates/loads state,
 * and delegates to the appropriate module.
 *
 * Requirements: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, COST-05
 */

import { Command } from "commander";
import * as fs from "node:fs";
import { loadConfig, loadConfigOrDefaults } from "../config/index.js";
import {
  StateManager,
  createInitialState,
} from "../state/index.js";
import { CostController, BudgetExceededError } from "../step-runner/index.js";
import { runPipeline, loadResumeData } from "../pipeline/index.js";
import { runPhase } from "../phase-runner/index.js";
import { executeQuery } from "../sdk/index.js";
import { formatStatus } from "./status.js";
import { createTestGuide, injectTestingMethodology } from "./traceability.js";
import { gatherRequirements } from "../requirements/index.js";
import { createDocPages } from "../docs/index.js";
import type { PipelineContext, PipelineResult } from "../pipeline/types.js";
import type { PhaseRunnerContext, PhaseResult } from "../phase-runner/types.js";
import type { ForgeConfig } from "../config/schema.js";
import type { StepRunnerContext } from "../step-runner/types.js";
import type { GatherResult } from "../requirements/types.js";

/**
 * Build a StepRunnerContext from config and state manager.
 */
function buildStepRunnerContext(
  config: ForgeConfig,
  stateManager: StateManager,
): StepRunnerContext {
  return {
    config,
    stateManager,
    executeQueryFn: executeQuery,
  };
}

/**
 * Build a PipelineContext from config, state manager, and cost controller.
 * Avoids duplication between run and resume commands.
 */
function buildPipelineContext(
  config: ForgeConfig,
  stateManager: StateManager,
  costController: CostController,
): PipelineContext {
  const stepRunnerContext = buildStepRunnerContext(config, stateManager);
  return {
    config,
    stateManager,
    stepRunnerContext,
    costController,
    runPhaseFn: runPhase,
  };
}

/**
 * Handle a PipelineResult by printing the appropriate output to stdout/stderr.
 * Returns the process exit code.
 */
function handlePipelineResult(result: PipelineResult): number {
  switch (result.status) {
    case "completed":
      console.log("Pipeline completed successfully.");
      console.log(
        `Waves: ${result.wavesCompleted} | Phases: ${result.phasesCompleted.join(", ")}`,
      );
      console.log(`Total cost: $${result.totalCostUsd.toFixed(2)}`);
      console.log(
        `Spec compliance: ${result.specCompliance.remainingGaps.length === 0 ? "All requirements verified" : `${result.specCompliance.remainingGaps.length} gaps remaining`}`,
      );
      return 0;

    case "checkpoint":
      console.log("Pipeline paused at human checkpoint.");
      console.log(`Wave: ${result.wave}`);
      console.log(
        `Phases completed so far: ${result.phasesCompletedSoFar.join(", ") || "none"}`,
      );
      console.log("");
      console.log(
        "Add credentials to .env.production, then run:",
      );
      console.log(
        "  $ forge resume --env .env.production [--guidance guidance.md]",
      );
      return 0;

    case "failed":
      console.error("Pipeline failed.");
      console.error(`Wave: ${result.wave} | Reason: ${result.reason}`);
      console.error(
        `Phases completed: ${result.phasesCompletedSoFar.join(", ") || "none"}`,
      );
      console.error(
        `Phases failed: ${result.phasesFailed.join(", ") || "none"}`,
      );
      return 1;

    case "stuck":
      console.error("Pipeline stuck (non-converging).");
      console.error(`Wave: ${result.wave} | Reason: ${result.reason}`);
      console.error(`Gap history: ${result.gapHistory.join(" -> ")}`);
      return 1;
  }
}

/**
 * Handle a PhaseResult by printing the appropriate output.
 * Returns the process exit code.
 */
function handlePhaseResult(phaseNum: number, result: PhaseResult): number {
  switch (result.status) {
    case "completed":
      console.log(`Phase ${phaseNum} completed successfully.`);
      return 0;

    case "failed":
      console.error(`Phase ${phaseNum} failed: ${result.reason}`);
      if (result.gapsRemaining && result.gapsRemaining.length > 0) {
        console.error(`Gaps remaining: ${result.gapsRemaining.join(", ")}`);
      }
      return 1;

    case "partial":
      console.log(
        `Phase ${phaseNum} partially completed. Steps done: ${result.completedSubsteps.join(", ")}`,
      );
      console.error(`Last error: ${result.lastError}`);
      return 1;
  }
}

/**
 * Create and configure the CLI program with all five Forge commands.
 *
 * Requirement: CLI-01
 */
export function createCli(): Command {
  const program = new Command();
  program
    .name("forge")
    .description("Autonomous software development orchestrator")
    .version("0.1.0");

  // -------------------------------------------------------------------
  // forge init
  // -------------------------------------------------------------------
  program
    .command("init")
    .description("Start interactive requirements gathering")
    .action(async () => {
      try {
        const config = await loadConfig(process.cwd());
        const stateManager = new StateManager(process.cwd());
        const state = createInitialState(process.cwd(), config.model);
        stateManager.save(state);

        // Gather requirements using Agent SDK
        let gatherResult: GatherResult | undefined;
        try {
          gatherResult = await gatherRequirements(config, {
            executeQueryFn: executeQuery,
          });
          // Write REQUIREMENTS.md to project directory
          fs.writeFileSync(
            "REQUIREMENTS.md",
            gatherResult.formattedDoc,
            "utf-8",
          );
          const categoryCount = new Set(
            gatherResult.requirements.map((r) => r.category),
          ).size;
          console.log(
            `Requirements gathered: ${gatherResult.requirements.length} requirements across ${categoryCount} categories.`,
          );
        } catch (reqErr) {
          console.warn(
            `Requirements gathering failed: ${reqErr instanceof Error ? reqErr.message : String(reqErr)}. You can re-run with \`forge init\`.`,
          );
        }

        // Generate roadmap from SPEC + requirements using Agent SDK
        try {
          console.log("Generating roadmap...");
          const specContent = fs.existsSync("SPEC.md")
            ? fs.readFileSync("SPEC.md", "utf-8")
            : "";
          const reqContent = fs.existsSync("REQUIREMENTS.md")
            ? fs.readFileSync("REQUIREMENTS.md", "utf-8")
            : "";

          const roadmapResult = await executeQuery({
            prompt: `You are a software architect. Based on the SPEC and REQUIREMENTS below, create a phased development roadmap.

Output ONLY the roadmap in this exact markdown format (no other text):

# Roadmap

## Execution Plan

### Phase 1: <Name>
**Goal**: <One sentence>
**Depends on**: Nothing
**Requirements**: <comma-separated requirement IDs from REQUIREMENTS.md, e.g. R21, R22>

### Phase 2: <Name>
**Goal**: <One sentence>
**Depends on**: Phase 1
**Requirements**: <requirement IDs>

...continue for all phases needed...

Rules:
- Break the project into 3-6 phases
- Phase 1 should be project scaffolding + core data model
- Each phase should be independently testable
- List dependencies accurately (which phases must complete first)
- Map every requirement ID to exactly one phase
- Keep phases focused — each should take 1-3 SDK query calls to build

SPEC:
${specContent}

REQUIREMENTS:
${reqContent}`,
            model: config.model,
            cwd: process.cwd(),
            maxBudgetUsd: 1,
            maxTurns: 5,
          });

          if (roadmapResult.ok && roadmapResult.result) {
            fs.mkdirSync(".planning", { recursive: true });
            fs.writeFileSync(".planning/ROADMAP.md", roadmapResult.result, "utf-8");
            console.log("Roadmap generated: .planning/ROADMAP.md");
          } else {
            console.warn("Roadmap generation returned no result. You can create .planning/ROADMAP.md manually.");
          }
        } catch (roadmapErr) {
          console.warn(
            `Roadmap generation failed: ${roadmapErr instanceof Error ? roadmapErr.message : String(roadmapErr)}. Create .planning/ROADMAP.md manually.`,
          );
        }

        // Create Notion documentation pages if parentPageId is configured
        if (config.notion.parentPageId) {
          try {
            const pageIds = await createDocPages(
              config.notion.parentPageId,
              "Forge Project",
              { executeQueryFn: executeQuery },
            );
            console.log("Notion docs created: 8 pages.");
            // Log page IDs for reference (config update deferred to future enhancement)
            void pageIds;
          } catch (notionErr) {
            console.warn(
              `Notion setup skipped: ${notionErr instanceof Error ? notionErr.message : String(notionErr)}.`,
            );
          }
        }

        // Create TEST_GUIDE.md with gathered requirements (or empty if gathering failed)
        const testGuideReqs = gatherResult
          ? gatherResult.requirements.map((r) => ({
              id: r.id,
              description: r.title,
            }))
          : [];
        createTestGuide(testGuideReqs, "TEST_GUIDE.md");

        // Inject testing methodology into CLAUDE.md
        injectTestingMethodology("CLAUDE.md", {
          testNaming: "Test<Component>_<Behavior>[_<Condition>]",
          tiers: ["Unit tests", "Integration tests", "Scenario tests"],
          requirementPrefix: "REQ-",
        });

        console.log("Project initialized.");
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // -------------------------------------------------------------------
  // forge run
  // -------------------------------------------------------------------
  program
    .command("run")
    .description("Execute full wave model autonomously")
    .action(async () => {
      try {
        const config = await loadConfig(process.cwd());
        const stateManager = new StateManager(process.cwd());
        const costController = new CostController();
        const ctx = buildPipelineContext(config, stateManager, costController);

        const result = await runPipeline(ctx);
        const exitCode = handlePipelineResult(result);
        if (exitCode !== 0) process.exit(exitCode);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          console.error(
            `Budget exceeded: $${err.totalBudgetUsed.toFixed(2)} used of $${err.maxBudgetTotal.toFixed(2)} limit`,
          );
          process.exit(1);
        }
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // -------------------------------------------------------------------
  // forge phase <number>
  // -------------------------------------------------------------------
  program
    .command("phase <number>")
    .description("Run a single phase")
    .action(async (phaseNum: string) => {
      try {
        const num = parseInt(phaseNum, 10);
        if (isNaN(num) || num <= 0) {
          console.error("Error: Phase number must be a positive integer.");
          process.exit(1);
        }

        const config = await loadConfig(process.cwd());
        const stateManager = new StateManager(process.cwd());
        const costController = new CostController();
        const stepRunnerContext = buildStepRunnerContext(config, stateManager);

        const phaseRunnerCtx: PhaseRunnerContext = {
          config,
          stateManager,
          stepRunnerContext,
          costController,
        };

        const result = await runPhase(num, phaseRunnerCtx);
        const exitCode = handlePhaseResult(num, result);
        if (exitCode !== 0) process.exit(exitCode);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          console.error(
            `Budget exceeded: $${err.totalBudgetUsed.toFixed(2)} used of $${err.maxBudgetTotal.toFixed(2)} limit`,
          );
          process.exit(1);
        }
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // -------------------------------------------------------------------
  // forge status
  // -------------------------------------------------------------------
  program
    .command("status")
    .description("Display project status")
    .action(async () => {
      try {
        const stateManager = new StateManager(process.cwd());
        if (!stateManager.exists()) {
          console.log("No forge project found. Run `forge init` first.");
          return;
        }

        const state = stateManager.load();
        let maxBudgetTotal = 200.0;
        try {
          const config = await loadConfig(process.cwd());
          maxBudgetTotal = config.maxBudgetTotal;
        } catch {
          // Use default if config not loadable
        }

        const output = formatStatus(state, maxBudgetTotal);
        console.log(output);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // -------------------------------------------------------------------
  // forge resume
  // -------------------------------------------------------------------
  program
    .command("resume")
    .description("Continue from checkpoint")
    .option("--env <file>", "Path to .env file with credentials")
    .option("--guidance <file>", "Path to guidance markdown file")
    .action(async (opts: { env?: string; guidance?: string }) => {
      try {
        if (!opts.env) {
          console.error("Error: --env <file> is required for resume.");
          process.exit(1);
        }

        const config = await loadConfig(process.cwd());
        const stateManager = new StateManager(process.cwd());
        const costController = new CostController();

        // Load resume data (credentials + guidance)
        const resumeData = loadResumeData(opts.env, opts.guidance);

        // Update state with credentials and guidance
        await stateManager.update((current) => ({
          ...current,
          credentials: { ...current.credentials, ...resumeData.credentials },
          humanGuidance: {
            ...current.humanGuidance,
            ...resumeData.guidance,
          },
        }));

        const ctx = buildPipelineContext(config, stateManager, costController);
        const result = await runPipeline(ctx);
        const exitCode = handlePipelineResult(result);
        if (exitCode !== 0) process.exit(exitCode);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          console.error(
            `Budget exceeded: $${err.totalBudgetUsed.toFixed(2)} used of $${err.maxBudgetTotal.toFixed(2)} limit`,
          );
          process.exit(1);
        }
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  return program;
}

/**
 * Main entry point. Parses process.argv and executes the matching command.
 *
 * Requirement: CLI-01
 */
export async function main(): Promise<void> {
  const cli = createCli();
  await cli.parseAsync(process.argv);
}
