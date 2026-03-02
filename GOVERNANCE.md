# Piveo Governance

## Project Model

Piveo uses a `Maintainer + Community` model:

- `Maintainer`: final decision maker for roadmap, security, and releases.
- `Triage contributors`: help reproduce issues, apply labels, and route work.
- `Contributors`: open issues/PRs and participate in RFC discussions.

## Decision Lanes

### 1. Fast Lane

For low-risk changes (docs, small bug fixes, UI polish):
- One maintainer review required
- Merge when CI is green

### 2. RFC Lane

For high-impact changes (API/schema/core flow/security):
- Open RFC issue first
- Minimum 48 hours discussion window
- Maintainer approval required before implementation PR

## Release Policy

- Target cadence: weekly patch release window.
- Critical security fixes can be released outside the window.

## Conflict Resolution

- Prefer evidence-based decisions (tests, benchmarks, reproducible cases).
- If consensus is blocked, maintainer makes final call with rationale in the thread.

## Scope of Open Source

Unless explicitly documented otherwise, this repository is fully open under `AGPL-3.0-or-later`.
