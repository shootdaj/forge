/**
 * Deployment Prompt Builders
 *
 * Pure functions that build prompts for deployment-related agent steps.
 */

import type { DeployAttempt, SmokeTestResult } from "./types.js";

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
        "   - **IMPORTANT**: Disable Vercel Deployment Protection so the health check can reach the app:",
        "     Run `npx vercel protection disable --scope production --yes` after deploying.",
        "     If that command is unavailable, set `VERCEL_AUTOMATION_BYPASS_SECRET` as an env var",
        "     via `npx vercel env add VERCEL_AUTOMATION_BYPASS_SECRET production` with a random token,",
        "     then print: PROTECTION_BYPASS: <the-token-you-set>",
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

  // Platform-specific warnings about common incompatibilities
  parts.push(
    "",
    "## Pre-deployment checks:",
    "Before deploying, verify the project does NOT use incompatible technologies:",
  );

  switch (opts.target) {
    case "vercel":
    case "netlify":
      parts.push(
        "- **CRITICAL**: Check for SQLite or file-based databases (better-sqlite3, sql.js, lowdb).",
        "  These WILL NOT WORK on serverless platforms — the filesystem is read-only and ephemeral.",
        "  If found, migrate to a cloud database (PostgreSQL via Neon/Supabase, or Vercel KV) BEFORE deploying.",
        "- Check for any code that writes to the local filesystem at runtime (uploads, logs, cache files).",
        "- Check for long-running processes or WebSocket servers that exceed function timeouts.",
      );
      break;
    case "fly":
      parts.push(
        "- If using SQLite, ensure a persistent volume is configured in fly.toml.",
        "- Verify DATABASE_URL points to the volume-mounted path.",
      );
      break;
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

/**
 * Build prompt for post-deployment smoke testing.
 *
 * After health check passes, runs core user flows against the deployed URL
 * to verify the app actually works — not just that it returns HTTP 200.
 */
export function buildSmokeTestPrompt(opts: {
  url: string;
  target: string;
}): string {
  return [
    `The app has been deployed to ${opts.url} and the health check passed (HTTP 200).`,
    "",
    "Now verify the app ACTUALLY WORKS by testing core user flows against the live URL.",
    "",
    "## Smoke Test Instructions:",
    "",
    "1. **Visit the landing page** — verify it loads, check all navigation links return 200 (not 404)",
    "2. **Test authentication flow** (if the app has auth):",
    "   - Try to sign up with a test account",
    "   - Try to log in with the account you just created",
    "   - Verify you reach the authenticated area (dashboard, home, etc.)",
    "   - If signup or login fails, this is a CRITICAL issue",
    "3. **Test one core workflow** — the primary action the app exists for:",
    "   - Submit a form, create a record, make an API call, etc.",
    "   - Verify the result persists (reload the page and check it's still there)",
    "4. **Check for data persistence issues**:",
    "   - If the app uses a database, verify writes persist across page reloads",
    "   - On serverless platforms: verify data persists across different requests",
    "     (this catches SQLite-on-serverless bugs where /tmp is ephemeral)",
    "5. **Visual verification** — use `agent-browser` to visually inspect key pages:",
    "   - `agent-browser open <url>` then `agent-browser screenshot` on the main pages",
    "   - Check that charts, tables, and data visualizations render with real data (not empty/zero)",
    "   - Check that chart legends show correct labels (not generic names like 'value' or 'data')",
    "   - Check for overlapping text, broken layouts, or elements rendering on top of each other",
    "   - Check that images and icons load (no broken image placeholders)",
    "   - If you find visual bugs, inspect the component source code and fix them",
    "",
    "## Output:",
    "Report results as JSON on a single line prefixed with SMOKE_TEST_RESULT:",
    "",
    'SMOKE_TEST_RESULT: {"passed": true, "tests": [{"name": "landing page", "passed": true}, ...]}',
    "",
    "Or if failures found:",
    "",
    'SMOKE_TEST_RESULT: {"passed": false, "tests": [{"name": "login", "passed": false, "error": "Returns 500 on POST /api/auth/signin"}]}',
    "",
    "If you find critical issues (auth broken, data not persisting), also fix them in the code,",
    "redeploy, and re-test. Print DEPLOYED_URL: <url> with the new URL after redeployment.",
  ].join("\n");
}
