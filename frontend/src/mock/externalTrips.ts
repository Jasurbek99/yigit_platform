import type { ICandidateShipment, IExternalTrip, ITripSyncState } from '@/types/externalTrip';

// Frontend-only mock for VITE_USE_MOCK=true (the backend has its own
// TRANSPORT_API_MODE=mock for demos against a real database).
const base = {
  trip_number: null, status: 'CREATED', changed_at: '2026-09-29T10:58:12Z',
  tractor_brand: 'DAF', tractor_model: 'XF480', tractor_company: '"YIGIT" HJ', tractor_source: 'GARAGE',
  trailer_brand: 'SCHMITZ Cargobull', trailer_model: 'S.KO', trailer_company: null, trailer_source: 'GARAGE',
  driver_source: 'GARAGE', shipment: null, shipment_code: null, conflict_note: null, conflict_kind: null,
  conflict_from: null, conflict_to: null, last_push_status: null, last_push_error: null, position: null,
  has_unrecognised_visa: false,
} as const;

export const MOCK_EXTERNAL_TRIPS: IExternalTrip[] = [
  {
    ...base, id: 1, integration_trip_id: 'b242b4de-a941-4dba-899e-3b0235e9f4ec', planned_departure: '2026-10-01',
    destination_country_code: 'KZ', tractor_plate: '2546AHF', trailer_plate: '2296TAH',
    driver_full_name: 'Allanazarow Agageldi', driver_phone: '99363318685', driver_passport_number: 'A2051674',
    driver_passport_expiry: '2028-03-15', visas: [{ country: 'Gazagystan', expiry_date: '2027-01-31' }],
    visa_country_codes: ['KZ'],
  },
  {
    ...base, id: 2, integration_trip_id: 'a236010e-cff3-466f-a1e9-dbf8aa66e377', planned_departure: '2026-10-05',
    destination_country_code: 'RU', tractor_plate: '2408AHF', trailer_plate: '2068TAH',
    driver_full_name: 'Annagurbanow Bekmyrat', driver_phone: '99365299041', driver_passport_number: 'A2098786',
    driver_passport_expiry: '2028-02-08', visas: [{ country: 'Russiýa', expiry_date: '2027-06-07' }],
    visa_country_codes: ['RU'],
  },
];

export const MOCK_CANDIDATE_SHIPMENTS: ICandidateShipment[] = [
  { id: 101, shipment_code: '0110001/26', date: '2026-10-01', country_code: 'KZ', country_name: 'GAZAGYSTAN',
    customer: 1, customer_name: 'Berik', blocks: ['A1'] },
];

export const MOCK_TRIP_SYNC_STATE: ITripSyncState = { last_success_at: new Date().toISOString(), last_error: '', is_mock: true };
