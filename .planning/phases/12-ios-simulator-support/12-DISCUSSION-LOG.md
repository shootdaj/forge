# Phase 12: iOS Simulator Support - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 12-ios-simulator-support
**Areas discussed:** Simulator Module Structure, UAT Runner Platform Routing, iOS Build Verifier, Simulator Device Selection, Config Extension
**Mode:** Auto (all decisions auto-resolved with recommended defaults)

---

## Simulator Module Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror emulator.ts pattern | Separate ios-simulator.ts + types file, same API shape | Yes |
| Extend emulator.ts | Add iOS support into existing emulator module | |
| Generic device manager | Abstract emulator/simulator into one module | |

**User's choice:** Mirror emulator.ts pattern (auto-selected: recommended default)
**Notes:** iOS and Android have fundamentally different boot/shutdown mechanisms. Separate modules keep each clean.

---

## UAT Runner Platform Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Config-driven (mobile_platform) | Add config field to choose platform, default "android" | Yes |
| Auto-detect from environment | Check if Xcode/Android SDK available | |
| Run both platforms | Always test on both if available | |

**User's choice:** Config-driven platform selection (auto-selected: recommended default)
**Notes:** Config-driven is explicit and CI-friendly. Auto-detect would be fragile on dual-platform dev machines.

---

## iOS Build Verifier

| Option | Description | Selected |
|--------|-------------|----------|
| Separate flutter-build-ios.ts | New verifier file for iOS builds | Yes |
| Extend flutter-build.ts | Add iOS mode to existing build verifier | |

**User's choice:** Separate iOS build verifier (auto-selected: recommended default)
**Notes:** Follows the established one-file-per-verifier pattern. iOS and Android builds have different artifacts and flags.

---

## Simulator Device Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect newest iPhone | Parse simctl JSON, filter iPhones, sort by runtime | Yes |
| Require explicit config | Always require ios_simulator_device to be set | |
| Interactive prompt | Ask user which simulator to use | |

**User's choice:** Auto-detect available device (auto-selected: recommended default)
**Notes:** Zero-config experience with optional override via config field.

---

## Config Extension

| Option | Description | Selected |
|--------|-------------|----------|
| mobile_platform + ios_simulator_device | Two new fields with sensible defaults | Yes |
| Single mobile_device field | One field that determines both platform and device | |

**User's choice:** Two separate config fields (auto-selected: recommended default)
**Notes:** Separating platform choice from device name keeps each field single-purpose.

---

## Claude's Discretion

- Simulator GUI visibility (headless by default)
- Boot polling interval timing (2s recommended)
- CocoaPods cache warming strategy
- Internal logging verbosity

## Deferred Ideas

- Physical iOS device testing (requires code signing) -- v2+
- Parallel Android + iOS UAT -- v2+
- iOS visual regression testing -- v2+
- TestFlight deployment -- v2+
