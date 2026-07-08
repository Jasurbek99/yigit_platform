import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import openpyxl
from collections import Counter

wb = openpyxl.load_workbook('d:/projects/yigit_platform/data/Export_contracts_2025-2026.xlsx', read_only=True, data_only=True)
ws = wb['2-Sales']

# Small qty rows: qty <= 10000 and > 0
small_qtys = Counter()
small_contracts = Counter()
small_serial_nulls = 0
small_serial_set = 0
small_samples = []

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

    if qty_f is None or qty_f > 10000 or qty_f <= 0:
        continue

    small_qtys[qty_f] += 1
    small_contracts[contract] += 1
    if serial is None:
        small_serial_nulls += 1
    else:
        small_serial_set += 1

    if len(small_samples) < 10:
        small_samples.append((i, contract[:40] if contract else None, qty_f, serial, total_t))

wb.close()

print(f"Small-qty rows: {sum(small_qtys.values())}")
print(f"  serial=None: {small_serial_nulls}, serial set: {small_serial_set}")
print(f"  Unique contracts: {len(small_contracts)}")
print(f"  Contracts appearing >1x: {sum(1 for v in small_contracts.values() if v > 1)}")
print(f"\nTop 10 qty values:")
for qty, cnt in small_qtys.most_common(10):
    print(f"  qty={qty}: {cnt} rows")

print(f"\nSamples:")
for s in small_samples:
    print(f"  row={s[0]}, contract={s[1]}, qty={s[2]}, serial={s[3]}, total_t={s[4]}")

print(f"\nContracts with most rows:")
for c, cnt in small_contracts.most_common(5):
    print(f"  {c}: {cnt} rows")
