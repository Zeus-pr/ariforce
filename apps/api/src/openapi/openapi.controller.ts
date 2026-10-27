import { Public } from '../auth/decorators';
import { Controller, Get, NotFoundException, VERSION_NEUTRAL } from '@nestjs/common';
import { buildOpenApiDocument, type OpenApiDocument } from '@ariforce/contracts';

const doc = buildOpenApiDocument();

/** OpenAPI 3.1 document generated from packages/contracts (single source of truth). */
@Public()
@Controller({ version: VERSION_NEUTRAL })
export class OpenApiController {
  @Get('openapi.json')
  get(): OpenApiDocument {
    // Hidden in production (#81); CI and Dev read the spec from packages/contracts, not over HTTP.
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    return doc;
  }
}
