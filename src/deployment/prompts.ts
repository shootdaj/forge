/**
 * Deployment Prompt Builders
 *
 * Pure functions that build prompts for deployment-related agent steps.
 */

import type { DeployAttempt } from "./types.js";

/**
 * Build prompt for deploying a web app.
 *
 * Tells the agent to deploy using the configured target platform.
 */
export function buildDeployPrompt(opts: {
  target: string;
  environments: string[];
  projectDir: string;
  priorAttempts?: DeployAttempt[];
}): string {
  const parts: string[] = [
    `Deploy this web application to ${opts.target}.`,
    "",
    `Target platform: ${opts.target}`,
    `Environment: production`,
    `Project directory: ${opts.projectDir}`,
  ];

  if (opts.priorAttempts && opts.priorAttempts.length > 0) {
    parts.push(
      "",
      "## Prior deployment attempts (failed):",
    );
    for (const attempt of opts.priorAttempts) {
      parts.push(
        `  Attempt ${attempt.attempt}: ${attempt.error ?? "unknown error"}`,
      );
      if (attempt.healthCheck && !attempt.healthCheck.healthy) {
        parts.push(
          `    Health check: HTTP ${attempt.healthCheck.statusCode} — ${attempt.healthCheck.error}`,
        );
      }
    }
    parts.push(
      "",
      "Fix the issues from prior attempts before deploying again.",
    );
  }

  parts.push(
    "",
    "## Instructions:",
    "1. Ensure the project builds successfully (`npm run build` or equivalent)",
    "2. Deploy to the target platform using its CLI or configuration",
    `3. For ${opts.target}:`,
  );

  // Platform-specific instructions
  switch (opts.target) {
    case "vercel":
      parts.push(
        "   - Run `npx vercel --prod --yes` to deploy",
        "   - If not linked, run `npx vercel link` first",
        "   - Capture the deployment URL from the output",
      );
      break;
    case "railway":
      parts.push(
        "   - Run `railway up` to deploy",
        "   - Capture the deployment URL from `railway status`",
      );
      break;
    case "fly":
      parts.push(
        "   - Run `fly deploy` to deploy",
        "   - If no fly.toml, run `fly launch` first",
        "   - Capture the deployment URL from the output",
      );
      break;
    case "netlify":
      parts.push(
        "   - Run `npx netlify deploy --prod` to deploy",
        "   - Capture the deployment URL from the output",
      );
      break;
    default:
      parts.push(
        "   - Deploy using the platform's standard CLI or workflow",
        "   - Capture the deployment URL",
      );
  }

  parts.push(
    "",
    "4. Print the deployed URL on its own line prefixed with DEPLOYED_URL:",
    "   Example: DEPLOYED_URL: https://my-app.vercel.app",
    "5. If deployment fails, print DEPLOY_FAILED: <reason>",
  );

  return parts.join("\n");
}

/**
 * Build prompt for diagnosing and fixing a deployment failure.
 *
 * Used when health check fails after a successful deploy command.
 */
export function buildDeployFixPrompt(opts: {
  target: string;
  url: string;
  healthCheck: { statusCode: number; error?: string };
  attempt: number;
}): string {
  return [
    `Deployment to ${opts.target} succeeded but the app is not healthy.`,
    "",
    `Deployed URL: ${opts.url}`,
    `Health check result: HTTP ${opts.healthCheck.statusCode}${opts.healthCheck.error ? ` — ${opts.healthCheck.error}` : ""}`,
    `This is attempt ${opts.attempt} to fix the deployment.`,
    "",
    "## Diagnose and fix:",
    "1. Check the deployment logs for errors:",
    opts.target === "vercel"
      ? "   `npx vercel logs ${url} --follow`"
      : opts.target === "fly"
        ? "   `fly logs`"
        : `   Check ${opts.target} dashboard for logs`,
    "2. Common issues:",
    "   - Missing environment variables (check .env.example vs deployed env)",
    "   - Build errors that didn't surface during local build",
    "   - Port binding issues (app not listening on the right port)",
    "   - Database/service connection failures in production",
    "3. Fix the root cause in the code or configuration",
    "4. Redeploy using the same method as before",
    "5. Print the new URL: DEPLOYED_URL: <url>",
    "   Or if still failing: DEPLOY_FAILED: <reason>",
  ].join("\n");
}
