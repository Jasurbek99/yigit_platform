import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IDailyBoardResponse, IDailyBoardRow } from '@/types';

const QUERY_KEY = 'daily-board';

/** Fetch the daily harvest board for a given date (one row per active block). */
export function useDailyBoard(date: string) {
  return useQuery({
    queryKey: [QUERY_KEY, date],
    queryFn: async (): Promise<IDailyBoardResponse> => {
      const { data } = await api.get<IDailyBoardResponse>(
        `/greenhouse/daily-plan/?date=${date}`,
      );
      return data;
    },
    staleTime: 30_000,
  });
}

export interface IUpsertDailyBoardPayload {
  block: number;
  date: string;
  today_plan?: number | null;
  yesterday_rest?: number | null;
  note?: string;
}

/** Upsert one block/date cell (only the keys provided are written). */
export function useUpsertDailyBoard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IUpsertDailyBoardPayload): Promise<IDailyBoardRow> => {
      const { data } = await api.post<IDailyBoardRow>('/greenhouse/daily-plan/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}
