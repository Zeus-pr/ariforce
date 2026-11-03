'use client';

import { rejectionText } from '@/components/approvals/rejection-note';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@ariforce/ui/components/dropdown-menu';
import { MOCKING, api, apiReady, toApiError } from '@/lib/api';
import { notificationHref, type AppNotification } from './links';

const POLL_MS = 45_000;
// The mock inbox has only a few rows, so use a small page there to exercise "Load more".
const PAGE = MOCKING ? 3 : 20;

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotificationBell({ pageSize = PAGE }: { pageSize?: number }) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refreshCount = useCallback(async () => {
    await apiReady();
    const r = await api.GET('/v1/notifications/unread-count');
    if (alive.current && r.data) setCount(r.data.count);
  }, []);

  // Poll the unread count; paused while the tab is hidden, refreshed when it becomes visible.
  useEffect(() => {
    alive.current = true;
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (t) clearInterval(t);
      t = setInterval(() => void refreshCount(), POLL_MS);
    };
    const onVis = () => {
      if (document.hidden) {
        if (t) clearInterval(t);
        t = undefined;
      } else {
        void refreshCount();
        start();
      }
    };
    void refreshCount();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive.current = false;
      if (t) clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refreshCount]);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      setError(null);
      await apiReady();
      const r = await api.GET('/v1/notifications', {
        params: { query: { limit: pageSize, ...(after ? { cursor: after } : {}) } },
      });
      setLoading(false);
      if (!r.data) {
        setError(toApiError(r).message || 'Could not load notifications.');
        return;
      }
      setItems((prev) => (after ? [...prev, ...r.data.items] : r.data.items));
      setCursor(r.data.nextCursor);
    },
    [pageSize],
  );

  useEffect(() => {
    if (open) {
      void load(null);
      void refreshCount();
    }
  }, [open, load, refreshCount]);

  const markRead = async (n: AppNotification) => {
    if (n.readAt) return;
    const r = await api.POST('/v1/notifications/{id}/read', { params: { path: { id: n.id } } });
    if (r.data) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: r.data.readAt } : x)));
      setCount((c) => Math.max(0, c - 1));
    }
  };

  const readAll = async () => {
    const r = await api.POST('/v1/notifications/read-all');
    if (r.data) {
      const now = new Date().toISOString();
      setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? now })));
      setCount(0);
    } else setError(toApiError(r).message || 'Could not mark all as read.');
  };

  const openItem = async (n: AppNotification) => {
    await markRead(n);
    const href = notificationHref(n);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
          data-testid="notif-bell"
          className="relative text-muted-foreground"
        >
          <Bell className="size-4" />
          {count > 0 && (
            <span
              data-testid="notif-count"
              className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-medium text-primary-foreground"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(22rem,calc(100vw-1rem))] p-0"
        data-testid="notif-panel"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={count === 0}
            onClick={() => void readAll()}
            data-testid="notif-read-all"
          >
            Mark all as read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {error && (
            <p className="px-3 py-2 text-sm text-destructive" data-testid="notif-error">
              {error}
            </p>
          )}
          {!loading && !error && items.length === 0 && (
            <p
              className="px-3 py-6 text-center text-sm text-muted-foreground"
              data-testid="notif-empty"
            >
              No notifications yet.
            </p>
          )}
          <ul>
            {items.map((n) => (
              <li key={n.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  data-testid="notif-item"
                  data-unread={n.readAt ? undefined : ''}
                  onClick={() => void openItem(n)}
                  className="flex w-full gap-2 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-primary'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.readAt ? '' : 'font-medium'}`}>
                      {n.title}
                    </span>
                    {n.type.endsWith('.rejected') &&
                    typeof (n.data?.reason ?? n.data?.comment) === 'string' ? (
                      <span className="block text-xs text-red-900" data-testid="notif-rejection">
                        {rejectionText(
                          String(n.data?.reason ?? n.data?.comment),
                          typeof n.data?.actorName === 'string' ? n.data.actorName : null,
                          n.createdAt,
                        )}
                      </span>
                    ) : (
                      <span className="block text-xs text-muted-foreground">{n.body}</span>
                    )}
                    <span className="block text-[11px] text-muted-foreground">
                      {when(n.createdAt)}
                    </span>
                  </span>
                  {!n.readAt && <span className="sr-only">Unread</span>}
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <div className="p-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={loading}
                onClick={() => void load(cursor)}
                data-testid="notif-more"
              >
                {loading ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
          {loading && items.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
