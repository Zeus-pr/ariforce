import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hierarchyRank, ROLE_NAMES, ROLE_RANK, type RoleKey } from '@ariforce/contracts';

export type BotAudience = 'none' | 'team' | 'director';

const COMPANY_ROLES: readonly RoleKey[] = ['director', 'system_admin', 'distribution_head'];

/** ABM through Director see their line. Director, System Admin, and Distribution Head see the company. */
export function botAudience(roles: readonly RoleKey[]): BotAudience {
  if (roles.some((role) => COMPANY_ROLES.includes(role))) return 'director';
  if (hierarchyRank(roles) < 2) return 'none';
  return 'team';
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
