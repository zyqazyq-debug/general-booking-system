import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import * as ical from 'node-ical';

export interface CalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  isAllDay?: boolean;
  rrule?: string;
}

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  async fetchAndParse(url: string): Promise<CalendarEvent[]> {
    if (!url) {
      throw new BadRequestException('URL is required');
    }

    try {
      this.logger.log(`Fetching calendar from: ${url}`);
      const response = await axios.get<string>(url, {
        responseType: 'text',
        timeout: 15000,
        headers: {
          'User-Agent': 'UniversalBookingSystem/1.0',
        },
      });

      const icsData = response.data;
      if (!icsData || typeof icsData !== 'string') {
        throw new Error('Invalid ICS data received');
      }

      const parsed = ical.parseICS(icsData);

      const events: CalendarEvent[] = [];

      for (const key in parsed) {
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;

        const item = parsed[key];
        if (item?.type === 'VEVENT') {
          const event = item;

          const extendedEvent = event as ical.VEvent & {
            datetype?: string;
            rrule?: { toString: () => string };
          };

          events.push({
            uid: event.uid || key,
            summary: (event.summary as string) || '无标题',
            description: event.description as string,
            start: event.start as Date,
            end: event.end as Date,
            location: event.location as string,
            isAllDay: extendedEvent.datetype === 'date',
            rrule: extendedEvent.rrule?.toString(),
          });
        }
      }

      return events.sort((a, b) => {
        if (!a.start || !b.start) return 0;
        return new Date(a.start).getTime() - new Date(b.start).getTime();
      });
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.logger.error(
        `Failed to fetch/parse calendar from ${url}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Failed to sync calendar: ${error.message}`,
      );
    }
  }
}
