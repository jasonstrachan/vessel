# CRITICAL WORKFLOW: NEW FEATURE

You are tasked with implementing: $ARGUMENTS

## MANDATORY SEQUENCE:
1.  **RESEARCH FIRST:** "Let me research the `/docs` and codebase and create a plan before implementing."
2.  **PLAN:** Present a detailed plan with todos in /docs/plan.md and verify approach.
3.  **IMPLEMENT:** Execute with validation checkpoints.
4.  **DOCUMENT** Document what was built in /docs/project.md. do not make a new section unless necessary.

*For complex tasks, say: "Let me ultrathink about this architecture before proposing a solution."*
*For independent task parts, say: "I'll spawn agents to tackle different aspects of this problem."*

**Consult `/CLAUDE.md` IMMEDIATELY and follow it EXACTLY.**

---

## CRITICAL REQUIREMENTS & STANDARDS:

* **HOOKS ARE WATCHING:** `smart-lint.sh` blocks operations, tracks violations, and prevents commits until all issues are fixed.
* **COMPLETION IS NON-NEGOTIABLE:**
    * ALL linters (golangci-lint, max strictness) must pass with zero warnings.
    * ALL manual tests must pass with meaningful business logic coverage.
    * Feature must be fully implemented and working end-to-end.
    * No placeholders, TODOs, or compromises.

---

