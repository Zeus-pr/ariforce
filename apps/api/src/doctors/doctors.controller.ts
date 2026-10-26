import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Doctor, DoctorCreate, Id, ListQuery } from '@ariforce/contracts';
import { doctors, territories } from '@ariforce/db';
import { and, asc, eq, gt, ilike } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { ZodPipe } from '../common/zod.pipe';

type Row = typeof doctors.$inferSelect;
const toDto = (r: Row): Doctor => ({
  id: r.id,
  companyId: r.companyId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  deletedAt: r.deletedAt?.toISOString() ?? null,
  version: r.version,
  territoryId: r.territoryId,
  name: r.name,
  qualification: r.qualification,
  specialtyId: r.specialtyId,
  categoryId: r.categoryId,
  registrationNo: r.registrationNo,
  addressLine: r.addressLine,
  city: r.city,
  state: r.state,
  pincode: r.pincode,
  location: r.location ? { lat: r.location.y, lng: r.location.x } : null,
  phone: r.phone,
});

/** Doctors: company via RLS, hierarchy via territory-path scope. Out-of-scope = 404 (no existence leak). */
@Controller({ path: 'doctors', version: '1' })
export class DoctorsController {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('masters:read')
  async list(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(ListQuery)) q: ListQuery) {
    const limit = q.limit ?? 50;
    const serverTime = new Date().toISOString();
    const rows = await this.tenant.run(p, (tx) =>
      tx
        .select({ d: doctors })
        .from(doctors)
        .innerJoin(territories, eq(territories.id, doctors.territoryId))
        .where(
          and(
            this.tenant.scope(p, territories.path),
            q.updatedSince ? gt(doctors.updatedAt, new Date(q.updatedSince)) : undefined,
            q.cursor ? gt(doctors.id, q.cursor) : undefined,
            q.q ? ilike(doctors.name, `%${q.q}%`) : undefined,
          ),
        )
        .orderBy(asc(doctors.id))
        .limit(limit + 1),
    );
    const items = rows.slice(0, limit).map((r) => toDto(r.d));
    return {
      items,
      nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
      serverTime,
    };
  }

  @Get(':id')
  @RequirePermissions('masters:read')
  async get(@CurrentPrincipal() p: Principal, @Param('id') id: string): Promise<Doctor> {
    if (!Id.safeParse(id).success) throw new NotFoundException('Doctor not found');
    const [r] = await this.tenant.run(p, (tx) =>
      tx
        .select({ d: doctors })
        .from(doctors)
        .innerJoin(territories, eq(territories.id, doctors.territoryId))
        .where(and(eq(doctors.id, id), this.tenant.scope(p, territories.path))),
    );
    if (!r) throw new NotFoundException('Doctor not found');
    return toDto(r.d);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('masters:write')
  async create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(DoctorCreate)) body: DoctorCreate,
  ): Promise<Doctor> {
    return this.tenant.run(p, async (tx) => {
      const [t] = await tx
        .select({ id: territories.id })
        .from(territories)
        .where(and(eq(territories.id, body.territoryId), this.tenant.scope(p, territories.path)));
      if (!t) throw new ForbiddenException('Territory outside your hierarchy');
      const { location, ...rest } = body;
      const [row] = await tx
        .insert(doctors)
        .values({
          ...rest,
          id: uuidv7(),
          companyId: p.companyId,
          location: location ? { x: location.lng, y: location.lat } : null,
          // Field-added doctors need manager approval (#26); admins add approved masters.
          approvalStatus: p.roles.includes('admin') ? 'approved' : 'pending',
        })
        .returning();
      const dto = toDto(row!);
      await this.audit.record(tx, p, 'doctor.create', {
        entityType: 'doctor',
        entityId: dto.id,
        after: dto,
      });
      return dto;
    });
  }
}
