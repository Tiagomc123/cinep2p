# Repository Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep runtime data, local credentials, generated files, and backup copies from appearing as pending source files in Git.

**Architecture:** Extend the existing `.gitignore` with explicit patterns for known local artifacts. Do not move or delete project data as part of this task.

**Tech Stack:** Git ignore patterns.

**Spec:** `docs/superpowers/specs/2026-10-25-cinep2p-otimizacao-design.md`

## Global Constraints

- Preserve `.env.example` and all tracked source files.
- Keep local `.env`, certificate material, runtime data, cache, and downloads on disk.
- Do not add or run tests; verify ignore matches and inspect Git status only.
- Backup file deletion is still subject to the existing automatic review block and is not performed by this plan.

## Review Focus

- Local `.env` and dated `.env` backups remain ignored.
- Dated `.bak` and `.backup` files and `.backup-*` folders are ignored.
- `.env.example`, source, tests, and documentation remain trackable.
- Cache, data, certificates, and downloads remain present on disk.
- Ignore patterns do not hide ordinary source files with similar names.

---

### Task 1: Ignore local artifacts and backup copies

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- No application code changes.

- [x] Add root-anchored ignore patterns for `.cache/`, `data/`, `downloads/`, `certs/`, debug text dumps, `init.mp4`, `.backup-*` folders, `*.bak-*`, `*.backup-*`, and `.env.bak-*`.
- [x] Confirm `.env.example` and tracked source paths are not ignored using `git check-ignore` on representative paths.
- [x] Confirm existing local data directories still exist and inspect `git status --short --branch`.
- [x] Run `git diff --check`.
