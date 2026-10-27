import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitedException } from './rate-limit';

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION',
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
      const b = (typeof body === 'string' ? { message: body } : body) as {
        message?: unknown;
        code?: unknown;
        details?: unknown;
      };
      const message = Array.isArray(b.message)
        ? b.message.join('; ')
        : String(b.message ?? err.message);
      const code = typeof b.code === 'string' ? b.code : (CODES[status] ?? 'ERROR');
      if (err instanceof RateLimitedException) res.setHeader('Retry-After', String(err.retryAfter));
      res.status(status).json({
        error: { code, message, ...(b.details === undefined ? {} : { details: b.details }) },
      });
      return;
    }
    this.log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal error' } });
  }
}
