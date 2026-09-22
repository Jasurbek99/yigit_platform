from collections.abc import Iterable

from apps.transport.models import DevicePosition


def group_by_geofence(positions: Iterable[DevicePosition]) -> list[dict]:
    """Bucket positions by current geofence: busiest first, then by name; "none" last."""
    buckets: dict = {}
    for position in positions:
        buckets.setdefault(position.current_geofence, []).append(position)
    named = sorted(
        (g for g in buckets if g is not None),
        key=lambda g: (-len(buckets[g]), g.name),
    )
    order = named + ([None] if None in buckets else [])
    return [{'geofence': g, 'positions': buckets[g]} for g in order]
