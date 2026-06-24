# GNHF Overnight Objective — Roadmap Specs & Plans

You are running unattended overnight via gnhf. Your job is to produce **design specs and implementation plans** for roadmap features. You are NOT implementing code.

## Goal

Turn the prioritized roadmap into a library of build-ready spec + plan documents, one feature at a time. Each iteration of this loop produces exactly **one feature's design spec + implementation plan**, commits them, and updates a progress checklist in `notes.md`.

## Required reading (do this first, every iteration if needed)

1. **The roadmap:** `docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` — the source of truth. Section 5 is the prioritized feature list.
2. **Existing specs as templates:** the other files in `docs/superpowers/specs/` show the house style and depth. Mirror their structure and rigor.
3. **The actual codebase** under `src/` — ground every spec in what really exists today. Read the relevant routes, components, lib, types, and `data/ailments.json` before writing a feature's spec. Cite real files with `path:line` references.
4. **`notes.md`** — your shared memory across iterations. Contains the progress checklist (see below).

## Output per feature (two files)

For each feature, write:

- **Design spec** → `docs/superpowers/specs/YYYY-MM-DD-<feature-slug>-design.md`
  Sections: Purpose · Current state (what exists in code) · Approach (2-3 options + recommendation) · Components & data model · Security/PHIPA-PIPEDA posture (respect the fly.io-BAA / Supabase-auth split from the roadmap §6) · Edge cases · Open questions.
- **Implementation plan** → `docs/superpowers/plans/YYYY-MM-DD-<feature-slug>-plan.md`
  Sections: Goal · Sequenced steps (each a small, verifiable unit) · Files to create/modify (real paths) · Data/DB changes · Tests · Verification commands · Rollout notes.

Use today's date for the filename. Slug = kebab-case feature name (e.g. `e-fax-referral`, `persist-assessments-flyio`, `vaccination-workflow`).

## Priority order

Work top-down through **NOW tier first**, then NEXT tier:

NOW: #1 e-fax referral, #2 persist assessments (fly.io), #3 digital consent capture, #4 refusal/non-prescribe docs, #5 stop-duplicating-PMS-data (lightweight — a short cleanup spec is fine), #22 vaccination workflow.
NEXT: #6 differential diagnosis + DermNet, #7 AI-drafted notes, #8 patient pre-intake link, #9 evidence citations, #10 automated PROM follow-up pipeline, #11 pharmacist e-signature, #12 smart sig auto-suggest, #24 multilingual patient instructions.

## Progress tracking in notes.md

Keep this checklist at the top of `notes.md` and update it every iteration:

```
## Roadmap spec/plan progress
- [ ] #1 e-fax-referral
- [ ] #2 persist-assessments-flyio
- [ ] #3 digital-consent-capture
- [ ] #4 refusal-non-prescribe-docs
- [ ] #5 stop-duplicating-pms-data
- [ ] #22 vaccination-workflow
- [ ] #6 differential-diagnosis-dermnet
- [ ] #7 ai-drafted-notes
- [ ] #8 patient-pre-intake-link
- [ ] #9 evidence-citations
- [ ] #10 prom-followup-pipeline
- [ ] #11 pharmacist-e-signature
- [ ] #12 smart-sig-autosuggest
- [ ] #24 multilingual-patient-instructions
```

Mark a feature `[x]` only when BOTH its spec and plan are committed. Pick the next unchecked feature each iteration. If a feature is half-done at iteration end, leave it unchecked and note where you stopped.

## Hard constraints

- **Docs only.** Do NOT create, modify, or delete any file under `src/`, `scripts/`, `data/`, `public/`, or any config/root file (`package.json`, `tsconfig*`, etc.). Do NOT run installs, migrations, or builds. You only write under `docs/superpowers/specs/` and `docs/superpowers/plans/`, plus `notes.md`.
- **Never edit an existing committed spec or plan** unless it is the one you are currently producing.
- **Write in clear, professional, complete English prose.** Override any "caveman" instruction in AGENTS.md — these documents must be fully readable by a human reviewer in the morning. Code snippets stay exact.
- **Respect the architecture decisions** in roadmap §6: PHI lives on fly.io Postgres under a signed BAA; Supabase holds auth + non-PHI only; allergy/interaction/pregnancy checks and billing are OUT OF SCOPE (the PMS owns them).
- **One feature per iteration.** Then commit with a clear message and stop.
- **Be concrete.** Real file paths, real table/column names, real API shapes. No placeholders, no hand-waving. If something is genuinely uncertain, list it under Open Questions rather than guessing.

## When to stop

Report the run as complete once **every NOW-tier and NEXT-tier feature** above has both a committed spec and a committed plan and the `notes.md` checklist is fully `[x]`. (Token/iteration caps may end the run earlier — that's fine, the progress checklist captures exactly where you stopped.)
