import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/** `{ error: { code, message } }` everywhere; never leaks ORM/SQL details (CUTLY toClientError). */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const body = err.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : String((body as { message?: unknown }).message ?? err.message);
      res.status(status).json({ error: { code: CODES[status] ?? 'ERROR', message } });
      return;
    }
    this.log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal error' } });
  }
}
