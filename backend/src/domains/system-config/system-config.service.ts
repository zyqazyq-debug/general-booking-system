import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { SystemConfig } from './entities/system-config.entity';

@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly TTL = 1000 * 60 * 5;

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepository: Repository<SystemConfig>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async onModuleInit() {
    await this.loadAll();
  }

  private async loadAll() {
    const configs = await this.configRepository.find();
    for (const config of configs) {
      await this.cacheManager.set(
        `sys_config:${config.key}`,
        this.parseValue(config.value, config.type),
        this.TTL,
      );
    }
  }

  private parseValue(value: string, type: string): unknown {
    if (type === 'number') return Number(value);
    if (type === 'boolean') return value === 'true';
    if (type === 'json') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
  }

  async get<T = string>(key: string, defaultValue?: T): Promise<T> {
    const cached = await this.cacheManager.get<T>(`sys_config:${key}`);

    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const config = await this.configRepository.findOne({ where: { key } });
    if (config) {
      const parsed = this.parseValue(config.value, config.type);
      await this.cacheManager.set(`sys_config:${key}`, parsed, this.TTL);
      return parsed as T;
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new Error(`Config key not found: ${key}`);
  }

  async set(
    key: string,
    value: unknown,
    type: 'string' | 'number' | 'boolean' | 'json' = 'string',
    description?: string,
  ) {
    let stringValue = String(value);
    if (type === 'json') stringValue = JSON.stringify(value);

    const config = this.configRepository.create({
      key,
      value: stringValue,
      type,
      description,
    });

    await this.configRepository.save(config);
    await this.cacheManager.set(
      `sys_config:${key}`,
      this.parseValue(stringValue, type),
      this.TTL,
    );
  }
}
