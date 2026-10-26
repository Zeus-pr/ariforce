import { HttpException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates with the shared zod contract; 422 on failure. */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success)
      throw new HttpException(
        r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        422,
      );
    return r.data;
  }
}
