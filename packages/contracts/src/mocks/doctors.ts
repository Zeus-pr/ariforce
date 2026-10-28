import { http, HttpResponse } from 'msw';
import { duplicateKeys } from '../import/templates';
import { DoctorDuplicateCheck, type Doctor, type DoctorDuplicate } from '../schemas/masters';
import * as fx from './fixtures';
import { mockPrincipal } from './index';

/** Duplicate rules of #26 (same as import): registration no. (hard), then name w/o "Dr." + pincode (soft). */
function matches(rows: Doctor[], b: Record<string, unknown>): DoctorDuplicate[] {
  const keys = duplicateKeys('doctors', b);
  const out: DoctorDuplicate[] = [];
  for (const r of rows) {
    if (r.deletedAt) continue;
    const theirs = duplicateKeys('doctors', r as unknown as Record<string, unknown>);
    const hit = keys.find((k) => theirs.some((t) => t.rule === k.rule && t.key === k.key));
    if (hit)
      out.push({
        id: r.id,
        name: r.name,
        territoryId: r.territoryId,
        territoryName: fx.territories.find((t) => t.id === r.territoryId)?.name ?? '',
        rule: hit.rule as DoctorDuplicate['rule'],
        approvalStatus: r.approvalStatus,
      });
  }
  return out.sort((a, b2) => (a.rule === b2.rule ? 0 : a.rule === 'registration_no' ? -1 : 1));
}

const conflict = (code: string, message: string, m: DoctorDuplicate[]) =>
  HttpResponse.json({ error: { code, message, details: { matches: m } } }, { status: 409 });

/**
 * Doctors (#26): POST /v1/doctors refuses duplicates and creates field-added doctors `pending`
 * (Director/System Admin -> `approved`); POST /v1/doctors/duplicate-check. The mock opens no approval request.
 */
export function doctorHandlers(
  baseUrl: string,
  crud: (
    onCreate: (
      b: Record<string, unknown>,
      req: Request,
      rows: Doctor[],
    ) => Response | Record<string, unknown>,
    rows: Doctor[],
  ) => ReturnType<typeof http.get>[],
  all: Doctor[] = structuredClone(fx.doctors),
) {
  const handlers = crud((b, req, rows) => {
    const m = matches(rows, b);
    if (m.some((x) => x.rule === 'registration_no'))
      return conflict(
        'DOCTOR_DUPLICATE',
        'A doctor with this registration number already exists',
        m,
      );
    if (m.length && b.allowPossibleDuplicate !== true)
      return conflict(
        'DOCTOR_POSSIBLE_DUPLICATE',
        'A doctor with the same name and pincode exists',
        m,
      );
    const p = mockPrincipal(req);
    const wide = !!p && (p.roles.includes('director') || p.roles.includes('system_admin'));
    return { allowPossibleDuplicate: undefined, approvalStatus: wide ? 'approved' : 'pending' };
  }, all);
  return [
    http.post(`${baseUrl}/v1/doctors/duplicate-check`, async ({ request }) => {
      const b = DoctorDuplicateCheck.safeParse(await request.json());
      if (!b.success)
        return HttpResponse.json(
          { error: { code: 'VALIDATION', message: 'Invalid body' } },
          { status: 422 },
        );
      return HttpResponse.json({ matches: matches(all, b.data) });
    }),
    ...handlers,
  ];
}
