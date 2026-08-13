import { Injectable, Logger } from '@nestjs/common';
import { Jimp } from 'jimp';
import jsQR from 'jsqr';

type QrImage = {
  bitmap: { data: Buffer; width: number; height: number };
  clone: () => QrImage;
  resize: (options: { w: number; h: number }) => QrImage;
  greyscale: () => QrImage;
  contrast: (value: number) => QrImage;
  normalize: () => QrImage;
  rotate: (deg: number) => QrImage;
};

@Injectable()
export class TelegramQrService {
  private readonly logger = new Logger(TelegramQrService.name);

  async decodeQrFromBuffer(buffer: Buffer): Promise<string | null> {
    const image = (await Jimp.read(buffer)) as unknown as QrImage;
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    this.logger.log(`Decoding QR image size ${width}x${height}`);

    const attempts: QrImage[] = [image.clone()];
    const maxSide = Math.max(width, height);
    if (maxSide < 900) {
      attempts.push(image.clone().resize({ w: width * 2, h: height * 2 }));
    }
    attempts.push(image.clone().greyscale().contrast(0.4).normalize());
    attempts.push(image.clone().greyscale().contrast(0.8).normalize());

    for (const candidate of attempts) {
      const directDecoded = this.decodeQrFromBitmap(
        candidate.bitmap.data,
        candidate.bitmap.width,
        candidate.bitmap.height,
      );
      if (directDecoded) return directDecoded;

      const rotated90 = candidate.clone().rotate(90);
      const decoded90 = this.decodeQrFromBitmap(
        rotated90.bitmap.data,
        rotated90.bitmap.width,
        rotated90.bitmap.height,
      );
      if (decoded90) return decoded90;

      const rotated180 = candidate.clone().rotate(180);
      const decoded180 = this.decodeQrFromBitmap(
        rotated180.bitmap.data,
        rotated180.bitmap.width,
        rotated180.bitmap.height,
      );
      if (decoded180) return decoded180;

      const rotated270 = candidate.clone().rotate(270);
      const decoded270 = this.decodeQrFromBitmap(
        rotated270.bitmap.data,
        rotated270.bitmap.width,
        rotated270.bitmap.height,
      );
      if (decoded270) return decoded270;
    }

    return null;
  }

  private decodeQrFromBitmap(
    data: Buffer,
    width: number,
    height: number,
  ): string | null {
    const code = jsQR(new Uint8ClampedArray(data), width, height, {
      inversionAttempts: 'attemptBoth',
    });
    if (!code?.data) return null;
    return code.data.trim();
  }
}
