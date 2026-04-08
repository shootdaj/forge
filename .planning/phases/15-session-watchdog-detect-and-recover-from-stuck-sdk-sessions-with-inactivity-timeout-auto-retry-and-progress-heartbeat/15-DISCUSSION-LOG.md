# Phase 15: Session Watchdog - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 15-session-watchdog
**Areas discussed:** Timeout Architecture, Heartbeat Output, Retry Behavior, State Integration
**Mode:** Auto (--auto flag)

---

## Timeout Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Step runner layer wrapping executeQuery | Keeps query-wrapper focused on SDK protocol, step-runner handles retries | [auto] |
| Modify processQueryMessages in query-wrapper | Lower level, closer to the stream | |
| Separate watchdog module | More modular but adds indirection | |

**User's choice:** [auto] Step runner layer wrapping executeQuery (recommended default)
**Notes:** Step runner already handles budget checks and verification -- watchdog is a natural extension at this layer.

---

## Heartbeat Output

| Option | Description | Selected |
|--------|-------------|----------|
| [forge] Ns since last activity... (step: NAME) | Consistent with existing [forge] prefix pattern | [auto] |
| Progress spinner/bar | More visual but may conflict with SDK output | |
| Structured JSON heartbeats | Machine-readable but less human-friendly | |

**User's choice:** [auto] [forge] prefix format (recommended default)
**Notes:** Matches existing console.log pattern in query-wrapper.ts.

---

## Retry Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Fresh context with timeout note | Clean slate, less likely to repeat stuck behavior | [auto] |
| Resume with conversation history | More context but may repeat the same stuck pattern | |
| Escalate to different model | Expensive, adds complexity | |

**User's choice:** [auto] Fresh context with timeout note (recommended default)
**Notes:** Separate from cascade retry mechanism which handles verification failures.

---

## State Integration

| Option | Description | Selected |
|--------|-------------|----------|
| last_heartbeat timestamp in forge-state.json | Minimal, lets external tools monitor liveness | [auto] |
| Full watchdog state section | More data but overkill for current needs | |

**User's choice:** [auto] last_heartbeat timestamp (recommended default)
**Notes:** Simple ISO timestamp updated on each heartbeat.

---

## Claude's Discretion

- Timer mechanism implementation details (setInterval vs setTimeout race)
- Exact retry prompt wording
- Session termination method (AbortController.abort() vs process kill)

## Deferred Ideas

None -- discussion stayed within phase scope.
