import { useQuery } from '@tanstack/react-query';

import api from '@/services/api';
import type {
  IApiListResponse,
  IDocumentPacket,
  IDocumentPacketFilters,
} from '@/types';

interface IDocumentPacketResult {
  results: IDocumentPacket[];
  count: number;
}

/**
 * Truck document packets for the Documents page — one row per truck (shipment)
 * with its firms, per-firm sale ids, and packing-complete flag. Hits
 * GET /contracts/document-packets/ (paginated).
 */
export function useDocumentPackets(params: IDocumentPacketFilters = {}) {
  return useQuery({
    queryKey: ['document-packets', 'list', params] as const,
    queryFn: async (): Promise<IDocumentPacketResult> => {
      const p = new URLSearchParams();
      if (params.date) p.set('date', params.date);
      if (params.status) p.set('status', params.status);
      if (params.firm) p.set('firm', String(params.firm));
      if (params.page) p.set('page', String(params.page));
      if (params.pageSize) p.set('page_size', String(params.pageSize));

      const { data } = await api.get<IApiListResponse<IDocumentPacket>>(
        `/contracts/document-packets/?${p.toString()}`,
      );
      return { results: data.results, count: data.count };
    },
    staleTime: 30_000,
  });
}
