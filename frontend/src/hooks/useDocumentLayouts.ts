import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';

import api from '@/services/api';

const QUERY_KEY = ['contracts', 'document-layouts'] as const;

/**
 * Page-layout adjustments for one document type.
 *
 * Every value is an adjustment against the template, never an absolute: margins
 * are ±mm deltas and the font is a percentage. The backend applies them after
 * rendering — see `DocumentLayoutSetting` for why absolutes don't work on these
 * templates.
 */
export interface IDocumentLayout {
  readonly document_key: string;
  readonly font_scale_pct: number;
  readonly line_spacing: string | null;
  readonly margin_top_delta_mm: number;
  readonly margin_bottom_delta_mm: number;
  readonly margin_left_delta_mm: number;
  readonly margin_right_delta_mm: number;
  readonly version: number;
  readonly updated_at: string | null;
  readonly updated_by_name: string;
}

export interface IDocumentLayoutConflict {
  error: string;
  current_version: number;
}

export type IDocumentLayoutPatch = Partial<
  Omit<IDocumentLayout, 'document_key' | 'version' | 'updated_at' | 'updated_by_name'>
> & { version?: number };

/** Every tunable document's layout. The API synthesises defaults for untouched ones. */
export function useDocumentLayouts() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<IDocumentLayout[]> => {
      const { data } = await api.get<IDocumentLayout[]>('/contracts/document-layouts/');
      return data;
    },
    staleTime: 60_000,
  });
}

export function useSaveDocumentLayout() {
  const queryClient = useQueryClient();

  return useMutation<
    IDocumentLayout,
    AxiosError<IDocumentLayoutConflict>,
    { documentKey: string; patch: IDocumentLayoutPatch }
  >({
    mutationFn: async ({ documentKey, patch }) => {
      const { data } = await api.patch<IDocumentLayout>(
        `/contracts/document-layouts/${documentKey}/`,
        patch,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
