/**
 * KVM Pre-flight Check Unit Tests
 *
 * Tests KVM availability detection across platforms.
 * Uses injectable fs to test without real /dev/kvm.
 *
 * Requirement: EMU-06
 */

import { describe, it, expect } from "vitest";
import { checkKvmAvailability, assertKvmAvailable } from "./kvm-check.js";
import { KvmUnavailableError } from "./emulator-types.js";

describe("checkKvmAvailability", () => {
  describe("TestCheckKvmAvailability_MacOS_AlwaysAvailable", () => {
    it("returns available on macOS (HVF built-in)", () => {
      const result = checkKvmAvailability("darwin");
      expect(result.available).toBe(true);
      expect(result.message).toBeUndefined();
    });
  });

  describe("TestCheckKvmAvailability_Linux_KvmExists_Available", () => {
    it("returns available when /dev/kvm exists and is accessible", () => {
      const mockFs = {
        existsSync: (p: string) => p === "/dev/kvm",
        accessSync: () => {}, // no throw = accessible
      };
      const result = checkKvmAvailability("linux", mockFs);
      expect(result.available).toBe(true);
    });
  });

  describe("TestCheckKvmAvailability_Linux_KvmMissing_Unavailable", () => {
    it("returns unavailable with install instructions when /dev/kvm missing", () => {
      const mockFs = {
        existsSync: () => false,
      };
      const result = checkKvmAvailability("linux", mockFs);
      expect(result.available).toBe(false);
      expect(result.message).toContain("sudo apt install qemu-kvm");
      expect(result.message).toContain("sudo usermod -aG kvm");
    });
  });

  describe("TestCheckKvmAvailability_Linux_KvmNotAccessible_Unavailable", () => {
    it("returns unavailable with group instructions when /dev/kvm not accessible", () => {
      const mockFs = {
        existsSync: (p: string) => p === "/dev/kvm",
        accessSync: () => {
          throw new Error("EACCES: permission denied");
        },
      };
      const result = checkKvmAvailability("linux", mockFs);
      expect(result.available).toBe(false);
      expect(result.message).toContain("KVM exists but is not accessible");
      expect(result.message).toContain("sudo usermod -aG kvm");
    });
  });

  describe("TestCheckKvmAvailability_Windows_Unsupported", () => {
    it("returns unavailable on Windows", () => {
      const result = checkKvmAvailability("win32");
      expect(result.available).toBe(false);
      expect(result.message).toContain("not supported");
      expect(result.message).toContain("win32");
    });
  });

  describe("TestCheckKvmAvailability_DefaultsPlatform", () => {
    it("returns a KvmCheckResult with default platform", () => {
      const result = checkKvmAvailability();
      expect(result).toHaveProperty("available");
      // On macOS CI, this will be true; on Linux CI depends on KVM availability
      expect(typeof result.available).toBe("boolean");
    });
  });

  describe("TestCheckKvmAvailability_Linux_NoAccessSync", () => {
    it("returns available when accessSync is not provided but /dev/kvm exists", () => {
      const mockFs = {
        existsSync: (p: string) => p === "/dev/kvm",
        // No accessSync — cannot check permissions, assume OK
      };
      const result = checkKvmAvailability("linux", mockFs);
      expect(result.available).toBe(true);
    });
  });

  describe("TestCheckKvmAvailability_UnknownPlatform", () => {
    it("returns unavailable on unknown platforms", () => {
      const result = checkKvmAvailability("freebsd");
      expect(result.available).toBe(false);
      expect(result.message).toContain("freebsd");
    });
  });
});

describe("assertKvmAvailable", () => {
  describe("TestAssertKvmAvailable_Available_NoThrow", () => {
    it("does not throw on macOS", () => {
      expect(() => assertKvmAvailable("darwin")).not.toThrow();
    });
  });

  describe("TestAssertKvmAvailable_Unavailable_ThrowsKvmUnavailableError", () => {
    it("throws KvmUnavailableError when KVM unavailable", () => {
      const mockFs = {
        existsSync: () => false,
      };
      expect(() => assertKvmAvailable("linux", mockFs)).toThrow(
        KvmUnavailableError,
      );
    });
  });

  describe("TestAssertKvmAvailable_ErrorMessage_Actionable", () => {
    it("thrown error contains actionable install instructions", () => {
      const mockFs = {
        existsSync: () => false,
      };
      try {
        assertKvmAvailable("linux", mockFs);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(KvmUnavailableError);
        const kvmErr = err as KvmUnavailableError;
        expect(kvmErr.actionMessage).toContain("sudo apt install qemu-kvm");
        expect(kvmErr.name).toBe("KvmUnavailableError");
      }
    });
  });

  describe("TestAssertKvmAvailable_Available_Linux_NoThrow", () => {
    it("does not throw on Linux when KVM exists and is accessible", () => {
      const mockFs = {
        existsSync: (p: string) => p === "/dev/kvm",
        accessSync: () => {},
      };
      expect(() => assertKvmAvailable("linux", mockFs)).not.toThrow();
    });
  });
});
