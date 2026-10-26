'use client';

/**
 * Accessible tree (WAI-ARIA APG treeview pattern: roving tabindex, arrows, Home/End, * to expand siblings).
 * Pattern reference only, no code copied (docs/UI-SOURCES.md). Rows animate with transform/opacity only.
 */
import { ChevronRight, Mail, MapPin, Phone } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Badge } from '@ariforce/ui/components/badge';
import { cn } from '@ariforce/ui/lib/utils';
import type { Employee, Hq } from '@/lib/team-adapter/types';
import { ROLE_SHORT } from '@/lib/roles';

export type TreeProps = {
  rootId: string;
  nodes: Employee[];
  hqs: Map<string, Hq>;
  expanded: Set<string>;
  setExpanded: (s: Set<string>) => void;
  /** Lowercased search; matches are highlighted, non-matching branches hidden. */
  query: string;
  onOpen: (e: Employee) => void;
};

export function matches(e: Employee, hq: Hq | undefined, q: string) {
  if (!q) return true;
  return [
    e.name,
    e.employeeCode,
    e.email,
    e.phone,
    ROLE_SHORT[e.role],
    hq?.name,
    hq?.city,
    hq?.state,
  ].some((s) => s?.toLowerCase().includes(q));
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-100 px-0.5 text-foreground">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function OrgTree({ rootId, nodes, hqs, expanded, setExpanded, query, onOpen }: TreeProps) {
  const kids = useMemo(() => {
    const m = new Map<string, Employee[]>();
    for (const e of nodes) if (e.managerId) m.set(e.managerId, [...(m.get(e.managerId) ?? []), e]);
    for (const l of m.values())
      l.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    return m;
  }, [nodes]);
  const byId = useMemo(() => new Map(nodes.map((e) => [e.id, e])), [nodes]);

  // With a search, keep matches and their ancestors; ancestors are shown open.
  const visibleIds = useMemo(() => {
    if (!query) return null;
    const keep = new Set<string>();
    for (const e of nodes)
      if (matches(e, e.hqId ? hqs.get(e.hqId) : undefined, query))
        for (
          let x: Employee | undefined = e;
          x && !keep.has(x.id);
          x = x.managerId ? byId.get(x.managerId) : undefined
        )
          keep.add(x.id);
    return keep;
  }, [query, nodes, hqs, byId]);

  // Flattened visible rows in order, for keyboard navigation.
  const flat = useMemo(() => {
    const out: { e: Employee; level: number; setSize: number; pos: number }[] = [];
    const walk = (id: string, level: number, setSize: number, pos: number) => {
      const e = byId.get(id);
      if (!e || (visibleIds && !visibleIds.has(id))) return;
      out.push({ e, level, setSize, pos });
      const open = visibleIds ? true : expanded.has(id);
      if (!open) return;
      const c = (kids.get(id) ?? []).filter((k) => !visibleIds || visibleIds.has(k.id));
      c.forEach((k, i) => walk(k.id, level + 1, c.length, i + 1));
    };
    walk(rootId, 1, 1, 1);
    return out;
  }, [byId, kids, rootId, expanded, visibleIds]);

  const [focus, setFocus] = useState<string>(rootId);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const focusId = flat.some((r) => r.e.id === focus) ? focus : rootId;
  const move = (id: string) => {
    setFocus(id);
    refs.current.get(id)?.focus();
  };
  const toggle = (id: string, open?: boolean) => {
    const s = new Set(expanded);
    if (open ?? !s.has(id)) s.add(id);
    else s.delete(id);
    setExpanded(s);
  };

  const onKey = (ev: React.KeyboardEvent, i: number) => {
    const row = flat[i]!;
    const id = row.e.id;
    const hasKids = (kids.get(id) ?? []).length > 0;
    const open = visibleIds ? true : expanded.has(id);
    const handled = () => (ev.preventDefault(), ev.stopPropagation());
    switch (ev.key) {
      case 'ArrowDown':
        handled();
        if (flat[i + 1]) move(flat[i + 1]!.e.id);
        break;
      case 'ArrowUp':
        handled();
        if (flat[i - 1]) move(flat[i - 1]!.e.id);
        break;
      case 'Home':
        handled();
        move(flat[0]!.e.id);
        break;
      case 'End':
        handled();
        move(flat.at(-1)!.e.id);
        break;
      case 'ArrowRight':
        handled();
        if (hasKids && !open) toggle(id, true);
        else if (hasKids && flat[i + 1]) move(flat[i + 1]!.e.id);
        break;
      case 'ArrowLeft':
        handled();
        if (hasKids && open && !visibleIds) toggle(id, false);
        else if (row.e.managerId && byId.has(row.e.managerId) && id !== rootId)
          move(row.e.managerId);
        break;
      case '*': {
        handled();
        const s = new Set(expanded);
        for (const sib of row.e.managerId ? (kids.get(row.e.managerId) ?? []) : []) s.add(sib.id);
        setExpanded(s);
        break;
      }
      case 'Enter':
      case ' ':
        handled();
        onOpen(row.e);
        break;
    }
  };

  if (!flat.length)
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        No one in your team matches.
      </p>
    );
  return (
    <ul
      role="tree"
      aria-label="Team hierarchy"
      className="flex flex-col py-1"
      data-testid="org-tree"
    >
      {flat.map(({ e, level, setSize, pos }, i) => {
        const hq = e.hqId ? hqs.get(e.hqId) : undefined;
        const c = kids.get(e.id) ?? [];
        const open = visibleIds ? true : expanded.has(e.id);
        const hit = !!query && matches(e, hq, query);
        return (
          <li
            key={e.id}
            ref={(el) => {
              if (el) refs.current.set(e.id, el);
              else refs.current.delete(e.id);
            }}
            role="treeitem"
            aria-level={level}
            aria-setsize={setSize}
            aria-posinset={pos}
            aria-expanded={c.length ? open : undefined}
            aria-selected={focusId === e.id}
            tabIndex={focusId === e.id ? 0 : -1}
            onKeyDown={(ev) => onKey(ev, i)}
            onFocus={() => setFocus(e.id)}
            data-testid="tree-node"
            data-id={e.id}
            className="af-enter group outline-none"
            style={{ '--i': Math.min(i, 10) } as React.CSSProperties}
          >
            <div
              className={cn(
                'flex items-start gap-2 rounded-md py-2 pr-3 hover:bg-muted/60 group-focus-visible:ring-2 group-focus-visible:ring-ring',
                hit && 'bg-amber-50',
                !e.active && 'opacity-60',
              )}
              style={{ paddingLeft: `${(level - 1) * 20 + 8}px` }}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                className={cn(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted',
                  !c.length && 'invisible',
                )}
                onClick={() => toggle(e.id)}
                data-testid="tree-toggle"
              >
                <ChevronRight
                  className={cn(
                    'size-4 transition-transform duration-200 motion-reduce:transition-none',
                    open && 'rotate-90',
                  )}
                />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="min-w-0 flex-1 text-left"
                onClick={() => onOpen(e)}
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium" data-testid="node-name">
                    <Highlight text={e.name} q={query} />
                  </span>
                  <Badge variant="secondary" className="font-normal" title={e.role}>
                    {ROLE_SHORT[e.role]}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <Highlight text={e.employeeCode} q={query} />
                  </span>
                  {!e.active && (
                    <Badge variant="outline" className="font-normal">
                      Inactive
                    </Badge>
                  )}
                  {c.length > 0 && (
                    <span className="text-xs text-muted-foreground" data-testid="node-reports">
                      {c.length} direct {c.length === 1 ? 'report' : 'reports'}
                    </span>
                  )}
                </span>
                <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" aria-hidden />
                    {hq ? (
                      <Highlight text={`${hq.name} · ${hq.city}, ${hq.state}`} q={query} />
                    ) : (
                      'No HQ'
                    )}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-3" aria-hidden />
                    {e.phone}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1 break-all">
                    <Mail className="size-3 shrink-0" aria-hidden />
                    {e.email}
                  </span>
                </span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
