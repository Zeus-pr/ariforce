import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ProductImageController, ProductPricesController } from './product-prices.controller';
import { ProductPricesService } from './product-prices.service';

@Module({
  imports: [FilesModule],
  controllers: [ProductPricesController, ProductImageController],
  providers: [ProductPricesService],
})
export class ProductPricesModule {}
