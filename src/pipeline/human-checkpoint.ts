/**
 * Human Checkpoint Module
 *
 * Manages the human checkpoint between Wave 1 and Wave 2.
 * Batches ALL human needs into a single interruption:
 * - Services needing credentials
 * - Skipped items needing guidance
 * - Deferred ideas
 *
 * Provides pause (write checkpoint file) and resume (parse env + guidance).
 *
 * Requirements: PIPE-04
 */

import type { ForgeState } from "../state/schema.js";
import type { CheckpointReport, ServiceDetection, SkippedItem } from "./types.js";

/**
 * Generate a checkpoint report from the current state.
 *
 * Pure function: reads state fields and produces a CheckpointReport.
 *
 * Requirement: PIPE-04
 *
 * @param state - Current Forge state
 * @returns CheckpointReport with all batched human needs
 */
export function generateCheckpointReport(state: ForgeState): CheckpointReport {
  // Map state.servicesNeeded to ServiceDetection[]
  const servicesNeeded: ServiceDetection[] = state.servicesNeeded.map((s) => ({
    service: s.service,
    why: s.why,
    phase: 1, // Wave 1 services
    signupUrl: s.signupUrl,
    credentialsNeeded: [...s.credentialsNeeded],
  }));

  // Map state.skippedItems to SkippedItem[]
  const skippedItems: SkippedItem[] = state.skippedItems.map((item) => ({
    requirement: item.requirement,
    phase: item.phase,
    attempts: item.attempts.map((a) => ({ approach: a.approach, error: a.error })),
    codeSoFar: item.codeSoFar,
  }));

  // Deferred ideas are not currently tracked in state -- return empty array
  const deferredIdeas: string[] = [];

  // Compute wave1Summary from state.phases
  let phasesCompleted = 0;
  let phasesFailed = 0;
  let requirementsBuilt = 0;
  const requirementsTotal = state.specCompliance.totalRequirements;

  for (const phaseState of Object.values(state.phases)) {
    if (phaseState.status === "completed") {
      phasesCompleted++;
    } else if (phaseState.status === "failed") {
      phasesFailed++;
    }
  }

  // Requirements built = total verified from specCompliance
  requirementsBuilt = state.specCompliance.verified;

  return {
    servicesNeeded,
    skippedItems,
    deferredIdeas,
    wave1Summary: {
      phasesCompleted,
      phasesFailed,
      requirementsBuilt,
      requirementsTotal,
    },
  };
}

/**
 * Format a checkpoint report for terminal display.
 *
 * Produces plain text matching SPEC.md section 8.
 * Uses plain text formatting (no Unicode box drawing).
 *
 * Requirement: PIPE-04
 *
 * @param report - The checkpoint report to format
 * @returns Formatted display string
 */
export function formatCheckpointDisplay(report: CheckpointReport): string {
  const lines: string[] = [];

  lines.push("FORGE -- Human Checkpoint");
  lines.push("");
  lines.push(
    `Wave 1 complete: ${report.wave1Summary.requirementsBuilt}/${report.wave1Summary.requirementsTotal} requirements built`,
  );

  // Services section
  if (report.servicesNeeded.length > 0) {
    lines.push("");
    lines.push("Services needed (please sign up + provide keys):");
    for (const svc of report.servicesNeeded) {
      const creds = svc.credentialsNeeded.join(", ");
      const urlPart = svc.signupUrl ? ` (${svc.signupUrl})` : "";
      lines.push(`  - ${svc.service}: ${svc.why}${urlPart}`);
      if (creds) {
        lines.push(`    Credentials: ${creds}`);
      }
    }
  }

  // Skipped items section
  if (report.skippedItems.length > 0) {
    lines.push("");
    lines.push("Skipped items (need your guidance):");
    for (const item of report.skippedItems) {
      const approaches = item.attempts.map((a) => a.approach).join(", ");
      lines.push(`  - ${item.requirement} (phase ${item.phase})`);
      if (approaches) {
        lines.push(`    Tried: ${approaches}`);
      }
    }
  }

  // Deferred ideas section
  if (report.deferredIdeas.length > 0) {
    lines.push("");
    lines.push("Deferred ideas:");
    for (const idea of report.deferredIdeas) {
      lines.push(`  - ${idea}`);
    }
  }

  // Resume instructions
  lines.push("");
  lines.push("Add credentials to .env.production, then run:");
  lines.push("  $ forge resume --env .env.production [--guidance guidance.md]");

  return lines.join("\n");
}

/**
 * Write a checkpoint file with the full report as JSON.
 *
 * @param report - The checkpoint report
 * @param outputPath - Path to write forge-checkpoint.json
 * @param fs - Optional injectable filesystem for testing
 */
export function writeCheckpointFile(
  report: CheckpointReport,
  outputPath: string,
  fs?: { writeFileSync: (path: string, data: string) => void },
): void {
  const fsImpl = fs ?? require("node:fs");
  const content = JSON.stringify(report, null, 2) + "\n";
  fsImpl.writeFileSync(outputPath, content);
}

/**
 * Load resume data from env file and optional guidance file.
 *
 * Parses .env.production style file: KEY=VALUE lines (ignoring comments, blank lines).
 * Parses optional guidance markdown: sections with ## RequirementID headers.
 *
 * @param envFilePath - Path to .env.production style file
 * @param guidancePath - Optional path to guidance markdown file
 * @param fs - Optional injectable filesystem for testing
 * @returns Parsed credentials and guidance maps
 * @throws Error if env file doesn't exist
 */
export function loadResumeData(
  envFilePath: string,
  guidancePath?: string,
  fs?: {
    readFileSync: (path: string, encoding: string) => string;
    existsSync: (path: string) => boolean;
  },
): { credentials: Record<string, string>; guidance: Record<string, string> } {
  const fsImpl = fs ?? require("node:fs");

  if (!fsImpl.existsSync(envFilePath)) {
    throw new Error(`Environment file not found: ${envFilePath}`);
  }

  // Parse env file
  const envContent = fsImpl.readFileSync(envFilePath, "utf-8");
  const credentials: Record<string, string> = {};

  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      credentials[key] = value;
    }
  }

  // Parse guidance file
  const guidance: Record<string, string> = {};

  if (guidancePath && fsImpl.existsSync(guidancePath)) {
    const guidanceContent = fsImpl.readFileSync(guidancePath, "utf-8");
    let currentId: string | null = null;
    let currentLines: string[] = [];

    for (const line of guidanceContent.split("\n")) {
      const headerMatch = line.match(/^##\s+(\S+)/);
      if (headerMatch) {
        // Save previous section
        if (currentId) {
          guidance[currentId] = currentLines.join("\n").trim();
        }
        currentId = headerMatch[1];
        currentLines = [];
      } else if (currentId) {
        currentLines.push(line);
      }
    }

    // Save last section
    if (currentId) {
      guidance[currentId] = currentLines.join("\n").trim();
    }
  }

  return { credentials, guidance };
}

/**
 * Check whether the current state warrants a human checkpoint.
 *
 * Pure function: returns true if there are services needing credentials
 * or skipped items needing guidance.
 *
 * @param state - Current Forge state
 * @returns true if a checkpoint is needed
 */
export function needsHumanCheckpoint(state: ForgeState): boolean {
  return state.servicesNeeded.length > 0 || state.skippedItems.length > 0;
}
