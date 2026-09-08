import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { CalendarSyncService } from './calendar-sync.service';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CalendarSyncPreviewResponseDto } from './dto/calendar-sync-preview-event.dto';

@ApiTags('Calendar Sync')
@Controller('calendar-sync')
export class CalendarSyncController {
  constructor(private readonly calendarSyncService: CalendarSyncService) {}

  @Get('preview')
  @ApiOperation({ summary: 'Preview events from an ICS URL' })
  @ApiOkResponse({ type: CalendarSyncPreviewResponseDto, description: 'Parsed calendar events ordered by start time.' })
  @ApiQuery({
    name: 'url',
    description: 'ICS subscription URL',
    required: true,
  })
  async preview(@Query('url') url: string) {
    if (!url) {
      throw new BadRequestException('URL parameter is required');
    }
    return await this.calendarSyncService.fetchAndParse(url);
  }
}
