import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class UserCreditListener {
  private readonly logger = new Logger(UserCreditListener.name);

  @OnEvent('user.credit.changed')
  handleUserCreditChanged(payload: {
    userId: string;
    action:
      | 'FREEZE'
      | 'UNFREEZE'
      | 'BURN'
      | 'ADJUST'
      | 'TRANSFER_OUT'
      | 'TRANSFER_IN';
    amount: number;
    creditBefore: number;
    creditAfter: number;
    frozenBefore: number;
    frozenAfter: number;
  }) {
    this.logger.log(
      `user=${payload.userId} action=${payload.action} amount=${payload.amount} credit=${payload.creditBefore}->${payload.creditAfter} frozen=${payload.frozenBefore}->${payload.frozenAfter}`,
    );
  }
}
