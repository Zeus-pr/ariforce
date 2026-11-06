import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { CompanyMessage, Id, NotificationQuery } from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from './notifications.service';

/** Own notifications only (docs/NOTIFICATIONS.md). Any signed-in user; no extra permission. */
@Controller({ version: '1' })
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get('notifications')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(NotificationQuery)) q: z.infer<typeof NotificationQuery>,
  ) {
    return this.svc.list(p, q);
  }

  @Get('notifications/unread-count')
  unread(@CurrentPrincipal() p: Principal) {
    return this.svc.unreadCount(p);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentPrincipal() p: Principal) {
    return this.svc.readAll(p);
  }

  @Post('notifications/company')
  @HttpCode(200)
  company(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(CompanyMessage)) b: CompanyMessage) {
    return this.svc.broadcast(p, b);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  read(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    if (!Id.safeParse(id).success) throw new NotFoundException('Notification not found');
    return this.svc.read(p, id);
  }

  @Get('jobs/stats')
  stats(@CurrentPrincipal() p: Principal) {
    return this.svc.jobStats(p);
  }
}
