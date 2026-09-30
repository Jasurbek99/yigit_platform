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
  {
    ...base, id: 3, integration_trip_id: '89f2783b-e7e9-47ba-9884-8fe7bf34f1bd', planned_departure: '2026-10-11',
    trip_number: 'X-TEST-0001', status: 'PLANNED', destination_country_code: 'RU',
    tractor_plate: '2563AHF', trailer_plate: '2251TAH', driver_full_name: 'Amandurdyyew Atajan',
    driver_phone: '99361202698', driver_passport_number: 'A2510574', driver_passport_expiry: '2029-04-08',
    visas: [{ country: 'Russiýa', expiry_date: '2026-10-28' }], visa_country_codes: ['RU'],
    shipment: 102, shipment_code: '0210002/26', conflict_kind: 'changed',
    conflict_from: '2563AHF/2251TAH, Amandurdyyew Atajan', conflict_to: '2563AHF/2251TAH, Täze Sürüji',
  },
];

export const MOCK_CANDIDATE_SHIPMENTS: ICandidateShipment[] = [
  { id: 101, shipment_code: '0110001/26', date: '2026-10-01', country_code: 'KZ', country_name: 'GAZAGYSTAN',
    customer: 1, customer_name: 'Berik', blocks: ['A1'] },
];

export const MOCK_TRIP_SYNC_STATE: ITripSyncState = { last_success_at: new Date().toISOString(), last_error: '', is_mock: true };
