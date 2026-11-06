const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  channelId: string;
  data: Record<string, string | null>;
};

type ExpoTicket = {
  status?: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

export function isExpoPushToken(token: string) {
  return /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(token);
}

/** POST a batch to Expo. Throws on HTTP or request-level failure so the job can retry. */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<ExpoTicket[]> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
  const json = (await res.json()) as { data?: ExpoTicket[]; errors?: { message?: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0]?.message || 'Expo push rejected the request');
  return json.data ?? [];
}

export function deadPushTokens(messages: ExpoPushMessage[], tickets: ExpoTicket[]) {
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      const to = messages[i]?.to;
      if (to) dead.push(to);
    }
  });
  return dead;
}

/** True when every ticket is ok or a dead device. Any other error should retry the job. */
export function pushTicketsSettled(tickets: ExpoTicket[]) {
  return tickets.every(
    (t) => t.status === 'ok' || (t.status === 'error' && t.details?.error === 'DeviceNotRegistered'),
  );
}
