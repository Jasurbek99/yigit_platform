import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import type { ICurrentUser } from '@/types';

export function useAuth() {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const { data } = await api.get<ICurrentUser>('/auth/me/');
      return data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (query.isError) {
      navigate('/login');
    }
  }, [query.isError, navigate]);

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
