import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import openpyxl

wb = openpyxl.load_workbook('d:/projects/yigit_platform/data/Export_contracts_2025-2026.xlsx', read_only=True, data_only=True)
ws = wb['2-Sales']

cohort_18k = []
cohort_9k = []

for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    contract = row[0] if len(row) > 0 else None
    if not contract:
        continue
    qty = row[3] if len(row) > 3 else None
    try:
        qty_f = float(qty) if qty else None
    except (ValueError, TypeError):
        qty_f = None

    if qty_f is None:
        continue

    if 8500 <= qty_f <= 9500:
        cohort_9k.append(i)
    elif qty_f > 10000:
        cohort_18k.append(i)

wb.close()

print(f"18k cohort: {len(cohort_18k)} rows, first={cohort_18k[0] if cohort_18k else 'N/A'}, last={cohort_18k[-1] if cohort_18k else 'N/A'}")
print(f"9k cohort:  {len(cohort_9k)} rows, first={cohort_9k[0] if cohort_9k else 'N/A'}, last={cohort_9k[-1] if cohort_9k else 'N/A'}")

if cohort_9k and cohort_18k:
    first_9k = cohort_9k[0]
    last_18k = cohort_18k[-1]
    interleaved_18k = [r for r in cohort_18k if r > first_9k]
    interleaved_9k = [r for r in cohort_9k if r < last_18k]
    print(f"18k rows after first 9k row ({first_9k}): {len(interleaved_18k)}")
    print(f"9k rows before last 18k row ({last_18k}): {len(interleaved_9k)}")

    print("\nRow distribution by band (500-row windows):")
    max_row = max(cohort_18k[-1], cohort_9k[-1])
    for band_start in range(2, max_row + 500, 500):
        band_end = band_start + 499
        n_18k = sum(1 for r in cohort_18k if band_start <= r <= band_end)
        n_9k  = sum(1 for r in cohort_9k  if band_start <= r <= band_end)
        if n_18k or n_9k:
            print(f"  Rows {band_start:5d}-{band_end:5d}: 18k={n_18k:4d}, 9k={n_9k:4d}")
