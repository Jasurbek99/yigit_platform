export interface ITripPosition {
  lat: number;
  lon: number;
  address: string | null;
  fix_time: string | null;
  geofence_name: string | null;
}

export interface IExternalTrip {
  /** The linked shipment's truck-change rollback stamp. */
  shipment_documents_reset_at?: string | null;
  id: number;
  integration_trip_id: string;
  trip_number: string | null;
  status: string;
  planned_departure: string;
  changed_at: string;
  destination_country_code: string | null;
  tractor_plate: string;
  tractor_brand: string | null;
  tractor_model: string | null;
  tractor_company: string | null;
  tractor_source: 'GARAGE' | 'THIRD_PARTY';
  trailer_plate: string;
  trailer_brand: string | null;
  trailer_model: string | null;
  trailer_company: string | null;
  trailer_source: 'GARAGE' | 'THIRD_PARTY';
  driver_full_name: string;
  driver_phone: string | null;
  driver_passport_number: string | null;
  driver_passport_expiry: string | null;
  driver_source: 'GARAGE' | 'THIRD_PARTY';
  visas: { country: string; expiry_date: string }[];
  visa_country_codes: string[];
  /** A visa name matched no country — the missing-visa warning stays quiet. */
  has_unrecognised_visa: boolean;
  shipment: number | null;
  shipment_code: string | null;
  conflict_note: string | null;
  /** 'changed' | 'cancelled' — worded by the frontend with conflict_from / conflict_to. */
  conflict_kind: 'changed' | 'cancelled' | null;
  conflict_from: string | null;
  conflict_to: string | null;
  last_push_status: string | null;
  last_push_error: string | null;
  position: ITripPosition | null;
}

export interface ICandidateShipment {
  id: number;
  shipment_code: string;
  date: string;
  country_code: string | null;
  country_name: string | null;
  customer: number | null;
  customer_name: string | null;
  blocks: string[];
}

export interface ITripSyncState {
  last_success_at: string | null;
  last_error: string;
  is_mock: boolean;
}
