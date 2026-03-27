# Sprint Status

Check current progress against the sprint plan.

## Checks

```bash
# Backend health
python manage.py check
python manage.py showmigrations | grep "\[ \]"
python manage.py test --verbosity=0

# Frontend health
npm run type-check
npm run lint

# Models created
grep -rn "class.*models.Model" apps/ | wc -l

# API endpoints registered
python manage.py show_urls 2>/dev/null | grep "api/v1" || echo "install django-extensions for show_urls"

# React pages created
find frontend/src/pages -name "*.tsx" 2>/dev/null | sort

# Mock data files
find frontend/src/mock -name "*.ts" 2>/dev/null | sort
```

## Report format
- Current sprint and week
- Models: created / planned for this sprint
- API endpoints: created / planned
- Pages: created / planned
- Tests: passing / total
- Blockers or risks
