import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AdminProductQuery,
  Id,
  ProductImageSet,
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

/**
 * Product picture (ProductPricesView upload box). Same permission as the price edit
 * (`products:prices`); returns the AdminProduct row with a fresh imageUrl and the new version.
 */
@Controller({ path: 'products', version: '1' })
export class ProductImageController {
  constructor(private readonly svc: ProductPricesService) {}

  @Put(':id/image')
  @RequirePermissions('products:prices')
  setImage(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(ProductImageSet)) b: z.infer<typeof ProductImageSet>,
  ) {
    return this.svc.setImage(p, id(i, 'Product'), b);
  }

  @Delete(':id/image')
  @RequirePermissions('products:prices')
  clearImage(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.clearImage(p, id(i, 'Product'));
  }
}
