"""Moving the shipment's status from the bazaar journal (spec §5)."""
from apps.core.models import User


def drive_first_sale(lot_id: int, user: User) -> bool:
    """Move the lot's shipment to «satylyar» after its first sale. Returns whether it moved.

    Filled in by Part B Task 4. Runs from `transaction.on_commit` in
    services.entries.create_sale, so the sale is saved whatever happens here.
    """
    return False
