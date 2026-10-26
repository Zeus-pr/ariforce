'use client';

import { createContext, useContext, useState } from 'react';
import type { Role } from '@/lib/nav';

const RoleContext = createContext<{ role: Role; setRole: (r: Role) => void } | null>(null);

/** Preview-only role switch. Real roles come from the session once auth (#5) lands. */
export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>('manager');
  return <RoleContext.Provider value={{ role, setRole }}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used inside RoleProvider');
  return ctx;
}
