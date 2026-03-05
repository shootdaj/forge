/**
 * Verifier Utilities
 *
 * Shared utilities for running shell commands with timeout and buffer limits.
 * Used by all verifiers that delegate to CLI tools (tsc, vitest, eslint, etc.).
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Result of a shell command execution.
 * Always returned — never throws, even on non-zero exit codes.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a shell command with configurable timeout and buffer limits.
 *
 * Key behaviors:
 * - Sets maxBuffer to 10MB to handle large outputs (e.g., tsc error dumps)
 * - Disables ANSI color codes via NO_COLOR=1 and FORCE_COLOR=0
 * - Never throws on non-zero exit codes — returns exitCode instead
 * - On timeout, the child process is killed and we return whatever output was captured
 *
 * @param command - Shell command to execute
 * @param cwd - Working directory for the command
 * @param timeoutMs - Timeout in milliseconds (default: 30s)
 * @returns ExecResult with stdout, stderr, and exitCode
 */
export async function execWithTimeout(
  command: string,
  cwd: string,
  timeoutMs: number = 30_000,
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    // exec throws on non-zero exit AND on timeout.
    // In both cases, stdout/stderr may contain partial output.
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };

    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode:
        typeof execError.code === "number" ? execError.code : 1,
    };
  }
}
