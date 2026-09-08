import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The JSON event shape emitted by CalendarSyncService.fetchAndParse(). */
export class CalendarSyncPreviewEventDto {
  @ApiProperty({ type: String })
  uid: string;

  @ApiProperty({ type: String })
  summary: string;

  @ApiPropertyOptional({ type: String })
  description?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  start: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  end: Date;

  @ApiPropertyOptional({ type: String })
  location?: string;

  @ApiProperty({ type: Boolean })
  isAllDay: boolean;

  @ApiPropertyOptional({ type: String })
  rrule?: string;
}

/** The standard HTTP success envelope around calendar preview data. */
export class CalendarSyncPreviewResponseDto {
  @ApiProperty({ type: Number, example: 0 })
  code: number;

  @ApiProperty({ type: String, example: 'OK' })
  message: string;

  @ApiProperty({ type: () => CalendarSyncPreviewEventDto, isArray: true })
  data: CalendarSyncPreviewEventDto[];
}
