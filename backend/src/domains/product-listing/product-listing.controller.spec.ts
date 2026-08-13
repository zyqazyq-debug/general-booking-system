import { Test, TestingModule } from '@nestjs/testing';
import { ProductListingController } from './product-listing.controller';

describe('ProductListingController', () => {
  let controller: ProductListingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductListingController],
    }).compile();

    controller = module.get<ProductListingController>(ProductListingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
