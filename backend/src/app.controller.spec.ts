import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'DUMMY';
    process.env.JWT_SECRET = 'test_secret_for_e2e_testing_only';
    process.env.JWT_SECRET1 = 'test_secret_for_e2e_testing_only';
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    // it('should return "Hello World!"', () => {
    //   expect(appController.getHello()).toBe('Hello World!');
    // });
    it('should be defined', () => {
      expect(appController).toBeDefined();
    });
  });
});
