import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '@/services/api';
import type { ICurrentUser } from '@/types';
import { loginPathFor } from '@/utils/loginRedirect';

export function useAuth() {
  const navigate = useNavigate();
  const location = useLocation();

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
      navigate(loginPathFor(location.pathname + location.search));
    }
  }, [query.isError, navigate, location.pathname, location.search]);

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
