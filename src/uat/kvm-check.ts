/**
 * KVM Pre-flight Check
 *
 * Checks KVM (or HVF on macOS) availability before emulator operations.
 * Returns actionable error messages when KVM is unavailable.
 *
 * Requirement: EMU-06
 */

import * as fs from "node:fs";
import { KvmUnavailableError } from "./emulator-types.js";
import type { KvmCheckResult } from "./emulator-types.js";

/**
 * Check KVM availability for Android emulator acceleration.
 *
 * - macOS (darwin): Always available — Apple Hypervisor Framework (HVF) is built-in
 * - Linux: Check if /dev/kvm exists and is accessible
 * - Other platforms: Not supported
 *
 * Requirement: EMU-06
 *
 * @param platform - OS platform (defaults to process.platform)
 * @param fsFn - Injectable fs for testing (defaults to node:fs)
 * @returns KvmCheckResult with availability status
 */
export function checkKvmAvailability(
  platform: string = process.platform,
  fsFn: {
    existsSync: (path: string) => boolean;
    accessSync?: (path: string, mode?: number) => void;
  } = fs,
): KvmCheckResult {
  // macOS: HVF is always available
  if (platform === "darwin") {
    return { available: true };
  }

  // Linux: check /dev/kvm
  if (platform === "linux") {
    if (!fsFn.existsSync("/dev/kvm")) {
      return {
        available: false,
        message:
          "KVM not available. Install and configure KVM:\n" +
          "  sudo apt install qemu-kvm\n" +
          "  sudo usermod -aG kvm $USER\n" +
          "  # Then log out and back in",
      };
    }

    // Check if /dev/kvm is accessible (read+write)
    try {
      if (fsFn.accessSync) {
        fsFn.accessSync("/dev/kvm", fs.constants.R_OK | fs.constants.W_OK);
      }
      return { available: true };
    } catch {
      return {
        available: false,
        message:
          "KVM exists but is not accessible. Add user to kvm group:\n" +
          "  sudo usermod -aG kvm $USER\n" +
          "  # Then log out and back in",
      };
    }
  }

  // Unsupported platform
  return {
    available: false,
    message: `Platform '${platform}' is not supported for Android emulator operations. Use Linux or macOS.`,
  };
}

/**
 * Assert KVM is available, throwing KvmUnavailableError if not.
 * Call this before any emulator operation.
 *
 * Requirement: EMU-06
 *
 * @param platform - OS platform override for testing
 * @param fsFn - Injectable fs for testing
 * @throws KvmUnavailableError with actionable installation instructions
 */
export function assertKvmAvailable(
  platform?: string,
  fsFn?: {
    existsSync: (path: string) => boolean;
    accessSync?: (path: string, mode?: number) => void;
  },
): void {
  const result = checkKvmAvailability(platform, fsFn);
  if (!result.available) {
    throw new KvmUnavailableError(
      result.message ?? "KVM is not available",
    );
  }
}
