# Player Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce repeated status requests while a stream is stalled, while keeping quick updates when playback is progressing.

**Architecture:** Keep the existing status endpoint and player state machine. Adapt only the pre-playback poll delay based on whether downloaded bytes, buffer percentage, or peer count changes; retain the current 2 second interval after playback starts.

**Tech Stack:** Browser JavaScript in `public/app.js`.

**Spec:** `docs/superpowers/specs/2026-10-25-cinep2p-otimizacao-design.md`

## Global Constraints

- Preserve endpoint parameters and playback transitions.
- Keep fast polling at 700 ms when there is progress and current 2000 ms polling after playback starts.
- Back off stalled pre-playback polling to no more than 1800 ms, and reset promptly when progress resumes.
- Do not add or run tests; use syntax and diff checks only.

## Review Focus

- A zero-peer stream must continue polling and eventually update when peers appear.
- Progress in downloaded bytes or buffer must reset the backoff.
- Playback start and error handling must preserve their existing behavior.
- Missing or nonnumeric progress fields must not break the polling loop.
- The timer must not schedule another poll after the job has ended.

---

### Task 1: Back off status polling during stalled startup

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Keep `poll()` and `/api/play/status` unchanged.
- Store only the prior progress snapshot and consecutive stagnant poll count in existing player state.

- [x] Track `downloaded`, `buffer`, and `peers` from the latest status response, normalizing missing values safely.
- [x] Keep the 700 ms interval while any tracked value changes; after 5 consecutive unchanged startup polls, increase delay gradually up to 1800 ms.
- [x] Reset the delay immediately when progress changes or playback becomes available; keep the 2000 ms post-start interval.
- [x] Clear/reset the new polling state when the player job is stopped or replaced.
- [x] Invalidate late torrent lookup and job creation responses after close, page hide, error, or job replacement; stop jobs returned after invalidation.
- [x] Run `node --check public/app.js` and `git diff --check`; inspect transitions for startup, playback, error, and stopped job.
