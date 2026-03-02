# Contributing to Piveo

Thanks for your interest in contributing to Piveo.

## License and DCO

By submitting a pull request, you agree your contribution is licensed under `AGPL-3.0-or-later`.

## Workflow

1. Fork the repo and create a feature branch.
2. Keep changes focused and small.
3. Run validation locally:
   - `npm run build`
   - `npm test`
4. Open a PR using the template.

## Fast Lane vs RFC Lane

`Fast Lane` (direct PR):
- Bug fixes
- Documentation improvements
- Small UI polish without API/data model changes

`RFC Lane` (issue first, then PR):
- API contract changes
- Data schema or persistence behavior changes
- Workflow-breaking UI/UX changes
- Security-sensitive architecture changes

For RFC items, open a feature issue first and wait for maintainer alignment.

## Coding Expectations

- Follow existing code style and naming.
- Avoid broad refactors in the same PR.
- Preserve backward compatibility unless explicitly approved.
- Add or update tests for behavior changes.

## Pull Request Checklist

- [ ] Scope is clear and minimal
- [ ] Build passes
- [ ] Tests pass
- [ ] Docs updated (if behavior changed)
- [ ] No secrets/tokens included
