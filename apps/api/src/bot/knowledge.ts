import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hierarchyRank, ROLE_NAMES, ROLE_RANK, type RoleKey } from '@ariforce/contracts';

export type BotAudience = 'none' | 'team' | 'director';

const COMPANY_ROLES: readonly RoleKey[] = ['director', 'distribution_head'];

/** Who may ask. Company figures are a separate check: the principal's team list is null. */
export function botAudience(roles: readonly RoleKey[]): BotAudience {
  if (roles.some((role) => COMPANY_ROLES.includes(role))) return 'director';
  if (roles.includes('system_admin') || hierarchyRank(roles) >= 2) return 'team';
  return 'none';
}

export function askerRoleLabel(roles: readonly RoleKey[]): string {
  const top = [...roles].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0];
  return top ? ROLE_NAMES[top] : 'Unknown';
}

export function knowledgeFor(audience: Exclude<BotAudience, 'none'>): string {
  const dir = join(__dirname, 'knowledge');
  const all = readFileSync(join(dir, 'all.md'), 'utf8').trim();
  const how = readFileSync(join(dir, 'howto.md'), 'utf8').trim();
  const base = `${all}\n\n${how}`;
  if (audience === 'team') return base;
  return `${base}\n\n${readFileSync(join(dir, 'director.md'), 'utf8').trim()}`;
}
