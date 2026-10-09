import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

interface IPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface IBazaar {
  id: number;
  name: string;
  city_id: number | null;
  is_active: boolean;
}

export interface ISeller {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  bazaar: { id: number; name: string } | null;
}

export interface IBazaarWrite {
  id?: number;
  name?: string;
  city_id?: number | null;
  is_active?: boolean;
}

export interface ISellerWrite {
  id?: number;
  username?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
  bazaar_id?: number;
}

const BAZAARS = '/market/team/bazaars/';
const SELLERS = '/market/team/sellers/';
const TEAM_PAGE = { params: { page_size: 200 } };

export function useBazaars() {
  return useQuery({
    queryKey: ['market', 'team', 'bazaars'],
    queryFn: async () => (await api.get<IPage<IBazaar>>(BAZAARS, TEAM_PAGE)).data.results,
  });
}

export function useSellers() {
  return useQuery({
    queryKey: ['market', 'team', 'sellers'],
    queryFn: async () => (await api.get<IPage<ISeller>>(SELLERS, TEAM_PAGE)).data.results,
  });
}

/** POST without `id`, PATCH `<url><id>/` with it — the body is sent as given. */
function useSave<T extends { id?: number }>(url: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: T) =>
      id ? api.patch(`${url}${id}/`, body) : api.post(url, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['market', 'team'] }),
  });
}

export const useSaveBazaar = () => useSave<IBazaarWrite>(BAZAARS);
export const useSaveSeller = () => useSave<ISellerWrite>(SELLERS);
