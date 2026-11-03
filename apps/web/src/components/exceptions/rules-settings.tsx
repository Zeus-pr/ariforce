'use client';

import { useCallback, useEffect, useState } from 'react';
import { EXCEPTION_RULES, type ExceptionRule } from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { api, apiReady, toApiError } from '@/lib/api';
import { SEVERITY_LABEL, exceptionMessage } from './model';

type Draft = {
  enabled: boolean;
  severity: ExceptionRule['severity'];
  threshold: string;
  action: string;
};
const toDraft = (r: ExceptionRule): Draft => ({
  enabled: r.enabled,
  severity: r.severity,
  threshold: r.threshold === null ? '' : String(r.threshold),
  action: r.action,
});

export function RulesSettings() {
  const [rules, setRules] = useState<ExceptionRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    await apiReady();
    const r = await api.GET('/v1/exception-rules');
    if (!r.data) return setError(exceptionMessage(toApiError(r).code, toApiError(r).message));
    setRules(r.data.items);
  }, []);
  useEffect(() => void load(), [load]);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!rules) return <div className="h-64 animate-pulse rounded-lg bg-muted" aria-busy="true" />;
  return (
    <div className="flex flex-col gap-3">
      {rules.map((r) => (
        <RuleCard
          key={r.code}
          rule={r}
          onSaved={(n) => setRules((cur) => cur?.map((x) => (x.code === n.code ? n : x)) ?? null)}
        />
      ))}
    </div>
  );
}

function RuleCard({ rule, onSaved }: { rule: ExceptionRule; onSaved: (r: ExceptionRule) => void }) {
  const [d, setD] = useState<Draft>(toDraft(rule));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setD(toDraft(rule)), [rule]);
  const def = EXCEPTION_RULES[rule.code];
  const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(rule));

  async function save(reset = false) {
    setErr(null);
    let threshold: number | undefined;
    if (!reset && rule.threshold !== null) {
      threshold = Number(d.threshold);
      const min = def.thresholdMin ?? 0;
      const max = def.thresholdMax ?? 1000;
      if (
        d.threshold.trim() === '' ||
        !Number.isFinite(threshold) ||
        threshold < min ||
        threshold > max
      )
        return setErr(`Threshold must be between ${min} and ${max}.`);
    }
    if (!reset && !d.action.trim()) return setErr('Write the suggested action.');
    setBusy(true);
    const r = await api.PUT('/v1/exception-rules/{code}', {
      params: { path: { code: rule.code } },
      body: reset
        ? { reset: true, ...(rule.version !== null ? { version: rule.version } : {}) }
        : {
            enabled: d.enabled,
            severity: d.severity,
            ...(threshold !== undefined ? { threshold } : {}),
            action: d.action.trim(),
            ...(rule.version !== null ? { version: rule.version } : {}),
          },
    });
    setBusy(false);
    if (!r.data) return setErr(exceptionMessage(toApiError(r).code, toApiError(r).message));
    onSaved(r.data);
    toast.success(reset ? 'Back to defaults' : 'Rule saved');
  }

  return (
    <div className="rounded-lg border p-4" data-testid="rule-card" data-code={rule.code}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-medium">
            {rule.name}
            {!rule.isDefault && (
              <Badge variant="outline" data-testid="rule-custom">
                Customised
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{rule.description}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={d.enabled}
            onChange={(e) => setD({ ...d, enabled: e.target.checked })}
            data-testid="rule-enabled"
          />{' '}
          On
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_14rem_1fr]">
        <Select
          value={d.severity}
          onValueChange={(v) => setD({ ...d, severity: v as Draft['severity'] })}
        >
          <SelectTrigger className="w-full" aria-label="Severity" data-testid="rule-severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['high', 'medium', 'low'] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {rule.threshold !== null ? (
          <label className="flex items-center gap-2 text-sm">
            <Input
              inputMode="decimal"
              aria-label="Threshold"
              value={d.threshold}
              onChange={(e) => setD({ ...d, threshold: e.target.value })}
              className="w-20"
              data-testid="rule-threshold"
            />{' '}
            {rule.thresholdUnit}
          </label>
        ) : (
          <span className="self-center text-sm text-muted-foreground">No threshold</span>
        )}
        <Input
          aria-label="Suggested action"
          maxLength={500}
          value={d.action}
          onChange={(e) => setD({ ...d, action: e.target.value })}
          data-testid="rule-action"
        />
      </div>
      {err && (
        <p role="alert" className="mt-2 text-sm text-destructive" data-testid="rule-error">
          {err}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          disabled={busy || !dirty}
          onClick={() => void save()}
          data-testid="rule-save"
        >
          Save
        </Button>
        {!rule.isDefault && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void save(true)}
            data-testid="rule-reset"
          >
            Reset to default
          </Button>
        )}
      </div>
    </div>
  );
}
