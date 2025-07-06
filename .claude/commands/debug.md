# CRITICAL WORKFLOW: BUG FIXING

You are tasked with fixing: $ARGUMENTS

## MANDATORY SEQUENCE:
1.  **REPRODUCE & UNDERSTAND:** "Let me reproduce and deeply understand the bug before planning the fix."
2.  **PLAN & DIAGNOSE:** Present a detailed plan for diagnosis and the fix, including root cause analysis.
3.  **IMPLEMENT & VERIFY:** Execute the fix with rigorous validation and manual testing.
4. **DOCUMENT ISSUE, THE FIX AND REFLECT** In docs/04_issues/

*For complex bugs, say: "Let me ultrathink about the root cause and architectural implications before proposing a solution."*
*For issues with independent parts, say: "I'll spawn agents to tackle different aspects of this bug."*

**Consult `~/.claude/CLAUDE.md` IMMEDIATELY and follow it EXACTLY.**

---

## CRITICAL REQUIREMENTS & STANDARDS:

* **HOOKS ARE WATCHING:** `smart-lint.sh` blocks operations, tracks violations, and prevents commits until all issues are fixed.
* **COMPLETION IS NON-NEGOTIABLE:**
    * ALL linters (golangci-lint, max strictness) must pass with zero warnings.
    * ALL manual tests must pass, with new manual tests covering the bug and preventing regressions.
    * The bug must be fully resolved and the feature working end-to-end.
    * No placeholders, TODOs, or compromises.

---

## WORKFLOW CHECKPOINTS:
* **Initial:** Clearly define bug type, severity, and reproducibility.
* **After every 3 file edits:** Run linters; fix failures immediately.
* **After fixing each component:** Validate functionality; confirm bug no longer reproduces.
* **Before "done":** Run FULL manual test suite (including regression tests).
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
* Document *WHY* decisions were made and the identified root cause, not just *WHAT* the code does.
* Outline complete solution architecture for the fix first.
* Write meaningful manual tests for the bug and related business logic; skip trivial tests.
* Benchmark critical paths, especially if performance was affected by the bug.

---

## FORBIDDEN:
* Procrastinating linter fixes, clean code, testing, or refactoring.
* Elaborate error type hierarchies, unnecessary reflection, keeping old/transition code.
* Stopping at "mostly working," accepting *any* linter warnings.
* `time.Sleep()` for synchronization, polling with loops.
* Introducing new bugs with the fix.

---

## COMPLETION CHECKLIST (ALL must be ✅):
* [ ] Bug reproduced; root cause identified and understood.
* [ ] Plan reviewed; approach validated.
* [ ] ALL linters pass with ZERO warnings.
* [ ] ALL manual tests pass (including race detection where applicable and new regression tests).
* [ ] Bug is fully resolved and does not reoccur.
* [ ] Old/replaced code DELETED.
* [ ] Documentation/comments complete, explaining the bug and fix.
* [ ] Reality checkpoints performed regularly.
* [ ] NO TODOs, FIXMEs, or "temporary" code.
* [ ] Update TODOS and document bug fix details/impact in `/docs`.

---

**STARTING NOW** with reproduction and understanding the bug...

(Remember: The hooks will verify everything. No excuses. No shortcuts.)