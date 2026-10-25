# Cache and Catalog Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound TMDb cache behavior and make catalog warming faster without overlapping cycles or unbounded source load.

**Architecture:** Keep the current in-memory cache and worker. Add bounded expiry/eviction and same-key request sharing to the TMDb client; use the existing `mapLimit` helper for catalog queries and schedule each next cycle only after the current one completes.

**Tech Stack:** Node.js CommonJS, built-in `fetch`, existing `src/util/pool.js`.

**Spec:** `docs/superpowers/specs/2026-10-25-cinep2p-otimizacao-design.md`

## Global Constraints

- No dependency additions or major upgrades.
- Preserve API response shapes, CLI flags, and catalog data.
- Use a conservative worker concurrency default of 2, configurable through `CINE_WORKER_CONCORRENCIA` and bounded to at least 1.
- Do not add or run tests; use syntax and diff checks only.

## Review Focus

- Repeated identical TMDb requests should share in-flight work and return the same result shape.
- Expired cache entries should not be returned, and reaching the cache cap should evict entries gradually rather than clearing all entries.
- A slow catalog cycle must not overlap the next scheduled cycle.
- One failed catalog query must not prevent other queries from being processed.
- `--once` and `--fontes` must keep their existing one-shot behavior.

---

### Task 1: Bound and share TMDb cache entries

**Files:**
- Modify: `src/tmdb.js`

**Interfaces:**
- Preserve all current exports and `request(pathname, params)` return values.
- Keep cache entries internal; use a separate in-flight map keyed by the full request URL.

- [x] Replace the all-entry clear at 600 entries with expiry cleanup and least-recently-used eviction at a fixed cap of 600.
- [x] Deduplicate concurrent calls for the same URL; remove the in-flight entry on success and failure.
- [x] Preserve the 15 minute TTL and ensure rejected requests are not cached.
- [x] Run `node --check src/tmdb.js` and `git diff --check`; inspect the diff for unchanged public response shapes.

### Task 2: Bound catalog worker concurrency and prevent overlapping cycles

**Files:**
- Modify: `worker.js`
- Modify: `src/config.js`
- Modify: `.env.example`

**Interfaces:**
- Consume existing `mapLimit(itens, limite, fn)` from `src/util/pool.js`.
- Preserve `ciclo()`, `--once`, and `--fontes` behavior.

- [x] Add `CINE_WORKER_CONCORRENCIA` config with default `2` and a minimum of `1`, and document it in `.env.example`.
- [x] Convert category/term pairs into independent work items and run them through `mapLimit`; preserve per-query error logging and catalog insertion.
- [x] Replace the repeating interval with a completion-based schedule so a new cycle starts only after the prior cycle finishes.
- [x] Keep one-shot and source-health modes from starting the repeating schedule.
- [x] Run `node --check worker.js`, `node --check src/config.js`, and `git diff --check`; inspect all CLI branches and the cycle scheduling path.
