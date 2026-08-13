import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { CalendarSyncService } from './calendar-sync.service';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('Calendar Sync')
@Controller('calendar-sync')
export class CalendarSyncController {
  constructor(private readonly calendarSyncService: CalendarSyncService) {}

  @Get('preview')
  @ApiOperation({ summary: 'Preview events from an ICS URL' })
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
