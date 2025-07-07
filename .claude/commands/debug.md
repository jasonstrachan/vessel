# CRITICAL WORKFLOW: BUG FIXING

You are tasked with fixing: $ARGUMENTS

## MANDATORY SEQUENCE:
1.  **REPRODUCE & UNDERSTAND:** "Let me reproduce and deeply understand the bug before planning the fix."
2.  **PLAN & DIAGNOSE:** Present a detailed plan for diagnosis and the fix, including root cause analysis with todos in `/docs/plan.md`
3.  **IMPLEMENT & VERIFY:** Execute the fix with rigorous validation and manual testing.
4. **DOCUMENT ISSUE, THE FIX AND REFLECT** In docs/ISSUES.md

*For complex bugs, say: "Let me ultrathink about the root cause and architectural implications before proposing a solution."*
*For issues with independent parts, say: "I'll spawn agents to tackle different aspects of this bug."*

**Consult `/CLAUDE.md` IMMEDIATELY and follow it EXACTLY.**

---

## CRITICAL REQUIREMENTS & STANDARDS:

* **HOOKS ARE WATCHING:** `smart-lint.sh` blocks operations, tracks violations, and prevents commits until all issues are fixed.
* **COMPLETION IS NON-NEGOTIABLE:**
    * ALL linters (golangci-lint, max strictness) must pass with zero warnings.
    * ALL manual tests must pass, with new manual tests covering the bug and preventing regressions.
    * The bug must be fully resolved and the feature working end-to-end.
    * No placeholders, TODOs, or compromises.

---
