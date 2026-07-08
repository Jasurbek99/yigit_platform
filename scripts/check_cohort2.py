import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import openpyxl
from collections import Counter

wb = openpyxl.load_workbook('d:/projects/yigit_platform/data/Export_contracts_2025-2026.xlsx', read_only=True, data_only=True)
ws = wb['2-Sales']

# Col indices (0-based):
# A=0 row_num, B=1 seller, C=2 buyer, D=3 contract, E=4 invoice_date,
# F=5 total_trucks, G=6 serial_no, H=7 inv_no, I=8 incoterm,
# J=9 quantity_kg, K=10 price_usd, L=11 truck_plate, M=12 passport_sdelka, N=13 scan

cohort_large = []  # qty > 10000
cohort_small = []  # qty <= 10000 and > 0

qty_samples = []
contracts_by_row = []

for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    contract = row[3] if len(row) > 3 else None
    if not contract:
        continue
    qty = row[9] if len(row) > 9 else None
    serial = row[6] if len(row) > 6 else None
    total_t = row[5] if len(row) > 5 else None

    try:
        qty_f = float(qty) if qty is not None else None
    except (ValueError, TypeError):
        qty_f = None

    if qty_f is None:
        continue

    if i <= 30:
        qty_samples.append((i, contract, qty_f, serial, total_t))

    if qty_f > 10000:
        cohort_large.append(i)
    elif qty_f > 0:
        cohort_small.append(i)

wb.close()

print(f"Large qty cohort (>10k): {len(cohort_large)} rows, first={cohort_large[0] if cohort_large else 'N/A'}, last={cohort_large[-1] if cohort_large else 'N/A'}")
print(f"Small qty cohort (0-10k): {len(cohort_small)} rows, first={cohort_small[0] if cohort_small else 'N/A'}, last={cohort_small[-1] if cohort_small else 'N/A'}")

print("\nSample qty values:")
for r in qty_samples[:15]:
    print(f"  row={r[0]}, contract={r[1][:30] if r[1] else None}, qty={r[2]}, serial={r[3]}, total_t={r[4]}")

if cohort_small and cohort_large:
    first_small = cohort_small[0]
    last_large = cohort_large[-1]
    interleaved_large = sum(1 for r in cohort_large if r > first_small)
    interleaved_small = sum(1 for r in cohort_small if r < last_large)
    print(f"\nLarge-qty rows after first small-qty row ({first_small}): {interleaved_large}")
    print(f"Small-qty rows before last large-qty row ({last_large}): {interleaved_small}")

    print("\nRow distribution by band (1000-row windows):")
    max_row = max(cohort_large[-1], cohort_small[-1])
    for band_start in range(2, max_row + 1000, 1000):
        band_end = band_start + 999
        n_lg = sum(1 for r in cohort_large if band_start <= r <= band_end)
        n_sm = sum(1 for r in cohort_small if band_start <= r <= band_end)
        if n_lg or n_sm:
            print(f"  Rows {band_start:5d}-{band_end:5d}: large={n_lg:4d}, small={n_sm:4d}")
