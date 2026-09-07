import { Injectable, Logger, Inject } from '@nestjs/common';
import { CommandParserService } from './command-parser.service';
import type { AuthenticatedUser } from '../../../../shared/common/types/auth-request.type';
import type { PlatformAgencyPort } from '../../../platform-ports';
import { PLATFORM_AGENCY_PORT } from '../../../platform-ports';
import type { PlatformAgencyNodeDto } from '../../../platform-ports';

@Injectable()
export class TelegramImportService {
  private readonly logger = new Logger(TelegramImportService.name);

  constructor(
    @Inject(PLATFORM_AGENCY_PORT)
    private readonly agencyPort: PlatformAgencyPort,
    private readonly commandParser: CommandParserService,
  ) {}

  async preCheckImport(user: AuthenticatedUser, content: string) {
    const { code } = this.commandParser.parseImportText(content);
    if (!code) {
      throw new Error('No valid import code found');
    }
    return this.agencyPort.preCheckImport(user.id, code);
  }

  async importCollection(
    chatId: string,
    user: AuthenticatedUser,
    content: string,
    options?: { forceRecreateOnExisting?: boolean; importAsChild?: boolean },
  ): Promise<{
    collectionNode: PlatformAgencyNodeDto;
    isNew: boolean;
  }> {
    this.logger.log('[TelegramImport] Processing import content.');

    // 1. Parse content using unified CommandParser
    const { code, markupOptions } = this.commandParser.parseImportText(content);

    if (!code) {
      throw new Error('No valid import code found');
    }

    this.logger.log('[TelegramImport] Import content parsed.');

    // 2. Delegate to AgencyService unified import logic
    // This handles resolution, validation, parent lookup, and creation
    const { node: collectionNode, isNew } =
      await this.agencyPort.importCollection(user.id, code, {
        markup_type: markupOptions?.markupType, // 'PERCENTAGE' | 'FIXED'
        markup_value: markupOptions?.markupValue,
        force_recreate_on_existing: options?.forceRecreateOnExisting,
        import_as_child: options?.importAsChild,
        // Alias will be automatically populated from source if not provided here
      });

    return {
      collectionNode,
      isNew,
    };
  }
}
