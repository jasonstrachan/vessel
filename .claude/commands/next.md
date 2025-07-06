# CRITICAL WORKFLOW: PRODUCTION-QUALITY IMPLEMENTATION

This document outlines the strict standards for implementation. Adherence is mandatory.

## MANDATORY SEQUENCE:
1.  **RESEARCH FIRST:** "Let me research the `/docs` and codebase and create a plan before implementing."
2.  **PLAN:** Present a detailed plan and verify the approach.
3.  **IMPLEMENT:** Execute with validation checkpoints.

*For complex tasks, say: "Let me ultrathink about this architecture before proposing a solution."*
*For independent task parts, say: "I'll spawn agents to tackle different aspects of this problem."*

**Consult `~/.claude/CLAUDE.md` IMMEDIATELY and follow it EXACTLY.**

---

## CRITICAL REQUIREMENTS:

* **HOOKS ARE WATCHING:** `smart-lint.sh` will block operations, track violations, and prevent commits until all issues are fixed.
* **NON-NEGOTIABLE COMPLETION STANDARDS:**
    * ALL linters (golangci-lint, max strictness) must pass with zero warnings.
    * ALL manual tests must pass with meaningful business logic coverage.
    * Feature must be fully implemented and working end-to-end.
    * No placeholders, TODOs, or compromises.

---

## REALITY CHECKPOINTS (MANDATORY):
* **Every 3 file edits:** Run linters.
* **After each component:** Validate functionality.
* **Before "done":** Run full manual test suite.
* **If hooks fail:** STOP and fix immediately.

---

## CODE EVOLUTION RULES:
* Implement NEW solutions directly on this feature branch.
* DELETE old code when replacing functionality (no keeping both versions).
* NO migration functions, compatibility layers, deprecated methods, or versioned function names.
* Refactor by entirely replacing existing implementations.
* If changing an API, change it universally.

---

## LANGUAGE-SPECIFIC QUALITY REQUIREMENTS:

### ALL LANGUAGES:
* Follow established codebase patterns.
* Use language-appropriate linters at MAX strictness.
* Delete old code when replacing.
* No compatibility shims.

### GO SPECIFICALLY:
* NO `interface{}` or `any{}` – use concrete types or well-defined interfaces.
* Simple, focused interfaces (Interface Segregation Principle).
* Simple error returns or established patterns (NO custom error structs unless critical).
* Avoid unnecessary type assertions/interface casting.
* Follow standard Go project layout (`cmd/`, `internal/`, `pkg/`).
* NO `time.Sleep()` or busy waits – use channels for synchronization.
* Use channels to signal readiness, completion, or state changes.
* Use `select` with timeout channels instead of sleep loops for timing.

---

## DOCUMENTATION REQUIREMENTS:
* Reference specific sections of relevant documentation (e.g., Go Memory Model).
* Include links to official Go docs, RFCs, or API documentation.
* Document *WHY* decisions were made, not just *WHAT* the code does.
* Dont make any new documents or sections unless there is a VERY good reason

---

## IMPLEMENTATION APPROACH:
1.  Outline complete solution architecture.
2.  When modifying, replace existing code entirely.
3.  Run linters after EVERY file creation/modification; fix failures immediately.
4.  Write meaningful manual tests for business logic; skip trivial tests.
5.  Benchmark critical paths.

---

## FORBIDDEN PROCRASTINATION PATTERNS:
* "I'll fix linters later."
* "Let me get it working first."
* "Good enough for now."
* "Tests can come later."
* "Refactor in a follow-up."

---

## SPECIFIC ANTIPATTERNS TO AVOID:
* Elaborate error type hierarchies.
* Unnecessary reflection.
* Keeping old implementations alongside new.
* "Transition" or "compatibility" code.
* Stopping at "mostly working."
* Accepting ANY linter warnings.
* `time.Sleep()` for synchronization.
* Polling with loops.

---

## COMPLETION CHECKLIST (ALL must be ✅):
* [ ] Research phase completed; codebase understood.
* [ ] Plan reviewed; approach validated.
* [ ] ALL linters pass with ZERO warnings.
* [ ] ALL manual tests pass (including race detection where applicable).
* [ ] Feature works end-to-end in realistic scenarios.
* [ ] Old/replaced code DELETED.
* [ ] Documentation/comments complete.
* [ ] Reality checkpoints performed regularly.
* [ ] NO TODOs, FIXMEs, or "temporary" code.

---

**STARTING NOW with the research phase to understand the codebase...**