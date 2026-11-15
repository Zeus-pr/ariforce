/** One selected SFC route's fare. */
export type RouteFare = {
  id: string;
  bothWayAmount: number | null;
  da: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A section: every route's both-way TA is added, and DA is the greatest DA among them. */
export function sectionTaDa(routes: RouteFare[]) {
  const ta = r2(routes.reduce((sum, r) => sum + (r.bothWayAmount ?? 0), 0));
  const das = routes.map((r) => r.da).filter((n): n is number => n != null);
  return { ta, da: das.length ? r2(Math.max(...das)) : 0 };
}

/**
 * The day: each route's TA is added once, even when two sections select it.
 * One DA is kept, the greatest across those routes.
 */
export function dayTaDa(sections: RouteFare[][]) {
  const once = new Map<string, RouteFare>();
  for (const section of sections) {
    for (const route of section) if (!once.has(route.id)) once.set(route.id, route);
  }
  return sectionTaDa([...once.values()]);
}
