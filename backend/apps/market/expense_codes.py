"""The selling costs an agent's seller records per truck (artifact: «Расходы по машине»).

Codes are rows of export.ExpenseCategory; labels are what the seller sees (Russian).
INTERES is the platform's commission code, PROSTOY its demurrage code (spec §2).
"""
MARKET_EXPENSES: list[tuple[str, str]] = [
    ('KARA', 'Кара'),
    ('INTERES', 'Комиссия'),
    ('PLYONKA', 'Плёнка'),
    ('ZAEZD', 'Заезд'),
    ('PARKOVKA', 'Парковка'),
    ('PROSTOY', 'Простой'),
    ('OTHER', 'Другое'),
]
OTHER_CODE = 'OTHER'
