import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
export interface Profile {
  id: string;
  nickname: string;
  points: number;
  is_premium: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isDJ: boolean;
  isAnonymous: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  adjustProfilePoints: (delta: number) => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
