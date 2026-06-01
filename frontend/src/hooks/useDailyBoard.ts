import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IDailyBoardResponse, IDailyBoardRow } from '@/types';
import { MOCK_DAILY_BOARD } from '@/mock/dailyBoard';

const QUERY_KEY = 'daily-board';
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/** Fetch the daily harvest board for a given date (one row per active block). */
export function useDailyBoard(date: string) {
  return useQuery({
    queryKey: [QUERY_KEY, date],
    queryFn: async (): Promise<IDailyBoardResponse> => {
      if (USE_MOCK) return { ...MOCK_DAILY_BOARD, date };
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
      if (USE_MOCK) {
        const base = MOCK_DAILY_BOARD.results.find((r) => r.block === payload.block);
        return {
          ...(base ?? MOCK_DAILY_BOARD.results[0]),
          block: payload.block,
          entry_date: payload.date,
        };
      }
      const { data } = await api.post<IDailyBoardRow>('/greenhouse/daily-plan/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}
