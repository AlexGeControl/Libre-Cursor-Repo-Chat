# Context Document Lifecycle

> Read this **before** editing any of `PLAN.md`, `PHASE*.md`, or
> `ARCHITECTURE.md`. This file is the operating guide for how project
> context is organized in this repo.

## Why this exists

Projects that span many sessions accumulate stale instructions, dead
plans, and "current architecture" docs that describe last month's
system. We avoid this by giving each kind of context **one home** with
a **clear lifecycle**, and by being explicit about which document is
live and which is frozen.

## The four context documents

| Doc                    | Role                                       | Lifecycle          |
|------------------------|--------------------------------------------|--------------------|
| `CLAUDE.md`            | Stable agent operating manual              | Rarely changes     |
| `docs/PLAN.md`         | Overarching plan: one short section/phase  | Pruned each phase  |
| `docs/PHASE[N].md`     | Per-phase deep dive: intent + findings     | Live during N, frozen after |
| `docs/ARCHITECTURE.md` | How the current system actually works      | Ratcheted forward each phase |

Note the asymmetry: **PLAN.md is pruned (gets shorter), ARCHITECTURE.md
is ratcheted (only grows when reality changes).** They feel symmetric
but are not.

## What goes where

**`CLAUDE.md`** — rules of the road for any Claude session: mission,
constraints, conventions, "read these first" pointers. **No task lists,
no phase plans.** If you'd put a date on it, it doesn't belong here.

**`docs/PLAN.md`** — *what we intend to do*. One paragraph mission, then
one short section per phase: goal, status (planned / in-flight / done),
one-line summary, link to the phase doc. Sections of completed phases
collapse to a single bullet + link.

**`docs/PHASE[N].md`** — *the story of phase N*: original goal, what we
tried, what worked, what didn't, lessons learned, critical design
choices. This is the file you write during the phase. It is the
narrative — the engineering log — for that slice of work.

**`docs/ARCHITECTURE.md`** — *how it works right now*: diagram, service
surface, operational gotchas a reader needs to operate the system
today. No history, no rationale-with-dates, no "open questions." If a
reader trying to run `docker compose up` would care about it, it
belongs here.

## The three-phase loop per phase

1. **Start of phase N.** `PHASE[N].md` already exists as the handoff
   drafted at the end of phase N-1. From now until the phase ends, it
   is the working doc. `PLAN.md` and `ARCHITECTURE.md` are read-only
   during this period — don't sprinkle phase-N findings into them
   mid-stream.

2. **During phase N.** Edit `PHASE[N].md` freely. Capture findings,
   surprises, dead ends, and decisions while context is fresh. This is
   the only doc that moves.

3. **End of phase N.** Run these three steps **in order**:

   a. **Polish `PHASE[N].md`.** Distill the engineering log into a
      readable narrative. Critical design choices and lessons learned
      get their own headings. After polish, this doc becomes
      effectively frozen — future phases reference it but do not edit.

   b. **Propagate to `PLAN.md` and `ARCHITECTURE.md`.** Two different
      flows:
      - `PLAN.md` update is **status propagation**: mark phase N done,
        collapse its section to a one-line summary + link to
        `PHASE[N].md`. Nothing new flows in.
      - `ARCHITECTURE.md` update is **the ratchet**: extract
        operational knowledge from `PHASE[N].md` — patches still
        load-bearing, env vars still required, gotchas still
        relevant — and rewrite them in *manual form*, not narrative
        form. Phase-doc says *"we discovered X by hitting Y"*; arch-doc
        says *"X is required; configure it like Z."* Same fact, two
        framings, two homes.

   c. **Draft `PHASE[N+1].md`.** Hand-off doc: goal of the next phase,
      open questions inherited from N, anything from N that pushed the
      problem rather than solved it. Don't fill in detail — that's for
      phase N+1 to do. A scaffold is enough.

## Cross-linking conventions

- `PLAN.md` links **down** to each `PHASE[N].md` for depth.
- `PHASE[N].md` links **up** to `PLAN.md` (macro context) and **across**
  to `ARCHITECTURE.md` ("if you want to operate this today").
- `ARCHITECTURE.md` links **back** to the `PHASE[N].md` that introduced
  any non-obvious operational requirement, so a curious reader can find
  the rationale without it bloating the manual.
- `CLAUDE.md` links to `PLAN.md` and `CONTEXT.md` (this file) so future
  Claude sessions find the system on first read.

## Anti-patterns

- **Updating `PLAN.md` mid-phase with phase-specific detail.** Detail
  belongs in `PHASE[N].md`. PLAN.md only changes at phase boundaries.
- **Treating `ARCHITECTURE.md` as a changelog.** It's a manual. If
  history matters, link to the PHASE doc.
- **Letting `PHASE[N].md` describe how the system runs today.** It
  describes how the system *got* this way. Operational facts must also
  be in `ARCHITECTURE.md` or they will be lost when N becomes ancient.
- **Skipping the ratchet step.** If you polish `PHASE[N].md` but don't
  pull its operational findings into `ARCHITECTURE.md`, the arch doc
  silently goes stale. The ratchet is the work, not the polish.
- **Phase docs without a phase.** If the work is one PR, it doesn't
  need a phase doc. Phases are for multi-session arcs.

## Quick reference: starting a session

1. Read `CLAUDE.md` for project rules.
2. Read `docs/PLAN.md` to find the current phase.
3. Read the current `PHASE[N].md` to see in-flight state.
4. Read `docs/ARCHITECTURE.md` only if you need to operate the system
   (run it, debug it, extend it).

Past phase docs (`PHASE0.md`, `PHASE1.md`, …) are read on demand, when
a current question references them or when investigating why a design
choice was made.
