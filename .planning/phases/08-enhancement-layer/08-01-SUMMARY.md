---
phase: 08-enhancement-layer
plan: 01
subsystem: requirements
tags: [requirements-gathering, markdown-parsing, compliance-detection, sdk-integration]

# Dependency graph
requires:
  - phase: 01-sdk-proof-of-concept
    provides: executeQuery wrapper and ForgeQueryOptions interface
  - phase: phase-3
    provides: ForgeConfig schema and type definitions
provides:
  - Requirement, ComplianceFlags, GatherResult type definitions
  - parseRequirementsOutput for structured markdown extraction
  - detectComplianceFlags for SOC2/HIPAA/GDPR/PCI-DSS/WCAG detection
  - formatRequirementsDoc for REQUIREMENTS.md generation
  - gatherRequirements entry point with injectable executeQuery
  - buildRequirementsPrompt covering 8 categories and 25+ topics
affects: [08-02 (UAT runner uses requirements), 08-03 (Notion docs), 08-04 (integration)]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-function-parser, keyword-compliance-detection, injectable-sdk-query, round-trip-markdown]

key-files:
  created:
    - src/requirements/types.ts
    - src/requirements/parser.ts
    - src/requirements/gatherer.ts
    - src/requirements/index.ts
    - src/requirements/gatherer.test.ts
  modified: []

key-decisions:
  - "Parser uses regex-based ## R{N}: header splitting for robust markdown extraction"
  - "Compliance detection uses case-insensitive keyword matching across all text fields"
  - "gatherRequirements accepts injectable executeQueryFn for testability"
  - "formatRequirementsDoc output is round-trip compatible with parseRequirementsOutput"

patterns-established:
  - "Pure function parser: parseRequirementsOutput takes string, returns typed array -- no I/O"
  - "Keyword compliance detection: flat keyword lists per flag, case-insensitive, extensible"
  - "Round-trip markdown: formatted output can be re-parsed to identical structured data"

requirements-completed: [REQ-01, REQ-02, REQ-03, REQ-04]

# Metrics
duration: 4min
completed: 2026-03-05
---

# Phase 8 Plan 1: Requirements Gatherer Summary

**Requirements gathering module with 8-category prompt, markdown parser, 5-framework compliance detection, and round-trip REQUIREMENTS.md formatter (35 tests)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-05T16:10:20Z
- **Completed:** 2026-03-05T16:14:21Z
- **Tasks:** 2
- **Files created:** 5

## Accomplishments
- Built complete `src/requirements/` module with types, parser, gatherer, and index
- Parser correctly extracts structured Requirement[] from markdown with ## R{N} headers
- Compliance detector finds SOC 2, HIPAA, GDPR, PCI DSS, WCAG keywords across all requirement fields
- Formatter produces REQUIREMENTS.md that round-trips through the parser identically
- 35 unit tests covering all functions, edge cases, and mocked SDK integration

## Task Commits

Each task was committed atomically:

1. **Task 1: Define requirements types and implement parser/compliance/formatter** - `f0abd89` (feat)
2. **Task 2: Implement gatherer, index, and unit tests** - `22c50fd` (feat)

## Files Created/Modified
- `src/requirements/types.ts` - Requirement, ComplianceFlags, GatherResult, RequirementCategory types
- `src/requirements/parser.ts` - parseRequirementsOutput, detectComplianceFlags, formatRequirementsDoc pure functions
- `src/requirements/gatherer.ts` - gatherRequirements entry point and buildRequirementsPrompt (8 categories, 25+ topics)
- `src/requirements/index.ts` - Public API re-exports
- `src/requirements/gatherer.test.ts` - 35 unit tests (679 lines) covering all functions

## Decisions Made
- Parser uses regex-based `## R{N}:` header splitting for robust markdown extraction even with varied formatting
- Compliance detection uses case-insensitive keyword matching across description, acceptance criteria, edge cases, security, and performance fields
- gatherRequirements accepts injectable executeQueryFn parameter for testability (same pattern as step-runner)
- formatRequirementsDoc output is verified round-trip compatible with parseRequirementsOutput via explicit test

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Requirements module complete and tested, ready for integration with CLI init command
- UAT runner (Plan 02) can use Requirement types for workflow extraction
- Notion docs (Plan 03) can use formatRequirementsDoc for initial page content

## Self-Check: PASSED

All 5 created files verified on disk. Both commit hashes (f0abd89, 22c50fd) found in git log.

---
*Phase: 08-enhancement-layer*
*Completed: 2026-03-05*
