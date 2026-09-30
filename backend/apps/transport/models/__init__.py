from .registry import (
    Truck, Driver, DriverDocument, TraccarDevice, TraccarGeofence, DevicePosition,
)
from .link import ShipmentDeviceLink
from .fleet import TruckHead, TruckHeadDocument, Trailer
from .external_trip import ExternalTrip, ExternalTripSyncState

__all__ = [
    'Truck', 'Driver', 'DriverDocument', 'TraccarDevice', 'TraccarGeofence', 'DevicePosition',
    'ShipmentDeviceLink',
    'TruckHead', 'TruckHeadDocument', 'Trailer',
    'ExternalTrip', 'ExternalTripSyncState',
]
