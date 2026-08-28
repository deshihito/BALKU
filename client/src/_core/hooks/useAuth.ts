import { useCallback } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

type StandaloneUser = {
  name: string | null;
  email: string | null;
};

/** BALKU uses room player tokens instead of account authentication. */
export function useAuth(_options?: UseAuthOptions) {
  const logout = useCallback(async () => undefined, []);
  const user: StandaloneUser = { name: null, email: null };
  return {
    user,
    loading: false,
    error: null,
    isAuthenticated: false,
    refresh: async () => undefined,
    logout,
  };
}
