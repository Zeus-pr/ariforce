import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AdminProductQuery,
  Id,
  ProductPricesBulkRequest,
  ProductPricesUpdate,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { ProductPricesService } from './product-prices.service';

const id = (v: string, what: string) => {
  if (!Id.safeParse(v).success) throw new NotFoundException(`${what} not found`);
  return v;
};

/** Product prices admin: system_admin only (`products:prices`). docs/PRODUCTS.md */
@Controller({ path: 'admin/products', version: '1' })
export class ProductPricesController {
  constructor(private readonly svc: ProductPricesService) {}

  @Get()
  @RequirePermissions('products:prices')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(AdminProductQuery)) q: z.infer<typeof AdminProductQuery>,
  ) {
    return this.svc.list(p, q);
  }

  @Post('prices/bulk')
  @HttpCode(200)
  @RequirePermissions('products:prices')
  bulk(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(ProductPricesBulkRequest)) b: z.infer<typeof ProductPricesBulkRequest>,
  ) {
    return this.svc.bulk(p, b.rows);
  }

  @Patch(':id/prices')
  @RequirePermissions('products:prices')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(ProductPricesUpdate)) b: z.infer<typeof ProductPricesUpdate>,
  ) {
    return this.svc.update(p, id(i, 'Product'), b);
  }

  @Get(':id/price-history')
  @RequirePermissions('products:prices')
  history(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.history(p, id(i, 'Product'));
  }
}
