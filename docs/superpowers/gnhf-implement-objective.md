# GNHF Overnight Objective — Implement Roadmap Features

You are running unattended overnight via gnhf. Your job is to **implement code** for roadmap features. Each iteration builds one feature end-to-end: write code, test, verify, commit.

## What's already done
- #2 persist-assessments-flyio: **DONE** — `src/lib/phi/` (db.ts, identity.ts, assessment-store.ts), wizard save wired, fly.io Postgres connected
- Deploy: app live at `https://cdst.fly.dev/` (node:22-alpine Docker, standalone output)
- Supabase auth, multi-pharmacy, audit log: all working

## Required reading (do this first)
1. **The roadmap:** `docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` §5
2. **The spec + plan for each feature** in `docs/superpowers/specs/` and `docs/superpowers/plans/`
3. **The actual codebase** under `src/` — read existing patterns before writing
4. **`notes.md`** — shared memory across iterations

## Implementation order (zero-dependency features first)

Work top-down. Each feature must compile (`npx tsc --noEmit`) and build (`npm run build`) before committing.

### Phase 1 — No external services, no new packages
1. **#4 refusal/non-prescribe docs** — add refusal path to wizard, capture reason, include in PDF
2. **#6 differential diagnosis + DermNet** — add DermNet deep-links per ailment in red-flags step
3. **#9 evidence citations** — add citation data to ailment cards, render in PDF/summary
4. **#12 smart-sig auto-suggest** — auto-fill sig from selected Rx dose, remember last-used per ailment (localStorage)
5. **#24 multilingual patient instructions** — FR translations for ailment instructions, language toggle
6. **#5 stop-duplicating-PMS-data** — remove duplicate clinical fields that the PMS owns

### Phase 2 — Needs `react-signature-canvas` (install first)
7. **#3 digital consent capture** — consent checkbox + signature pad on patient step, save consent to phi store
8. **#11 pharmacist e-signature** — signature pad on generate step, bake into PDF

### Phase 3 — Needs Supabase migrations only (no external services)
9. **#22 vaccination workflow** — triage form, consent, lot/expiry, inventory tracking

## Rules per feature
1. Read the spec + plan for the feature
2. Read the relevant existing code under `src/`
3. Implement following existing patterns (server actions in `src/lib/`, components in `src/components/`, types in `src/types/index.ts`)
4. Add ailment data changes to `data/ailments.json` if needed
5. Run `npx tsc --noEmit` — fix any type errors
6. Run `npm run build` — fix any build errors
7. Commit with message: `feat(#N): <short description>`
8. Update `notes.md` checklist

## Progress tracking in notes.md
```
## Implementation progress
- [ ] #4 refusal-non-prescribe-docs
- [ ] #6 differential-diagnosis-dermnet
- [ ] #9 evidence-citations
- [ ] #12 smart-sig-autosuggest
- [ ] #24 multilingual-patient-instructions
- [ ] #5 stop-duplicating-pms-data
- [ ] #3 digital-consent-capture
- [ ] #11 pharmacist-e-signature
- [ ] #22 vaccination-workflow
```

## Hard constraints
- **Code only.** Write under `src/`, `data/`, and `public/` only. Do NOT modify `Dockerfile`, `fly.toml`, `opencode.json`, or deployment config.
- **No external services.** Do NOT call Phaxio, Twilio, Resend, OpenAI, or any paid API. Stub those features behind env flags.
- **Respect the architecture.** PHI → fly.io Postgres (`src/lib/phi/`). Non-PHI → Supabase (`src/lib/supabase/`). Never mix.
- **Follow existing patterns.** Server actions use `"use server"` + `requireAuth()`. Components use shadcn/ui. Types go in `src/types/index.ts`.
- **One feature per commit.** Then move to the next.
- **No caveman.** Write clean, readable code. Comments only where logic is non-obvious.
- **Test what you can.** Add tests to `src/__tests__/` following existing vitest patterns.

## When to stop
Report complete when all Phase 1-3 features are implemented and the checklist is `[x]`. Token/iteration caps may end earlier — the checklist captures where you stopped.
