import { Test, TestingModule } from '@nestjs/testing';
import { ProductListingService } from './product-listing.service';

describe('ProductListingService', () => {
  let service: ProductListingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductListingService],
    }).compile();

    service = module.get<ProductListingService>(ProductListingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
