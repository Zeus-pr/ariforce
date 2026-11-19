import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DcrDetails,
  SFC_CATEGORY_BAND,
  dcrDetailsKind,
  type Dcr,
  type DcrSubmitResult,
  type DcrBand,
  type DcrDraftPut,
  type DcrProductOption,
  type DcrSfcSnapshot,
  type SfcCategory,
  groupDetailProducts,
  productDisplayName,
} from '@ariforce/contracts';
import {
  companies,
  dcrCalls,
  approvalRequests,
  dcrSfcRoutes,
  dcrs,
  leaveRequests,
  products,
  sfcRoutes,
  territories,
  isCampWorkType,
  roles,
  userRoles,
  users,
  workTypes,
  type Tx,
} from '@ariforce/db';
import { and, asc, desc, eq, inArray, isNull, lte, gte, ne, notInArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { assertDcrDateWritable } from './dcr-date';
import { normaliseDetails } from './details-rules';
import { checkDcrExpenses } from './expense-rules';
import type { DcrExpenseItem } from '@ariforce/contracts';
import { companySettings, localDate } from '../field/field.util';
import { leaveBlocksWork, lockDcrLeave } from '../leave/leave.util';
import { presentationRequired } from './dcr-rules';
import { IMAGE_URL_WINDOW_S, StorageService } from '../files/storage.service';
import {
  SUBMITTED_STATUSES,
  draftsNewestFirst,
  rejectedNewestFirst,
  isDaySubmittedViolation,
  resolveDraftTarget,
  submitConflict,
  submittedOf,
} from './day-report';
import { approvedItemOn, itemCards } from '../plans/tp-items';
import { DcrService, auditDcrAutoApproved, submitStatus } from './dcr.service';
import { isDirector } from '../plans/auto-approve';
import { ExpenseAutoDraftService } from '../expenses/auto-draft.service';
import { resolveSfcCandidates, type SfcSource } from './sfc-resolve';

type WorkTypeRow = typeof workTypes.$inferSelect;
/** A resolved candidate row: the sfc_routes row plus where it came from (own | hq fallback). */
type RouteRow = typeof sfcRoutes.$inferSelect & { source: SfcSource };
type DcrRow = typeof dcrs.$inferSelect;
interface Hq {
  id: string;
  name: string;
}

const num = (v: string | null) => (v === null ? null : Number(v));
/** Band of a work type: field types with an allowance band only (Meeting and other non-field: none). */
export const workTypeBand = (wt: Pick<WorkTypeRow, 'kind' | 'allowanceBand'>): DcrBand | null =>
  wt.kind === 'field' && wt.allowanceBand !== 'none' ? wt.allowanceBand : null;

const candidate = (r: RouteRow) => ({
  id: r.id,
  fromPlace: r.fromPlace,
  toPlace: r.toPlace,
  oneWayKm: Number(r.oneWayKm),
  bothWayKm: Number(r.bothWayKm),
  oneWayAmount: num(r.oneWayAmount),
  bothWayAmount: num(r.bothWayAmount),
  actualFare: r.actualFare,
  travelMode: r.travelMode,
  category: r.category as SfcCategory,
  band: SFC_CATEGORY_BAND[r.category as SfcCategory],
  da: num(r.da),
  version: r.version,
  source: r.source,
});

/**
 * DCR redesign flow (docs/DCR-REDESIGN-DESIGN.md): options, territories, Work With, per-HQ SFC
 * match, draft upsert and submit with frozen per-route TA/DA snapshots. The old PUT /v1/dcrs stays.
 */
@Injectable()
export class DcrFlowService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly dcr: DcrService,
    private readonly storage: StorageService,
    private readonly autoExpense: ExpenseAutoDraftService,
  ) {}

  /** The caller's latest dcr_unlock (dcr_correction) request for the date, or null. */
  private async unlockRequest(tx: Tx, p: Principal, date: string) {
    const [r] = await tx
      .select({
        id: approvalRequests.id,
        status: approvalRequests.state,
        at: approvalRequests.createdAt,
      })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.entityType, 'dcr_correction'),
          eq(approvalRequests.requestedBy, p.userId),
          sql`${approvalRequests.payload}->>'date' = ${date}`,
        ),
      )
      .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id))
      .limit(1);
    return r ? { id: r.id, status: r.status, requestedAt: r.at.toISOString() } : null;
  }

  /** Active products for the DCR pickers, with the presigned image URL (memoised local signing). */
  private async productOptions(tx: Tx, p: Principal): Promise<DcrProductOption[]> {
    return this.signProducts(p, await this.productRows(tx));
  }

  private productRows(tx: Tx, ids?: string[]) {
    return tx
      .select({
        id: products.id,
        divisionId: products.divisionId,
        code: products.code,
        name: products.name,
        brand: products.brand,
        composition: products.composition,
        packSize: products.packSize,
        form: products.form,
        mrp: products.mrp,
        pts: products.pts,
        isSample: products.isSample,
        imageFileKey: products.imageFileKey,
      })
      .from(products)
      .where(
        and(
          isNull(products.deletedAt),
          eq(products.active, true),
          ids ? inArray(products.id, ids) : undefined,
        ),
      )
      .orderBy(asc(sql`lower(${products.name})`), asc(products.id));
  }

  private signProducts(
    p: Principal,
    rows: Awaited<ReturnType<DcrFlowService['productRows']>>,
  ): Promise<DcrProductOption[]> {
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        displayName: productDisplayName(r.name),
        mrp: num(r.mrp),
        pts: num(r.pts),
        imageUrl: r.imageFileKey ? await this.storage.imageUrl(p.companyId, r.imageFileKey) : null,
      })),
    );
  }

  private async workType(tx: Tx, id: string) {
    const [wt] = await tx
      .select()
      .from(workTypes)
      .where(and(eq(workTypes.id, id), isNull(workTypes.deletedAt), eq(workTypes.active, true)));
    if (!wt) throw err(422, 'VALIDATION', 'Unknown work type', { workTypeId: id });
    return wt;
  }

  /** Territories (HQ or level 'territory', in scope) -> distinct HQs in first-seen order. */
  private async resolveHqs(tx: Tx, p: Principal, ids: string[]): Promise<Hq[]> {
    if (!ids.length) return [];
    const rows = await tx
      .select({ id: territories.id, level: territories.level, parentId: territories.parentId })
      .from(territories)
      .where(
        and(
          inArray(territories.id, ids),
          isNull(territories.deletedAt),
          this.tenant.scope(p, territories.path),
        ),
      );
    const miss = ids.filter((t) => !rows.some((r) => r.id === t));
    if (miss.length)
      throw err(422, 'VALIDATION', 'Unknown or out-of-scope territories', { territoryIds: miss });
    const wrong = rows.filter((r) => r.level !== 'headquarter' && r.level !== 'territory');
    if (wrong.length)
      throw err(422, 'VALIDATION', "Pick HQs or territories (level 'territory') only", {
        territoryIds: wrong.map((r) => r.id),
      });
    const hqIds: string[] = [];
    for (const id of ids) {
      const r = rows.find((x) => x.id === id)!;
      const hq = r.level === 'headquarter' ? r.id : r.parentId;
      if (!hq) throw err(422, 'VALIDATION', 'Territory has no HQ', { territoryIds: [id] });
      if (!hqIds.includes(hq)) hqIds.push(hq);
    }
    const names = await tx
      .select({ id: territories.id, name: territories.name })
      .from(territories)
      .where(inArray(territories.id, hqIds));
    return hqIds.map((id) => ({ id, name: names.find((n) => n.id === id)?.name ?? '' }));
  }

  /** The person's own chart in `band`. Rules in ./sfc-resolve.ts. */
  private async chart(tx: Tx, userId: string, band: DcrBand): Promise<RouteRow[]> {
    const rows = await tx
      .select()
      .from(sfcRoutes)
      .where(and(eq(sfcRoutes.userId, userId), isNull(sfcRoutes.deletedAt)));
    return resolveSfcCandidates(rows, userId, band);
  }

  /** Routes chosen for the day's territories, taken from that one chart. */
  private selectRoutes(
    chart: RouteRow[],
    hqs: Hq[],
    chosen: { hqTerritoryId: string; sfcRouteId: string }[],
  ) {
    const routes: RouteRow[] = [];
    const seen = new Set<string>();
    const none: string[] = [];
    const many: { hqTerritoryId: string; candidates: number }[] = [];
    const take = (row: RouteRow) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      routes.push(row);
    };
    for (const h of hqs) {
      const picks = chosen.filter((c) => c.hqTerritoryId === h.id);
      if (picks.length) {
        for (const pick of picks) {
          const row = chart.find((r) => r.id === pick.sfcRouteId);
          if (row) take(row);
        }
      } else if (chart.length === 1) take(chart[0]!);
      else if (!chart.length) none.push(h.id);
      else many.push({ hqTerritoryId: h.id, candidates: chart.length });
    }
    return { routes, none, many };
  }

  /**
   * GET /v1/dcrs/products. The ETag hashes the product rows plus the image-URL signing window, so
   * a 304 never hands back expired picture URLs. `body` is null when `ifNoneMatch` matches.
   */
  products(p: Principal, ids: string[] | undefined, ifNoneMatch: string | undefined) {
    return this.tenant.run(p, async (tx) => {
      const rows = await this.productRows(tx, ids);
      const window = Math.floor(Date.now() / (IMAGE_URL_WINDOW_S * 1000));
      const hash = createHash('sha256')
        .update(JSON.stringify([window, ids ?? null, rows]))
        .digest('base64url')
        .slice(0, 27);
      const etag = `W/"dp-${hash}"`;
      const match = ifNoneMatch
        ?.split(',')
        .map((t) => t.trim())
        .some((t) => t === etag || t === '*');
      if (match) return { etag, body: null };
      const items = await this.signProducts(p, rows);
      return { etag, body: { products: items, detailProducts: groupDetailProducts(items), etag } };
    });
  }

  options(p: Principal, date: string, includeProducts = true) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const wts = await tx
        .select()
        .from(workTypes)
        .where(and(isNull(workTypes.deletedAt), eq(workTypes.active, true)))
        .orderBy(asc(workTypes.code));
      const rows = await tx
        .select()
        .from(dcrs)
        .where(and(eq(dcrs.userId, p.userId), eq(dcrs.date, date), isNull(dcrs.deletedAt)));
      // Several drafts per day, at most one submitted report (0045); rejected ones are history.
      const sub = submittedOf(rows);
      const draftRows = draftsNewestFirst(rows);
      const rejectedRows = rejectedNewestFirst(rows);
      const ordered = [...(sub ? [sub] : []), ...draftRows, ...rejectedRows];
      const dtos = ordered.length ? await this.dcr.toDto(tx, s, ordered) : [];
      const submitted = sub ? dtos[0]! : null;
      const rest = sub ? dtos.slice(1) : dtos;
      const drafts = rest.slice(0, draftRows.length);
      const rejected = rest.slice(draftRows.length);
      // Always include day lock/unlock so clients know a day is open after an approved
      // correction even when there is no DCR row yet.
      const li = await this.dcr.lockInfo(tx, s, p.userId, date);
      return {
        date,
        workTypes: wts.map((w) => ({
          id: w.id,
          code: w.code,
          name: w.name,
          kind: w.kind,
          band: workTypeBand(w),
          usesSfc: workTypeBand(w) !== null,
          detailsKind: dcrDetailsKind(w),
        })),
        dcr: submitted ?? drafts[0] ?? rejected[0] ?? null,
        submitted,
        drafts,
        rejected,
        lockAt: li.lockAt.toISOString(),
        unlockedUntil: li.unlockedUntil?.toISOString() ?? null,
        locked: li.locked,
        unlockRequest: await this.unlockRequest(tx, p, date),
        tourPlanDrafts: await itemCards(tx, p.userId, localDate(new Date(), s.timezone)),
        autoExpenseOnDcrSubmit: await this.autoExpense.enabled(tx, p),
        // Deprecated in favour of GET /v1/dcrs/products; skipped with includeProducts=false.
        ...(includeProducts
          ? await this.productOptions(tx, p).then((products) => ({
              products,
              detailProducts: groupDetailProducts(products),
            }))
          : { products: [], detailProducts: [] }),
      };
    });
  }

  territories(p: Principal) {
    return this.tenant.run(p, async (tx) => {
      const hqs = await tx
        .select({ id: territories.id, code: territories.code, name: territories.name })
        .from(territories)
        .where(
          and(
            eq(territories.level, 'headquarter'),
            isNull(territories.deletedAt),
            this.tenant.scope(p, territories.path),
          ),
        )
        .orderBy(asc(territories.name));
      const kids = hqs.length
        ? await tx
            .select({
              id: territories.id,
              code: territories.code,
              name: territories.name,
              parentId: territories.parentId,
            })
            .from(territories)
            .where(
              and(
                eq(territories.level, 'territory'),
                isNull(territories.deletedAt),
                inArray(
                  territories.parentId,
                  hqs.map((h) => h.id),
                ),
              ),
            )
            .orderBy(asc(territories.name))
        : [];
      return {
        items: hqs.map((h) => ({
          ...h,
          territories: kids
            .filter((k) => k.parentId === h.id)
            .map((k) => ({ id: k.id, code: k.code, name: k.name })),
        })),
      };
    });
  }

  /** Reporting line: people below you, and managers above you up to the Director. Not peers.
   * Director sees everyone. System admin, distribution head, and accountant are excluded.
   */
  private async workWithPeople(tx: Tx, p: Principal) {
    const excluded = new Set(['system_admin', 'distribution_head', 'accountant']);
    const rows = await tx
      .select({
        id: users.id,
        name: users.name,
        employeeCode: users.employeeCode,
        designation: users.designation,
        managerId: users.managerId,
        role: roles.key,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.status, 'active'), isNull(users.deletedAt)));
    const byId = new Map<
      string,
      {
        id: string;
        name: string;
        employeeCode: string | null;
        designation: string | null;
        managerId: string | null;
        roles: string[];
      }
    >();
    for (const row of rows) {
      const cur = byId.get(row.id) ?? {
        id: row.id,
        name: row.name,
        employeeCode: row.employeeCode,
        designation: row.designation,
        managerId: row.managerId,
        roles: [],
      };
      if (row.role) cur.roles.push(row.role);
      byId.set(row.id, cur);
    }
    const visible = [...byId.values()].filter((u) => !u.roles.some((k) => excluded.has(k)));
    const me = byId.get(p.userId);
    if (me?.roles.includes('director')) return visible.filter((u) => u.id !== p.userId);
    const ids = new Set<string>();
    const seen = new Set<string>();
    for (let up = me?.managerId; up && !seen.has(up); up = byId.get(up)?.managerId) {
      seen.add(up);
      ids.add(up);
    }
    const kids = new Map<string, string[]>();
    for (const u of visible) {
      if (!u.managerId) continue;
      const list = kids.get(u.managerId) ?? [];
      list.push(u.id);
      kids.set(u.managerId, list);
    }
    const stack = [...(kids.get(p.userId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === p.userId || ids.has(id)) continue;
      ids.add(id);
      stack.push(...(kids.get(id) ?? []));
    }
    return visible.filter((u) => ids.has(u.id));
  }

  /** Anyone on your reporting line, not the whole company. */
  workWith(p: Principal, q: { q?: string; ids?: string[]; limit: number }) {
    return this.tenant.run(p, async (tx) => {
      const term = q.q?.trim().toLowerCase();
      let items = await this.workWithPeople(tx, p);
      if (q.ids) items = items.filter((u) => q.ids!.includes(u.id));
      else if (term)
        items = items.filter(
          (u) =>
            u.name.toLowerCase().includes(term) ||
            (u.employeeCode ?? '').toLowerCase().startsWith(term),
        );
      items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return {
        items: items.slice(0, q.limit).map(({ id, name, employeeCode, designation }) => ({
          id,
          name,
          employeeCode,
          designation,
        })),
      };
    });
  }

  sfcMatch(p: Principal, q: { date: string; workTypeId: string; territoryIds: string[] }) {
    return this.tenant.run(p, async (tx) => {
      const wt = await this.workType(tx, q.workTypeId);
      const band = workTypeBand(wt);
      if (!band)
        throw err(422, 'VALIDATION', 'SFC applies to field work types only', {
          workTypeId: wt.id,
        });
      const hqs = await this.resolveHqs(tx, p, q.territoryIds);
      let rows: RouteRow[];
      try {
        rows = await this.chart(tx, p.userId, band);
      } catch {
        throw err(503, 'SFC_UNAVAILABLE', 'SFC lookup failed; retry');
      }
      const listed = rows.map(candidate);
      const out = {
        band,
        hqs: hqs.map((h) => ({
          hqTerritoryId: h.id,
          hqName: h.name,
          candidates: listed,
          autoSelectedId: listed.length === 1 ? listed[0]!.id : null,
        })),
      };
      const missingHqIds = out.hqs.filter((h) => !h.candidates.length).map((h) => h.hqTerritoryId);
      if (missingHqIds.length)
        throw err(404, 'SFC_NO_MATCH', 'No SFC route for some HQ of the day', {
          ...out,
          missingHqIds,
        });
      return out;
    });
  }

  /** Chosen routes must be on this person's chart, live, and in the band. */
  private async checkChoices(
    tx: Tx,
    p: Principal,
    choices: { hqTerritoryId: string; sfcRouteId: string }[],
    hqs: Hq[],
    band: DcrBand | null,
  ) {
    if (!choices.length) return;
    if (!band)
      throw err(422, 'VALIDATION', 'SFC applies to field work types only (Meeting never)', {
        field: 'sfcRoutes',
      });
    const foreignHq = choices.filter((c) => !hqs.some((h) => h.id === c.hqTerritoryId));
    if (foreignHq.length)
      throw err(422, 'SFC_MISMATCH', 'Route HQ is not an HQ of the chosen territories', {
        hqTerritoryIds: foreignHq.map((c) => c.hqTerritoryId),
      });
    const ok = await this.chart(tx, p.userId, band);
    const bad = choices.filter((c) => !ok.some((r) => r.id === c.sfcRouteId));
    if (bad.length)
      throw err(422, 'SFC_MISMATCH', 'Route is not on your SFC for this band', {
        sfcRouteIds: bad.map((c) => c.sfcRouteId),
        band,
      });
  }

  private checkDetailsKind(wt: WorkTypeRow, details: DcrDetails | null | undefined) {
    const want = dcrDetailsKind(wt);
    if (details && details.kind !== want)
      throw err(
        422,
        'VALIDATION',
        want ? `details.kind must be '${want}'` : 'No details for this work type',
        {
          field: 'details',
          expected: want,
        },
      );
  }

  private async checkWorkWith(tx: Tx, p: Principal, ids: string[]) {
    if (!ids.length) return;
    const allowed = new Set((await this.workWithPeople(tx, p)).map((u) => u.id));
    const miss = ids.filter((i) => !allowed.has(i));
    if (miss.length) throw err(422, 'VALIDATION', 'Unknown users', { workWithUserIds: miss });
  }

  /** Soft-delete route rows no longer selected; insert the newly chosen routes. */
  private async writeChoices(
    tx: Tx,
    p: Principal,
    dcrId: string,
    choices: { hqTerritoryId: string; sfcRouteId: string }[] | undefined,
    sectionIndex = 0,
  ) {
    const now = new Date();
    const wanted = choices ?? [];
    const keepIds = [...new Set(wanted.map((c) => c.sfcRouteId))];
    await tx
      .update(dcrSfcRoutes)
      .set({ deletedAt: now })
      .where(
        and(
          eq(dcrSfcRoutes.dcrId, dcrId),
          eq(dcrSfcRoutes.sectionIndex, sectionIndex),
          isNull(dcrSfcRoutes.deletedAt),
          keepIds.length ? notInArray(dcrSfcRoutes.sfcRouteId, keepIds) : sql`true`,
        ),
      );
    const live = keepIds.length
      ? await tx
          .select({ sfcRouteId: dcrSfcRoutes.sfcRouteId })
          .from(dcrSfcRoutes)
          .where(
            and(
              eq(dcrSfcRoutes.dcrId, dcrId),
              eq(dcrSfcRoutes.sectionIndex, sectionIndex),
              isNull(dcrSfcRoutes.deletedAt),
            ),
          )
      : [];
    const have = new Set(live.map((r) => r.sfcRouteId));
    for (const c of wanted) {
      if (have.has(c.sfcRouteId)) continue;
      have.add(c.sfcRouteId);
      await tx.insert(dcrSfcRoutes).values({
        id: uuidv7(),
        companyId: p.companyId,
        dcrId,
        hqTerritoryId: c.hqTerritoryId,
        sfcRouteId: c.sfcRouteId,
        sectionIndex,
      });
    }
  }

  draft(p: Principal, b: DcrDraftPut) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      // TP items: the approved item covering the date (asked for, or linked automatically).
      const item = await approvedItemOn(tx, p.userId, b.date);
      if (b.tourPlanItemId && b.tourPlanItemId !== item?.id)
        throw err(422, 'VALIDATION', 'Not your approved tour plan for this date', {
          field: 'tourPlanItemId',
          reason: 'TOUR_PLAN_ITEM_MISMATCH',
        });
      // Lock the caller's live DCRs of the date: a concurrent submit of one of them is seen here.
      const day = await tx
        .select()
        .from(dcrs)
        .where(and(eq(dcrs.userId, p.userId), eq(dcrs.date, b.date), isNull(dcrs.deletedAt)))
        .orderBy(desc(dcrs.updatedAt), desc(dcrs.id))
        .for('update');
      const byId = b.id
        ? (day.find((r) => r.id === b.id) ??
          (
            await tx
              .select()
              .from(dcrs)
              .where(and(eq(dcrs.id, b.id), eq(dcrs.userId, p.userId), isNull(dcrs.deletedAt)))
              .for('update')
          )[0])
        : undefined;
      const li = await this.dcr.lockInfo(tx, s, p.userId, b.date);
      if (li.locked)
        throw err(409, 'DAY_LOCKED', 'This day is locked; request a correction', {
          lockAt: li.lockAt.toISOString(),
        });
      // Then today only (IST); a past day only while unlocked (dcr-date.ts).
      assertDcrDateWritable(b.date, { unlocked: !!li.unlockedUntil });
      let draftInput = b;
      let draftRow = byId;
      const filed = submittedOf(day);
      if (li.unlockedUntil && filed) {
        await tx
          .update(dcrs)
          .set({
            status: 'draft',
            submittedAt: null,
            submittedBy: null,
            submitIdempotencyKey: null,
            approvedAt: null,
            approvedBy: null,
          })
          .where(eq(dcrs.id, filed.id));
        filed.status = 'draft';
        if (!draftInput.id || draftInput.id === filed.id) {
          draftInput = { ...draftInput, id: filed.id, version: filed.version };
          draftRow = filed;
        }
      }
      const target = resolveDraftTarget(draftInput, draftRow, day);
      if (target.action === 'error') {
        if (target.status === 404) throw new NotFoundException('Draft not found');
        const stale =
          target.code === 'VERSION_CONFLICT'
            ? b.id
              ? byId
              : draftsNewestFirst(day)[0]
            : undefined;
        throw err(
          target.status,
          target.code,
          target.message,
          stale ? (await this.dcr.toDto(tx, s, [stale]))[0] : target.details,
        );
      }
      const cur = target.action === 'update' ? target.row : undefined;

      const parts = b.sections?.length
        ? b.sections
        : [
            {
              workTypeId: b.workTypeId,
              territoryIds: b.territoryIds,
              workWithUserIds: b.workWithUserIds,
              sfcRoutes: b.sfcRoutes ?? [],
              details: b.details,
              calls: b.calls,
            },
          ];
      const prepared = [];
      for (const [index, part] of parts.entries()) {
        const wt = await this.workType(tx, part.workTypeId);
        const band = workTypeBand(wt);
        if (
          (wt.kind === 'field' || wt.kind === 'non_field') &&
          (await leaveBlocksWork(tx, p.userId, b.date))
        )
          throw err(422, 'LEAVE_DAY_BLOCKED', 'Leave covers this day, so this report stays closed');
        const camp = isCampWorkType(wt.code);
        if ((camp || wt.kind !== 'field') && part.calls.length)
          throw err(
            422,
            'VALIDATION',
            camp
              ? 'Camp does not take doctor, chemist or stockist calls'
              : 'Calls need a field work type',
            { field: 'calls', section: index },
          );
        this.checkDetailsKind(wt, part.details);
        const hqs = await this.resolveHqs(tx, p, part.territoryIds);
        await this.checkWorkWith(tx, p, part.workWithUserIds);
        await this.checkChoices(tx, p, part.sfcRoutes ?? [], hqs, band);
        prepared.push({ wt, band, hqs, part, details: normaliseDetails(part.details) });
      }
      const head = prepared[0]!;
      // Omitted: the saved list is kept; sent (even []): replaces it.
      const expenses = b.expenses ? checkDcrExpenses(b.expenses) : undefined;
      const calls = prepared.flatMap((row, index) =>
        row.part.calls.map((call) => ({ ...call, sectionIndex: index })),
      );
      const { pts } = await this.dcr.validateCalls(tx, p, { calls }, cur?.id, b.date);
      const plan = await this.dcr.plan(tx, p.userId, b.date);

      const vals = {
        workTypeId: head.part.workTypeId,
        territoryId: head.part.territoryIds[0] ?? null,
        territoryIds: head.part.territoryIds,
        tourPlanId: plan.tourPlanId,
        tourPlanItemId: item?.id ?? null,
        deviationReason: b.deviationReason?.trim() || null,
        band: head.band,
        details: head.details ?? null,
        workWithUserIds: head.part.workWithUserIds,
        sections: b.sections?.length
          ? prepared.map((row) => ({
              workTypeId: row.part.workTypeId,
              territoryIds: row.part.territoryIds,
              workWithUserIds: row.part.workWithUserIds,
              band: row.band,
              details: row.details ?? null,
            }))
          : [],
        status: 'draft' as const,
        ...(expenses ? { expenses } : {}),
      };
      const [row] = cur
        ? await tx.update(dcrs).set(vals).where(eq(dcrs.id, cur.id)).returning()
        : await tx
            .insert(dcrs)
            .values({
              id: uuidv7(),
              companyId: p.companyId,
              userId: p.userId,
              date: b.date,
              ...vals,
            })
            .returning();
      const dcrId = row!.id;
      await this.dcr.writeCalls(tx, p, dcrId, b.date, calls, pts);
      for (const [index, rowSec] of prepared.entries()) {
        await this.writeChoices(
          tx,
          p,
          dcrId,
          rowSec.band ? (rowSec.part.sfcRoutes ?? []) : [],
          index,
        );
      }
      await tx
        .update(dcrSfcRoutes)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(dcrSfcRoutes.dcrId, dcrId),
            sql`${dcrSfcRoutes.sectionIndex} >= ${prepared.length}`,
            isNull(dcrSfcRoutes.deletedAt),
          ),
        );
      await this.audit.record(tx, p, 'dcr.draft_save', {
        entityType: 'dcr',
        entityId: dcrId,
        after: { date: b.date, calls: calls.length, hqs: head.hqs.length, created: !cur },
      });
      const [fresh] = await tx.select().from(dcrs).where(eq(dcrs.id, dcrId));
      return (await this.dcr.toDto(tx, s, [fresh!]))[0]!;
    });
  }

  submit(p: Principal, id: string, version: number, key: string, bodyExpenses?: DcrExpenseItem[]) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const [cur] = await tx
        .select()
        .from(dcrs)
        .where(and(eq(dcrs.id, id), eq(dcrs.userId, p.userId), isNull(dcrs.deletedAt)))
        .for('update');
      if (!cur) throw new NotFoundException('DCR not found');
      // Serialise with leave approval (LEAVE_DCR_CONFLICT): the approved-leave check below then sees
      // any leave approved before us, and an approval after us sees this submitted DCR.
      await lockDcrLeave(tx, p.userId);
      // Retry with the same key: also for a director's report (approved at submit).
      if (
        (cur.status === 'submitted' || cur.status === 'approved') &&
        cur.submitIdempotencyKey === key
      )
        return {
          ...(await this.dcr.toDto(tx, s, [cur]))[0]!,
          expenseDraft: null,
          dcrExpenses: null,
        };
      if (cur.status === 'submitted')
        throw err(409, 'ALREADY_SUBMITTED', 'Already submitted; request a correction', { id });
      if (cur.status !== 'draft' && cur.status !== 'rejected')
        throw err(409, 'ALREADY_SUBMITTED', 'Approved DCRs are read-only', {
          id,
          status: cur.status,
        });
      const [reused] = await tx
        .select({ id: dcrs.id })
        .from(dcrs)
        .where(and(eq(dcrs.userId, p.userId), eq(dcrs.submitIdempotencyKey, key)));
      if (reused)
        throw err(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key already used for another DCR', {
          id: reused.id,
        });
      // Only one submitted report per day; the other drafts of the day are kept.
      const existingId = submitConflict(
        cur.id,
        await tx
          .select()
          .from(dcrs)
          .where(and(eq(dcrs.userId, p.userId), eq(dcrs.date, cur.date), isNull(dcrs.deletedAt))),
      );
      if (existingId)
        throw err(409, 'DAY_ALREADY_SUBMITTED', 'This day already has a submitted report', {
          existingId,
        });
      if (version !== cur.version)
        throw err(
          409,
          'VERSION_CONFLICT',
          'Stale version',
          (await this.dcr.toDto(tx, s, [cur]))[0],
        );
      // Body expenses replace the saved list; omitted: the draft's saved list is used.
      const items = checkDcrExpenses(bodyExpenses ?? ((cur.expenses ?? []) as DcrExpenseItem[]));
      const li = await this.dcr.lockInfo(tx, s, p.userId, cur.date);
      if (li.locked)
        throw err(409, 'DAY_LOCKED', 'This day is locked; request a correction', {
          lockAt: li.lockAt.toISOString(),
        });
      // Then today only (IST); a past day only while unlocked (dcr-date.ts).
      assertDcrDateWritable(cur.date, { unlocked: !!li.unlockedUntil });

      const wt = await this.workType(tx, cur.workTypeId);
      const band = workTypeBand(wt);
      if (
        (wt.kind === 'field' || wt.kind === 'non_field') &&
        (await leaveBlocksWork(tx, p.userId, cur.date))
      )
        throw err(422, 'LEAVE_DAY_BLOCKED', 'Leave covers this day, so this report stays closed');
      const dto = (await this.dcr.toDto(tx, s, [cur]))[0]!;
      const sections = dto.sections?.length
        ? dto.sections
        : [
            {
              workTypeId: cur.workTypeId,
              band: cur.band,
              territoryIds: cur.territoryIds,
              workWithUserIds: cur.workWithUserIds,
              sfcRoutes: dto.sfcRoutes,
              details: dto.details,
              calls: dto.calls,
            },
          ];
      for (const [index, section] of sections.entries()) {
        const secWt = index === 0 ? wt : await this.workType(tx, section.workTypeId);
        const field = secWt.kind === 'field';
        const camp = isCampWorkType(secWt.code);
        if (field && !section.territoryIds.length)
          throw err(422, 'VALIDATION', 'Pick at least one territory', {
            field: 'territoryIds',
            section: index,
          });
        if ((camp || !field) && section.calls.length)
          throw err(
            422,
            'VALIDATION',
            camp
              ? 'Camp does not take doctor, chemist or stockist calls'
              : 'Calls need a field work type',
            { field: 'calls', section: index },
          );
        if (field && !camp && !section.calls.length)
          throw err(422, 'VALIDATION', 'Field work needs at least one call', {
            field: 'calls',
            section: index,
          });
        if (
          (secWt.kind === 'field' || secWt.kind === 'non_field') &&
          (await leaveBlocksWork(tx, p.userId, cur.date))
        )
          throw err(422, 'LEAVE_DAY_BLOCKED', 'Leave covers this day, so this report stays closed');
        this.dcr.assertCheckIns(section.calls);
        if (presentationRequired(p.roles)) this.dcr.assertPresentations(section.calls);
      }
      const hqs = await this.resolveHqs(tx, p, cur.territoryIds);
      await this.checkWorkWith(tx, p, cur.workWithUserIds);
      await this.details(tx, p, wt, cur);
      await this.dcr.validateCalls(
        tx,
        p,
        {
          calls: dto.calls.map(({ id: clientId, ...c }) => ({
            ...c,
            clientId,
            checkInId: c.checkInId,
          })),
        },
        cur.id,
        cur.date,
      );
      const plan = await this.dcr.plan(tx, p.userId, cur.date);
      // TP feature: changes from the approved tour plan no longer need a deviation reason
      // (deviationReason stays optional and is stored as given).

      const chosen = band
        ? dto.sfcRoutes.filter((r) => hqs.some((h) => h.id === r.hqTerritoryId))
        : [];
      await this.checkChoices(tx, p, chosen, hqs, band);
      const routes: RouteRow[] = [];
      if (band) {
        const picked = this.selectRoutes(await this.chart(tx, p.userId, band), hqs, chosen);
        routes.push(...picked.routes);
        if (picked.none.length)
          throw err(422, 'SFC_NO_MATCH', 'No SFC route on your chart for this band', {
            hqTerritoryIds: picked.none,
            band,
          });
        if (picked.many.length)
          throw err(422, 'SFC_ROUTE_REQUIRED', 'Choose at least one SFC route for each HQ', {
            hqs: picked.many,
          });
      }
      const [co] = await tx
        .select({ rate: companies.sfcRatePerKm })
        .from(companies)
        .where(eq(companies.id, p.companyId));
      const frozenAt = new Date().toISOString();
      await this.writeChoices(
        tx,
        p,
        cur.id,
        routes.map((r) => ({ hqTerritoryId: r.hqTerritoryId, sfcRouteId: r.id })),
      );
      for (const r of routes) {
        const snapshot: DcrSfcSnapshot = {
          ...candidate(r),
          sfcRouteId: r.id,
          routeVersion: r.version,
          hqTerritoryId: r.hqTerritoryId,
          band: band!,
          ratePerKm: Number(co!.rate),
          frozenAt,
        };
        delete (snapshot as Partial<{ id: string; version: number }>).id;
        delete (snapshot as Partial<{ id: string; version: number }>).version;
        await tx
          .update(dcrSfcRoutes)
          .set({ snapshot })
          .where(
            and(
              eq(dcrSfcRoutes.dcrId, cur.id),
              eq(dcrSfcRoutes.sectionIndex, 0),
              eq(dcrSfcRoutes.sfcRouteId, r.id),
              isNull(dcrSfcRoutes.deletedAt),
            ),
          );
      }
      for (const [index, section] of sections.entries()) {
        if (index === 0 || !section.band) continue;
        const secHqs = await this.resolveHqs(tx, p, section.territoryIds);
        const secChosen = section.sfcRoutes.map((r) => ({
          hqTerritoryId: r.hqTerritoryId,
          sfcRouteId: r.sfcRouteId,
        }));
        await this.checkChoices(tx, p, secChosen, secHqs, section.band);
        const picked = this.selectRoutes(
          await this.chart(tx, p.userId, section.band),
          secHqs,
          secChosen,
        );
        if (picked.none.length)
          throw err(422, 'SFC_NO_MATCH', 'No SFC route on your chart for this band', {
            hqTerritoryIds: picked.none,
            band: section.band,
            section: index,
          });
        if (picked.many.length)
          throw err(422, 'SFC_ROUTE_REQUIRED', 'Choose at least one SFC route for each HQ', {
            hqs: picked.many,
            section: index,
          });
        await this.writeChoices(
          tx,
          p,
          cur.id,
          picked.routes.map((r) => ({ hqTerritoryId: r.hqTerritoryId, sfcRouteId: r.id })),
          index,
        );
        for (const r of picked.routes) {
          const snapshot: DcrSfcSnapshot = {
            ...candidate(r),
            sfcRouteId: r.id,
            routeVersion: r.version,
            hqTerritoryId: r.hqTerritoryId,
            band: section.band,
            ratePerKm: Number(co!.rate),
            frozenAt,
          };
          delete (snapshot as Partial<{ id: string; version: number }>).id;
          delete (snapshot as Partial<{ id: string; version: number }>).version;
          await tx
            .update(dcrSfcRoutes)
            .set({ snapshot })
            .where(
              and(
                eq(dcrSfcRoutes.dcrId, cur.id),
                eq(dcrSfcRoutes.sectionIndex, index),
                eq(dcrSfcRoutes.sfcRouteId, r.id),
                isNull(dcrSfcRoutes.deletedAt),
              ),
            );
        }
      }
      try {
        // Savepoint: a race with another submit of the same day trips the partial unique index.
        await tx.transaction(async (sp) => {
          await sp
            .update(dcrs)
            .set({
              // Director: approved now by the system (no manager); everyone else: submitted.
              ...submitStatus(p, new Date()),
              submittedAt: new Date(),
              submittedBy: p.userId,
              submitIdempotencyKey: key,
              rejectedAt: null,
              rejectedBy: null,
              rejectionReason: null,
              expenses: items,
              band,
              tourPlanId: plan.tourPlanId,
              tourPlanItemId: (await approvedItemOn(tx, p.userId, cur.date))?.id ?? null,
            })
            .where(eq(dcrs.id, cur.id));
        });
      } catch (e) {
        if (!isDaySubmittedViolation(e)) throw e;
        const [other] = await tx
          .select({ id: dcrs.id })
          .from(dcrs)
          .where(
            and(
              eq(dcrs.userId, p.userId),
              eq(dcrs.date, cur.date),
              isNull(dcrs.deletedAt),
              ne(dcrs.id, cur.id),
              inArray(dcrs.status, [...SUBMITTED_STATUSES]),
            ),
          );
        throw err(409, 'DAY_ALREADY_SUBMITTED', 'This day already has a submitted report', {
          existingId: other?.id ?? null,
        });
      }
      await this.audit.record(tx, p, 'dcr.submit', {
        entityType: 'dcr',
        entityId: cur.id,
        after: { date: cur.date, calls: dto.calls.length, sfcRoutes: routes.map((r) => r.id) },
      });
      if (isDirector(p)) await auditDcrAutoApproved(this.audit, tx, p, cur.id, cur.date);
      // Server TA/DA (company setting autoExpenseOnDcrSubmit); never fails the submit.
      const expenseDraft = await this.autoExpense.onDcrSubmit(tx, p, {
        id: cur.id,
        userId: p.userId,
        date: cur.date,
      });
      // DCR expenses -> month claim lines (origin dcr), idempotent; regardless of the TA/DA
      // setting; claim_locked skips without changes. Never fails the submit.
      const dcrExpenses = await this.autoExpense.linkDcrExpenses(
        tx,
        p,
        { id: cur.id, userId: p.userId, date: cur.date },
        items,
      );
      const [fresh] = await tx.select().from(dcrs).where(eq(dcrs.id, cur.id));
      await this.dcr.notifySubmit(tx, p, fresh!);
      return {
        ...((await this.dcr.toDto(tx, s, [fresh!]))[0]! satisfies Dcr),
        expenseDraft,
        dcrExpenses,
      } satisfies DcrSubmitResult;
    });
  }

  /** DELETE /v1/dcrs/:id: soft-delete one of your drafts with its calls and SFC choices. */
  remove(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const [cur] = await tx
        .select()
        .from(dcrs)
        .where(and(eq(dcrs.id, id), eq(dcrs.userId, p.userId), isNull(dcrs.deletedAt)))
        .for('update');
      if (!cur) throw new NotFoundException('DCR not found');
      if (cur.status !== 'draft')
        throw err(409, 'ALREADY_SUBMITTED', 'Submitted DCRs cannot be deleted', { id });
      const li = await this.dcr.lockInfo(tx, s, p.userId, cur.date);
      if (li.locked)
        throw err(409, 'DAY_LOCKED', 'This day is locked; request a correction', {
          lockAt: li.lockAt.toISOString(),
        });
      const now = new Date();
      const calls = await tx
        .update(dcrCalls)
        .set({ deletedAt: now })
        .where(and(eq(dcrCalls.dcrId, id), isNull(dcrCalls.deletedAt)))
        .returning({ id: dcrCalls.id });
      await tx
        .update(dcrSfcRoutes)
        .set({ deletedAt: now })
        .where(and(eq(dcrSfcRoutes.dcrId, id), isNull(dcrSfcRoutes.deletedAt)));
      await tx.update(dcrs).set({ deletedAt: now }).where(eq(dcrs.id, id));
      await this.audit.record(tx, p, 'dcr.delete', {
        entityType: 'dcr',
        entityId: id,
        before: { date: cur.date, status: cur.status, calls: calls.length },
      });
    });
  }

  /** Non-field details: required shape per work type; leave must reference your leave request. */
  private async details(tx: Tx, p: Principal, wt: WorkTypeRow, cur: DcrRow) {
    const want = dcrDetailsKind(wt);
    if (!want) {
      if (cur.details)
        throw err(422, 'VALIDATION', 'No details for this work type', { field: 'details' });
      return;
    }
    const parsed = DcrDetails.safeParse(cur.details);
    if (!parsed.success || parsed.data.kind !== want)
      throw err(422, 'VALIDATION', `details (kind '${want}') are required`, {
        field: 'details',
        expected: want,
        issues: parsed.success ? undefined : parsed.error.issues.map((i) => i.path.join('.')),
      });
    // Write rules also on submit, so an old draft with a free-text meeting title is caught.
    normaliseDetails(parsed.data);
    if (parsed.data.kind === 'leave') {
      const [lr] = await tx
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.id, parsed.data.leaveRequestId),
            eq(leaveRequests.userId, p.userId),
            isNull(leaveRequests.deletedAt),
            inArray(leaveRequests.status, ['pending', 'approved']),
            lte(leaveRequests.fromDate, cur.date),
            gte(leaveRequests.toDate, cur.date),
          ),
        );
      if (!lr)
        throw err(
          422,
          'LEAVE_NOT_FOUND',
          'No pending or approved leave request of yours covers this date',
          {
            leaveRequestId: parsed.data.leaveRequestId,
          },
        );
    }
  }
}
