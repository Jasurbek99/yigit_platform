"""The single writer of QualityDocument's four derived flags.

``QualityDocument.azyk_maglumatnama`` and its three siblings are denormalized:
each is True iff at least one :class:`QualityCertificate` of that type exists.
They stay real columns because ``boss_analytics`` and ``dashboard_summary``
filter on them in the ORM and ShipmentList / the Sheet payload read them.

Denormalization needs exactly one writer — the same discipline AD-1 applies to
the lifecycle timestamps, and for the same reason. Every upload and every
delete calls :func:`sync_certificate_flags`; nothing else assigns these fields.
A flag left True after its last scan was deleted is a certificate the dashboard
counts and the truck does not carry.

No Django signals (CLAUDE.md) and no ``Model.save()`` override: the view
actions call this explicitly, so the write is visible at the call site.
"""
from apps.export.models import QualityCertificateType, QualityDocument

FLAG_FIELDS = [choice.value for choice in QualityCertificateType]


def sync_certificate_flags(quality_document: QualityDocument) -> QualityDocument:
    """Recompute all four flags from the certificate rows and persist them.

    Recomputes every flag rather than toggling the one that changed: one query
    for the whole record, and it self-heals a row that drifted for any reason
    (an import, a manual DB edit, a half-applied earlier version of this code).

    Args:
        quality_document: The record whose flags to rebuild.

    Returns:
        The same instance, with flags updated in memory and in the database.
    """
    present = set(
        quality_document.certificates.values_list('doc_type', flat=True).distinct()
    )

    changed = []
    for field in FLAG_FIELDS:
        value = field in present
        if getattr(quality_document, field) != value:
            setattr(quality_document, field, value)
            changed.append(field)

    if changed:
        quality_document.save(update_fields=changed)

    return quality_document
