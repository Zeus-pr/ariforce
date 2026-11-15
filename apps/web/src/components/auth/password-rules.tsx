'use client';

import { Check } from 'lucide-react';
import { passwordChecks } from '@ariforce/contracts';
import { cn } from '@ariforce/ui/lib/utils';

/** Live requirements for a new password. Unmet rows stay quiet; a met row turns into a green tick. */
export function PasswordRules({ password, id }: { password: string; id: string }) {
  const checks = passwordChecks(password);
  return (
    <ul id={id} className="grid gap-1.5" data-testid="password-rules">
      {checks.map((rule) => (
        <li
          key={rule.id}
          className="flex items-center gap-2 text-sm"
          data-testid={`password-rule-${rule.id}`}
          data-met={rule.met ? 'yes' : 'no'}
        >
          <span
            aria-hidden
            className={cn(
              'grid size-4 shrink-0 place-items-center rounded-full border transition-[transform,background-color,border-color] duration-200 ease-out motion-reduce:transition-none',
              rule.met
                ? 'scale-100 border-success bg-success text-white'
                : 'scale-90 border-input bg-background',
            )}
          >
            <Check
              className={cn(
                'size-3 transition-opacity duration-200 motion-reduce:transition-none',
                rule.met ? 'opacity-100' : 'opacity-0',
              )}
              strokeWidth={3}
            />
          </span>
          <span className={rule.met ? 'text-foreground' : 'text-muted-foreground'}>
            {rule.label}
            <span className="sr-only">{rule.met ? ', done' : ', not yet'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
