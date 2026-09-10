// Fleet document scans. Driver passports and truck-head tech passports have
// the same wire shape, so one type serves both resources and the shared
// panel that renders them.

export interface IFleetDocument {
  id: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: number;
  uploaded_by_name: string;
  uploaded_at: string;
}
