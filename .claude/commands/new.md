# CRITICAL WORKFLOW: NEW FEATURE

You are tasked with implementing: $ARGUMENTS

## MANDATORY SEQUENCE:
1.  **RESEARCH FIRST:** "Let me research the `/docs` and codebase and create a plan before implementing."
2.  **PLAN:** Present a detailed plan with todos and verify approach.
3.  **IMPLEMENT:** Execute with validation checkpoints.

*For complex tasks, say: "Let me ultrathink about this architecture before proposing a solution."*
*For independent task parts, say: "I'll spawn agents to tackle different aspects of this problem."*

**Consult `~/.claude/CLAUDE.md` IMMEDIATELY and follow it EXACTLY.**

---

## CRITICAL REQUIREMENTS & STANDARDS:

* **HOOKS ARE WATCHING:** `smart-lint.sh` blocks operations, tracks violations, and prevents commits until all issues are fixed.
* **COMPLETION IS NON-NEGOTIABLE:**
    * ALL linters (golangci-lint, max strictness) must pass with zero warnings.
    * ALL manual tests must pass with meaningful business logic coverage.
    * Feature must be fully implemented and working end-to-end.
    * No placeholders, TODOs, or compromises.

---

## WORKFLOW CHECKPOINTS:
* **Every 3 file edits:** Run linters; fix failures immediately.
* **After each component:** Validate functionality.
* **Before "done":** Run full manual test suite.
* **If hooks fail:** STOP and fix immediately.

---

## CODE EVOLUTION & QUALITY:

* Implement NEW solutions directly; DELETE old code when replacing.
* NO migration, compatibility, deprecated methods, or versioned function names.
* Refactor by entirely replacing existing implementations.
* If changing an API, change it universally.
* Follow established codebase patterns and use MAX strictness linters.
* **GO SPECIFICALLY:**
    * NO `interface{}` or `any{}` – use concrete types/well-defined interfaces.
    * Simple, focused interfaces (Interface Segregation Principle).
    * Simple error returns; NO custom error structs unless critical.
    * Avoid unnecessary type assertions/casting.
    * Follow standard Go project layout.
    * NO `time.Sleep()` or busy waits – use channels for synchronization (readiness, completion, state changes).
    * Use `select` with timeout channels for timing.

---

## DOCUMENTATION & APPROACH:
* Reference specific sections of documentation (e.g., Go Memory Model) and include links (Go docs, RFCs, APIs).
* Document *WHY* decisions were made, not just *WHAT* the code does.
* Outline complete solution architecture first.
* Write meaningful tests for business logic; skip trivial tests.
* Benchmark critical paths.

---

## FORBIDDEN:
* Procrastinating linter fixes, clean code, testing, or refactoring.
* Elaborate error type hierarchies, unnecessary reflection, keeping old/transition code.
* Stopping at "mostly working," accepting *any* linter warnings.
* `time.Sleep()` for synchronization, polling with loops.

---

## COMPLETION CHECKLIST (ALL must be ✅):
* [ ] Research phase completed; codebase understood.
* [ ] Plan reviewed; approach validated.
* [ ] ALL linters pass with ZERO warnings.
* [ ] ALL manual tests pass (including race detection where applicable).
* [ ] Feature works end-to-end.
* [ ] Old/replaced code DELETED.
* [ ] Documentation/comments complete.
* [ ] Reality checkpoints performed regularly.
* [ ] NO TODOs, FIXMEs, or "temporary" code.
* [ ] Update TODOS and document new features in `/docs`.

---

**STARTING NOW** with research phase to understand the codebase...

(Remember: The hooks will verify everything. No excuses. No shortcuts.)