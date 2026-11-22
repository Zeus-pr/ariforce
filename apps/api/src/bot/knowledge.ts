import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hierarchyRank, ROLE_NAMES, ROLE_RANK, type RoleKey } from '@ariforce/contracts';

export type BotAudience = 'none' | 'team' | 'director';

/** ABM (rank 2) through Director. A Director is company-wide; everyone else is their reporting line. */
export function botAudience(roles: readonly RoleKey[]): BotAudience {
  if (hierarchyRank(roles) < 2) return 'none';
  return roles.includes('director') ? 'director' : 'team';
}

export function askerRoleLabel(roles: readonly RoleKey[]): string {
  const top = [...roles].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0];
  return top ? ROLE_NAMES[top] : 'Unknown';
}

export function knowledgeFor(audience: Exclude<BotAudience, 'none'>): string {
  const dir = join(__dirname, 'knowledge');
  const all = readFileSync(join(dir, 'all.md'), 'utf8').trim();
  if (audience === 'team') return all;
  return `${all}\n\n${readFileSync(join(dir, 'director.md'), 'utf8').trim()}`;
}
