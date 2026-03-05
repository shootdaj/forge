/**
 * Status Formatter
 *
 * Pure functions that format ForgeState into terminal-friendly plain text output.
 * No I/O, no ANSI color codes, no Unicode box drawing characters.
 *
 * Requirements: CLI-04, COST-05
 */

import type { ForgeState } from "../state/schema.js";

/**
 * Main status formatter. Produces a multi-section plain text display
 * of the current Forge project state.
 *
 * Sections:
 *   1. Header (status + wave)
 *   2. Phase Progress (via formatPhaseTable)
 *   3. Services Needed (if any)
 *   4. Skipped Items (if any)
 *   5. Spec Compliance
 *   6. Budget Breakdown (via formatBudgetBreakdown)
 *
 * Requirement: CLI-04
 */
export function formatStatus(state: ForgeState, maxBudgetTotal?: number): string {
  const sections: string[] = [];

  // Section 1: Header
  sections.push(`FORGE -- Project Status`);
  sections.push(`Status: ${state.status} | Wave: ${state.currentWave}`);

  // Section 2: Phase Progress
  sections.push("");
  sections.push(formatPhaseTable(state.phases));

  // Section 3: Services Needed (conditional)
  const servicesSection = formatServicesNeeded(state.servicesNeeded);
  if (servicesSection) {
    sections.push("");
    sections.push(servicesSection);
  }

  // Section 4: Skipped Items (conditional)
  const skippedSection = formatSkippedItems(state.skippedItems);
  if (skippedSection) {
    sections.push("");
    sections.push(skippedSection);
  }

  // Section 5: Spec Compliance
  sections.push("");
  sections.push(formatSpecCompliance(state.specCompliance, state.remainingGaps));

  // Section 6: Budget Breakdown
  const budget = maxBudgetTotal ?? 200.0;
  sections.push("");
  sections.push(formatBudgetBreakdown(state.phases, state.totalBudgetUsed, budget));

  return sections.join("\n");
}

/**
 * Formats just the phase table section.
 * Sorts phase keys numerically.
 *
 * Requirement: CLI-04
 */
export function formatPhaseTable(phases: ForgeState["phases"]): string {
  const lines: string[] = ["Phase Progress:"];

  const sortedKeys = Object.keys(phases).sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    return numA - numB;
  });

  if (sortedKeys.length === 0) {
    lines.push("  No phases configured.");
    return lines.join("\n");
  }

  // Find the longest status string for alignment
  const maxStatusLen = Math.max(
    ...sortedKeys.map((k) => phases[k].status.length),
  );

  for (const key of sortedKeys) {
    const phase = phases[key];
    const paddedStatus = phase.status.padEnd(maxStatusLen);
    const cost = formatDollars(phase.budgetUsed);
    lines.push(`  Phase ${key}: ${paddedStatus}  (${cost})`);
  }

  return lines.join("\n");
}

/**
 * Formats the budget section with per-phase costs and total with limit.
 *
 * Requirement: COST-05
 */
export function formatBudgetBreakdown(
  phases: ForgeState["phases"],
  totalBudgetUsed: number,
  maxBudgetTotal: number,
): string {
  const lines: string[] = ["Budget:"];

  const sortedKeys = Object.keys(phases).sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    return numA - numB;
  });

  // Determine alignment width: find the longest dollar string
  const dollarStrings = sortedKeys.map((k) => formatDollars(phases[k].budgetUsed));
  const totalStr = formatDollars(totalBudgetUsed);
  const limitStr = formatDollars(maxBudgetTotal);
  const allDollarStrings = [...dollarStrings, totalStr, `${totalStr} / ${limitStr}`];
  const maxDollarLen = Math.max(0, ...allDollarStrings.map((s) => s.length));

  // Find longest phase label for alignment
  const labels = sortedKeys.map((k) => `Phase ${k}:`);
  const totalLabel = "Total:";
  const maxLabelLen = Math.max(0, totalLabel.length, ...labels.map((l) => l.length));

  for (let i = 0; i < sortedKeys.length; i++) {
    const label = labels[i].padEnd(maxLabelLen);
    const cost = dollarStrings[i].padStart(maxDollarLen);
    lines.push(`  ${label}  ${cost}`);
  }

  // Separator
  const sepLen = maxLabelLen + 2 + maxDollarLen + 2;
  lines.push(`  ${"-".repeat(sepLen)}`);

  // Total line
  const paddedTotalLabel = totalLabel.padEnd(maxLabelLen);
  const totalDisplay = `${totalStr} / ${limitStr}`;
  lines.push(`  ${paddedTotalLabel}  ${totalDisplay}`);

  return lines.join("\n");
}

/**
 * Formats services section. Returns empty string if no services.
 *
 * Requirement: CLI-04
 */
export function formatServicesNeeded(
  services: ForgeState["servicesNeeded"],
): string {
  if (services.length === 0) return "";

  const lines: string[] = ["Services Needed:"];

  for (const svc of services) {
    const creds = svc.credentialsNeeded.join(", ");
    lines.push(`  - ${svc.service}: ${svc.why} (${creds})`);
  }

  return lines.join("\n");
}

/**
 * Formats skipped items section. Returns empty string if no items.
 *
 * Requirement: CLI-04
 */
export function formatSkippedItems(
  items: ForgeState["skippedItems"],
): string {
  if (items.length === 0) return "";

  const lines: string[] = ["Skipped Items:"];

  for (const item of items) {
    const approaches = item.attempts.map((a) => a.approach).join(", ");
    lines.push(`  - ${item.requirement} (phase ${item.phase}): Tried ${approaches}`);
  }

  return lines.join("\n");
}

/**
 * Formats spec compliance section.
 *
 * Requirement: CLI-04
 */
export function formatSpecCompliance(
  compliance: ForgeState["specCompliance"],
  remainingGaps: string[],
): string {
  const lines: string[] = [];

  lines.push(
    `Spec Compliance: ${compliance.verified}/${compliance.totalRequirements} requirements verified (${compliance.roundsCompleted} rounds)`,
  );

  if (remainingGaps.length > 0) {
    lines.push(`  Remaining: ${remainingGaps.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Format a number as a dollar amount with 2 decimal places.
 */
function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
