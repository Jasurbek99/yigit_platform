from .registry import (
    Truck, Driver, DriverDocument, TraccarDevice, TraccarGeofence, DevicePosition,
)
from .link import ShipmentDeviceLink
from .fleet import TruckHead, TruckHeadDocument, Trailer

__all__ = [
    'Truck', 'Driver', 'DriverDocument', 'TraccarDevice', 'TraccarGeofence', 'DevicePosition',
    'ShipmentDeviceLink',
    'TruckHead', 'TruckHeadDocument', 'Trailer',
]
