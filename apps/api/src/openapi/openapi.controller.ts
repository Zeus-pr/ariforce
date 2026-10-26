import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { buildOpenApiDocument, type OpenApiDocument } from '@ariforce/contracts';

const doc = buildOpenApiDocument();

/** OpenAPI 3.1 document generated from packages/contracts (single source of truth). */
@Controller({ version: VERSION_NEUTRAL })
export class OpenApiController {
  @Get('openapi.json')
  get(): OpenApiDocument {
    return doc;
  }
}
