export type VisitKind = 'doctor' | 'chemist';

export type VisitCall = {
  userId: string;
  visitor: string;
  kind: VisitKind;
  outletId: string;
  date: string;
};

export type OutletCard = {
  id: string;
  kind: VisitKind;
  hqId: string;
  name: string;
  code: string;
  specialty: string;
  category: string;
  qualification: string;
  territory: string;
  city: string;
  phone: string;
  required: number | null;
};

export type VisitLine = {
  kind: VisitKind;
  name: string;
  code: string;
  specialty: string;
  category: string;
  qualification: string;
  territory: string;
  city: string;
  phone: string;
  visitor: string;
  times: number;
  required: number | null;
  dates: string[];
};

export type VisitSheet = {
  id: string;
  name: string;
  lines: VisitLine[];
};

export type VisitFile = {
  company: string;
  preparedFor: string;
  monthLabel: string;
  monthKey: string;
  generatedAt: string;
  sheets: VisitSheet[];
};

/** One row per person and outlet. Dates stay in order, including a second visit on the same day. */
export function visitLines(calls: VisitCall[], outlets: OutletCard[]): Map<string, VisitLine[]> {
  const card = new Map(outlets.map((outlet) => [`${outlet.kind}:${outlet.id}`, outlet]));
  const grouped = new Map<string, VisitLine>();
  for (const call of calls) {
    const outlet = card.get(`${call.kind}:${call.outletId}`);
    if (!outlet) continue;
    const key = `${outlet.hqId}:${call.kind}:${call.outletId}:${call.userId}`;
    const line = grouped.get(key);
    if (line) {
      line.times += 1;
      line.dates.push(call.date);
    } else {
      grouped.set(key, {
        kind: outlet.kind,
        name: outlet.name,
        code: outlet.code,
        specialty: outlet.specialty,
        category: outlet.category,
        qualification: outlet.qualification,
        territory: outlet.territory,
        city: outlet.city,
        phone: outlet.phone,
        visitor: call.visitor,
        times: 1,
        required: outlet.required,
        dates: [call.date],
      });
    }
  }
  const byHq = new Map<string, VisitLine[]>();
  for (const [key, line] of grouped) {
    const hqId = key.split(':')[0]!;
    line.dates.sort();
    const list = byHq.get(hqId) ?? [];
    list.push(line);
    byHq.set(hqId, list);
  }
  for (const list of byHq.values()) {
    list.sort(
      (a, b) =>
        a.territory.localeCompare(b.territory) ||
        Number(a.kind === 'chemist') - Number(b.kind === 'chemist') ||
        a.name.localeCompare(b.name) ||
        a.visitor.localeCompare(b.visitor),
    );
  }
  return byHq;
}

export function visitSheets(
  hqs: { id: string; name: string }[],
  lines: Map<string, VisitLine[]>,
  scope: { headquartersId?: string; userId?: string },
): VisitSheet[] {
  const chosen = scope.headquartersId
    ? hqs.filter((hq) => hq.id === scope.headquartersId)
    : scope.userId
      ? hqs.filter((hq) => (lines.get(hq.id)?.length ?? 0) > 0)
      : hqs;
  return chosen.map((hq) => ({ id: hq.id, name: hq.name, lines: lines.get(hq.id) ?? [] }));
}
