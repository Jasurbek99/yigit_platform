// ─── Split Template types ──────────────────────────────────────────────────────
//
// Mirrors SplitTemplateSerializer from apps/export/serializers.py.
// A named division of a truck into per-firm weights (e.g. "10000 / 8000").

export interface ISplitTemplate {
  readonly id: number;
  readonly name: string;
  /** Comma-separated weights, e.g. "10000,8000" (edit form). */
  readonly weights: string;
  /** Parsed weights as strings, in order. */
  readonly weights_list: string[];
  readonly part_count: number;
  readonly total_kg: string;
  readonly is_active: boolean;
  readonly sort_order: number;
}

export interface ISplitTemplateCreatePayload {
  name: string;
  weights: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface ISplitTemplateUpdatePayload extends Partial<ISplitTemplateCreatePayload> {
  // All fields optional for PATCH
}
