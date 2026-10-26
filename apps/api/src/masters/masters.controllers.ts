import { masterReadPermission } from '@ariforce/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  type Type,
} from '@nestjs/common';
import { ImportRequest } from '@ariforce/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { ImportsService } from './imports.service';
import { MASTERS, type MasterDef } from './master-defs';
import { MastersService } from './masters.service';

type Row = Record<string, unknown>;
interface Ops {
  get?: boolean;
  create?: boolean;
  edit?: boolean;
  import?: Parameters<ImportsService['run']>[1];
}

/** One controller per master resource, generated from its MasterDef (routes mirror the contract). */
function masterController(path: string, def: MasterDef, ops: Ops): Type<unknown> {
  @Controller({ path, version: '1' })
  class C {
    constructor(
      readonly svc: MastersService,
      readonly imports: ImportsService,
    ) {}

    @Get()
    @RequirePermissions(masterReadPermission(path))
    list(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(def.listQuery)) q: Row) {
      return this.svc.list(def, p, q);
    }
  }
  const proto = C.prototype as unknown as Record<string, unknown>;
  const add = (
    name: string,
    fn: (...a: never[]) => unknown,
    decorate: (t: object, k: string) => void,
  ) => {
    proto[name] = fn;
    decorate(proto, name);
  };
  const desc = (k: string) => Object.getOwnPropertyDescriptor(proto, k)!;
  const dec = (k: string, ...ds: (MethodDecorator | undefined)[]) => {
    for (const d of ds.reverse()) if (d) d(proto, k, desc(k));
  };
  const param = (k: string, i: number, d: ParameterDecorator) => d(proto, k, i);
  const perm = masterReadPermission(path);

  if (ops.get !== false) {
    add(
      'get',
      function (this: C, p: Principal, id: string) {
        return this.svc.get(def, p, id);
      } as never,
      () => {},
    );
    dec('get', Get(':id'), RequirePermissions(perm));
    param('get', 0, CurrentPrincipal());
    param('get', 1, Param('id'));
  }
  if (ops.create && def.create) {
    add(
      'create',
      function (this: C, p: Principal, body: Row) {
        return this.svc.create(def, p, body);
      } as never,
      () => {},
    );
    dec('create', Post(), HttpCode(201), RequirePermissions(def.writePermission));
    param('create', 0, CurrentPrincipal());
    param('create', 1, Body(new ZodPipe(def.create)));
  }
  if (ops.edit && def.update) {
    add(
      'update',
      function (this: C, p: Principal, id: string, body: Row) {
        return this.svc.update(def, p, id, body);
      } as never,
      () => {},
    );
    dec('update', Patch(':id'), RequirePermissions(def.writePermission));
    param('update', 0, CurrentPrincipal());
    param('update', 1, Param('id'));
    param('update', 2, Body(new ZodPipe(def.update)));
    add(
      'remove',
      function (this: C, p: Principal, id: string) {
        return this.svc.remove(def, p, id);
      } as never,
      () => {},
    );
    dec('remove', Delete(':id'), HttpCode(204), RequirePermissions(def.writePermission));
    param('remove', 0, CurrentPrincipal());
    param('remove', 1, Param('id'));
  }
  if (ops.import) {
    const entity = ops.import;
    add(
      'import',
      function (
        this: C,
        p: Principal,
        body: ImportRequest,
        key: string | undefined,
        res: { status(n: number): void },
      ) {
        res.status(body.dryRun ? 200 : 201); // 200 = dry-run preview, 201 = applied
        return this.imports.run(p, entity, body, key);
      } as never,
      () => {},
    );
    dec('import', Post('import'), RequirePermissions('imports:write', def.writePermission));
    param('import', 0, CurrentPrincipal());
    param('import', 1, Body(new ZodPipe(ImportRequest)));
    param('import', 2, Headers('idempotency-key'));
    param('import', 3, Res({ passthrough: true }));
  }
  Object.defineProperty(C, 'name', { value: `${def.entity}Controller` });
  return C;
}

export const MASTER_CONTROLLERS = [
  masterController('doctors', MASTERS.doctors!, { create: true, edit: true, import: 'doctors' }),
  masterController('chemists', MASTERS.chemists!, { create: true, edit: true, import: 'chemists' }),
  masterController('stockists', MASTERS.stockists!, {
    create: true,
    edit: true,
    import: 'stockists',
  }),
  masterController('products', MASTERS.products!, { create: true, edit: true, import: 'products' }),
  masterController('work-types', MASTERS['work-types']!, { create: true, edit: true }),
  masterController('divisions', MASTERS.divisions!, { get: false, import: 'divisions' }),
  masterController('product-hq-mappings', MASTERS['product-hq-mappings']!, {
    get: false,
    create: true,
    import: 'product_hq',
  }),
  masterController('territories', MASTERS.territories!, { import: 'territories' }),
  masterController('specialties', MASTERS.specialties!, { get: false }),
  masterController('doctor-categories', MASTERS['doctor-categories']!, { get: false }),
];
