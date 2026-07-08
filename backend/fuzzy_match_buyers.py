"""Fuzzy-match the 35 "missing" buyer strings from 2-Sales against ImportFirm rows
already in the DB. Strip prefix conventions (IP, Tel, OcOO, JCJ, Х.О, ТОО, etc.)
and normalize, then score by token overlap on the surname/keyword tail.

Outputs:
  - HIGH-CONFIDENCE matches  (likely same firm, suggest auto-mapping)
  - PROBABLE matches         (likely same, but worth eyeballing)
  - WEAK matches             (might be coincidence)
  - NO MATCH                 (truly new firms)
"""
import os
import re
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from pathlib import Path
from collections import Counter
import openpyxl
from apps.core.models import ImportFirm


# ─── Prefix stripping ─────────────────────────────────────────────────────────

# Common entity-form prefixes that don't carry identity. Order matters
# (longer first so "ТОО" doesn't get partially stripped).
PREFIXES = [
    'individual entrepreneur',
    'sole proprietor',
    'индивидуальный предприниматель',
    'JCJ',  # turkmen: Jiwi Çekleli Jogapkärçilikli
    'OcOO', 'ОсОО',  # russian: ОсОО (limited)
    'ТОО', 'TOO',
    'Х.О', 'X.O', 'HJ', 'H.J',  # turkmen Hojalyk Jemgyýeti
    'LLC', 'OOO', 'ООО',
    'ИП', 'I.P.', 'IP', 'IE', 'IÝ',
    'Telekeçi', 'Telekeci', 'Tel',
    'Mr', 'Mrs', 'ИЭ',
    'PE',  # private entrepreneur
    'ИП',
    'АО',
]


def strip_prefixes(name: str) -> str:
    """Remove leading entity-form prefix words; lowercase; strip punctuation."""
    s = name.strip()
    # Repeat-strip — sometimes "ИП OOO X" has nested prefixes
    changed = True
    while changed:
        changed = False
        for prefix in PREFIXES:
            # Match prefix as a leading word, case-insensitive, followed by space or punctuation
            pattern = rf'^{re.escape(prefix)}[\s.,«»"\'\(\)]+'
            new_s = re.sub(pattern, '', s, flags=re.IGNORECASE)
            if new_s != s:
                s = new_s
                changed = True
    # Lowercase + strip quotes/parens/punct
    s = s.lower()
    s = re.sub(r'[«»"\'\(\)\.,]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def tokenize(s: str) -> set:
    """Words >= 3 chars (skip short noise tokens)."""
    return {w for w in s.split() if len(w) >= 3}


def score(a: str, b: str) -> float:
    """Token-overlap score. 1.0 = full token match, 0.0 = no overlap."""
    ta, tb = tokenize(a), tokenize(b)
    if not ta or not tb:
        return 0.0
    overlap = ta & tb
    if not overlap:
        return 0.0
    # Score = overlap size / min(token count) — punishes "Tursynbayew Nurbek" matching just by "Nurbek"
    return len(overlap) / max(min(len(ta), len(tb)), 1)


# ─── Load Excel buyers ────────────────────────────────────────────────────────

EXCEL = Path('../data/Export_contracts_2025-2026.xlsx').resolve()
wb = openpyxl.load_workbook(EXCEL, read_only=True, data_only=True)
ws = wb['2-Sales']

buyer_counts = Counter()
for row in ws.iter_rows(min_row=2, values_only=True):
    if not row or len(row) < 3:
        continue
    buyer = row[2]
    if buyer and isinstance(buyer, str):
        buyer_counts[buyer.strip()] += 1


# ─── DB firms ─────────────────────────────────────────────────────────────────

db_firms = list(ImportFirm.objects.values('id', 'name_short', 'name_company', 'code'))

# Build a lookup: normalized stripped name → firm
db_index = []
for f in db_firms:
    for name_source in ('name_short', 'name_company', 'code'):
        v = f.get(name_source)
        if v:
            stripped = strip_prefixes(v)
            if stripped:
                db_index.append((f['id'], name_source, v, stripped))


# ─── Find buyers not exactly in DB ────────────────────────────────────────────

# Set of normalized strings that DO match the DB
db_norm_set = {stripped for _, _, _, stripped in db_index}

missing_buyers = [b for b in buyer_counts if strip_prefixes(b) not in db_norm_set]
print(f'Buyer strings in 2-Sales not directly in DB: {len(missing_buyers)}')

# ─── Fuzzy match each missing buyer to best DB candidate ──────────────────────

results = []  # (score, buyer_string, count, best_match_db_id, db_name)
for buyer in missing_buyers:
    stripped = strip_prefixes(buyer)
    best_score = 0.0
    best_match = None
    for fid, source, orig_name, db_stripped in db_index:
        s = score(stripped, db_stripped)
        if s > best_score:
            best_score = s
            best_match = (fid, source, orig_name, db_stripped)
    results.append((best_score, buyer, buyer_counts[buyer], best_match))

# Sort by row count desc to put highest-impact first
results.sort(key=lambda r: -r[2])

# Bucket
high = [r for r in results if r[0] >= 0.5]
weak = [r for r in results if 0 < r[0] < 0.5]
none = [r for r in results if r[0] == 0]

def render(b: tuple, score_label=None):
    score, buyer, count, match = b
    rows_label = f'{count:>4} rows'
    if match:
        fid, source, orig_name, _ = match
        return f'  {rows_label}  |  {buyer!r:<40}  ≈  {orig_name!r}  (firm #{fid} via {source}, score {score:.2f})'
    return f'  {rows_label}  |  {buyer!r:<40}  →  no candidate'

print(f'\n=== HIGH-confidence matches  (score >= 0.50) — {len(high)} buyers, {sum(r[2] for r in high)} rows ===')
for r in high:
    print(render(r))

print(f'\n=== WEAK matches  (0 < score < 0.50) — {len(weak)} buyers, {sum(r[2] for r in weak)} rows ===')
for r in weak:
    print(render(r))

print(f'\n=== NO match  — {len(none)} buyers, {sum(r[2] for r in none)} rows ===')
for r in none:
    print(render(r))
