# Git Conventions

## Monorepo (one repo for everything)

```
ygt-platform/          ← single git repo
  backend/             ← Django
  frontend/            ← React
  database/            ← DDL
  docs/                ← documentation
  .claude/             ← Claude Code config
  docker-compose.yml
```

Frontend and backend in one repo. They share the API contract, deploy together, version together.

## Branching — solo developer rules

Work on `main` for normal features. Small frequent commits are your safety net, not branches.

Use a branch ONLY when:
- Risky experiment that might not work → `experiment/quota-redesign`
- Big refactor touching 10+ files → `refactor/shipment-model-v2`
- Data migration you might need to roll back → `data/import-export-contracts`

```bash
# Normal workflow (90% of the time)
git add . && git commit -m "feat(p3): add shipment list with status filters"

# Risky work (10% of the time)
git checkout -b experiment/new-transition-logic
# ... work ...
# if good:
git checkout main && git merge experiment/new-transition-logic
# if bad:
git checkout main && git branch -D experiment/new-transition-logic
```

## Commit messages (Conventional Commits)

Format: `type(scope): short description`

```
Types:   feat, fix, refactor, test, docs, chore, data
Scopes:  p3, p4, p2, p5, p1, core, frontend, docker, db
```

Examples:
```
feat(p3): add shipment list page with status filters
feat(frontend): add StatusTag and WeightDisplay shared components
fix(core): correct Cyrillic collation on ExportFirm.name
data(p3): import 1,959 shipments from Export_contracts.xlsx
refactor(p3): extract transition logic to services.py
test(p3): add status transition validation tests (12 tests)
docs: update ADR with AD-14 comments threading decision
db: apply DDL v5.1 patch — add timestamp columns to shipments
chore(docker): update MSSQL image to 2022-latest
```

Commit often — every 30-60 minutes of working code, or after each logical step.

## Pushing to GitHub

Remote: `https://github.com/Jasurbek99/yigit_platform.git` (branch `main`)

```bash
# Push after committing
git push

# First push on a new branch
git push -u origin <branch-name>
```

Push after every feature or at end of day — never let local commits pile up.

## Before committing

```bash
python manage.py test apps.export --verbosity=0    # backend tests pass
npm run type-check                                  # no TypeScript errors
python manage.py makemigrations --check             # no pending migrations
```

Skip these for docs-only or config-only commits.

## CHANGELOG.md

Lives at project root. Claude MUST update this after every feature or fix.
Follow the format already in `CHANGELOG.md` — Keep-a-Changelog style, newest section on top.

Rules for CHANGELOG:
- **Added** for new features/pages/components
- **Changed** for modifications to existing code/schema
- **Fixed** for bug fixes
- **Data** for import/migration operations
- Move items from `[Unreleased]` to a versioned section when a sprint completes
- Keep entries short — one line per change, reference the commit type
- Claude writes the CHANGELOG entry as the LAST step after committing code