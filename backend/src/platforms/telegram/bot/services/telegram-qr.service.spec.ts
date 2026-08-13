import { Test, TestingModule } from '@nestjs/testing';
import { TelegramQrService } from './telegram-qr.service';
import { Jimp } from 'jimp';
import jsQR from 'jsqr';

// Mock dependencies
jest.mock('jimp', () => ({
  Jimp: {
    read: jest.fn(),
  },
}));

jest.mock('jsqr', () => jest.fn());

describe('TelegramQrService', () => {
  let service: TelegramQrService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TelegramQrService],
    }).compile();

    service = module.get<TelegramQrService>(TelegramQrService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should decode QR code directly without modifications if found on first try', async () => {
    const mockBuffer = Buffer.from('mock');

    // Setup Mock Image
    const mockImage = {
      bitmap: { data: Buffer.from('image-data'), width: 100, height: 100 },
      clone: jest.fn().mockReturnThis(),
      resize: jest.fn().mockReturnThis(),
      greyscale: jest.fn().mockReturnThis(),
      contrast: jest.fn().mockReturnThis(),
      normalize: jest.fn().mockReturnThis(),
      rotate: jest.fn().mockReturnThis(),
    };

    (Jimp.read as jest.Mock).mockResolvedValue(mockImage);

    // Setup jsQR mock to return result on first call
    (jsQR as unknown as jest.Mock).mockReturnValue({
      data: 'https://example.com/qr',
    });

    const result = await service.decodeQrFromBuffer(mockBuffer);

    expect(result).toBe('https://example.com/qr');
    expect(jsQR).toHaveBeenCalledTimes(1);
  });

  it('should try rotated and enhanced images if first attempt fails', async () => {
    const mockBuffer = Buffer.from('mock');

    // Setup Mock Image
    const mockImage = {
      bitmap: { data: Buffer.from('image-data'), width: 500, height: 500 },
      clone: jest.fn().mockReturnThis(),
      resize: jest.fn().mockReturnThis(),
      greyscale: jest.fn().mockReturnThis(),
      contrast: jest.fn().mockReturnThis(),
      normalize: jest.fn().mockReturnThis(),
      rotate: jest.fn().mockReturnThis(),
    };

    (Jimp.read as jest.Mock).mockResolvedValue(mockImage);

    // Mock jsQR to fail a few times then succeed
    (jsQR as unknown as jest.Mock)
      .mockReturnValueOnce(null) // Direct attempt 1 (original) fails
      .mockReturnValueOnce(null) // Rotate 90 fails
      .mockReturnValueOnce(null) // Rotate 180 fails
      .mockReturnValueOnce(null) // Rotate 270 fails
      .mockReturnValueOnce(null) // Direct attempt 2 (resized) fails
      .mockReturnValueOnce(null) // Rotate 90 fails
      .mockReturnValueOnce(null) // Rotate 180 fails
      .mockReturnValueOnce(null) // Rotate 270 fails
      .mockReturnValueOnce({ data: 'success-on-later-attempt' }); // Succeeds!

    const result = await service.decodeQrFromBuffer(mockBuffer);

    expect(result).toBe('success-on-later-attempt');
    expect(jsQR).toHaveBeenCalled();
  });

  it('should return null if QR code cannot be found after all attempts', async () => {
    const mockBuffer = Buffer.from('mock');

    const mockImage = {
      bitmap: { data: Buffer.from('image-data'), width: 100, height: 100 },
      clone: jest.fn().mockReturnThis(),
      resize: jest.fn().mockReturnThis(),
      greyscale: jest.fn().mockReturnThis(),
      contrast: jest.fn().mockReturnThis(),
      normalize: jest.fn().mockReturnThis(),
      rotate: jest.fn().mockReturnThis(),
    };

    (Jimp.read as jest.Mock).mockResolvedValue(mockImage);

    // jsQR always returns null
    (jsQR as unknown as jest.Mock).mockReturnValue(null);

    const result = await service.decodeQrFromBuffer(mockBuffer);

    expect(result).toBeNull();
  });
});
