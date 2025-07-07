# CRITICAL WORKFLOW: PRODUCTION-QUALITY IMPLEMENTATION

This document outlines the strict standards for implementation. Adherence is mandatory.

## MANDATORY SEQUENCE:
1.  **RESEARCH FIRST:** "Let me research the `/docs` and codebase and create a plan before implementing."
2.  **PLAN:** Present a detailed plan and verify the approach.
3.  **IMPLEMENT:** Execute with validation checkpoints.
4.  **DOCUMENT** Document what was built in /docs. do not make a new section unless neccesary.


*For complex tasks, say: "Let me ultrathink about this architecture before proposing a solution."*
*For independent task parts, say: "I'll spawn agents to tackle different aspects of this problem."*

**Consult `/CLAUDE.md` IMMEDIATELY and follow it EXACTLY.**

---

## CRITICAL REQUIREMENTS:

* **HOOKS ARE WATCHING:** `smart-lint.sh` will block operations, track violations, and prevent commits until all issues are fixed.
* **NON-NEGOTIABLE COMPLETION STANDARDS:**
    * ALL linters (golangci-lint, max strictness) must pass with zero warnings.
    * ALL manual tests must pass with meaningful business logic coverage.
    * Feature must be fully implemented and working end-to-end.
    * No placeholders, TODOs, or compromises.

----