"""Russian wording helpers for the market's messages."""


def plural_ru(n: int, one: str, few: str, many: str) -> str:
    """The Russian noun form for the count `n`: 1 ящик, 2 ящика, 5 ящиков, 11 ящиков, 21 ящик."""
    n = abs(n)
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def boxes_ru(n: int) -> str:
    """`n` with the word «ящик» in the right form: «1 ящик», «3 ящика», «90 ящиков»."""
    return f'{n} {plural_ru(n, "ящик", "ящика", "ящиков")}'
