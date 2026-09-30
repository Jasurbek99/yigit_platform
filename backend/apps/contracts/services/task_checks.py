"""Contract readiness for the export task chain (docs/Tasks.md item 9).

Registered into apps.export.services.task_chain from ContractsConfig.ready() —
contracts may import export, never the reverse.
"""
from apps.contracts.models import ContractSale

PREPARE_CONTRACT = 'tasks.prepare_contract'


def contracts_ready(shipment) -> bool:
    """Every export firm on the truck has a non-void sale with a contract whose
    agreement has been downloaded at least once."""
    firms = set(shipment.firm_splits.values_list('export_firm_id', flat=True))
    if not firms:
        return False
    covered = set(
        ContractSale.objects
        .filter(shipment=shipment, contract__isnull=False, contract__agreement_downloaded_at__isnull=False)
        .exclude(status=ContractSale.STATUS_VOID)
        .values_list('export_firm_id', flat=True)
    )
    return firms <= covered


def sync_prepare_contract(shipment, user) -> None:
    from apps.export.services.task_chain import after_task_done, close_auto_satisfied

    if shipment.season_id and shipment.season.closed_at is not None:
        return        # closed season: frozen (D1)
    shipment.updated_by = user
    closed = close_auto_satisfied(shipment)
    if closed:
        after_task_done(shipment, user, closed)
