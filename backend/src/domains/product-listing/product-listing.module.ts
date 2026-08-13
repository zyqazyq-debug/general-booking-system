import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductListingService } from './product-listing.service';
import { ProductListingController } from './product-listing.controller';
import { ProductListing } from './entities/product-listing.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProductListing])],
  controllers: [ProductListingController],
  providers: [ProductListingService],
  exports: [ProductListingService],
})
export class ProductListingModule {}
