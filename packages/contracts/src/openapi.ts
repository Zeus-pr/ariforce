import * as z from 'zod';
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
} from 'zod-openapi';
import { ErrorBody, IdParam, IdempotencyKeyHeader, ListQuery, page } from './schemas/common';
import { Me, SessionInfo, SignInEmailBody } from './schemas/auth';
import { RoleList } from './schemas/roles';
import { Territory } from './schemas/territories';
import {
  Chemist,
  ChemistCreate,
  ChemistUpdate,
  Doctor,
  DoctorCategory,
  DoctorCreate,
  DoctorUpdate,
  Specialty,
  Stockist,
  StockistCreate,
  StockistUpdate,
} from './schemas/masters';

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const err = (description: string) => ({ description, ...json(ErrorBody) });
const std = {
  '401': err('Not signed in'),
  '403': err('Signed in but not allowed (role, hierarchy or tenant)'),
};

function op(o: ZodOpenApiOperationObject): ZodOpenApiOperationObject {
  return { security: [{ session: [] }], ...o, responses: { ...std, ...o.responses } };
}

function crud(
  tag: string,
  base: string,
  item: z.ZodType,
  create: z.ZodType,
  update: z.ZodType,
  name: string,
): ZodOpenApiPathsObject {
  return {
    [base]: {
      get: op({
        tags: [tag],
        operationId: `list${name}s`,
        summary: `List ${tag.toLowerCase()} visible to the caller (own territory subtree)`,
        requestParams: { query: ListQuery },
        responses: { '200': { description: 'Page', ...json(page(item, `${name}Page`)) } },
      }),
      post: op({
        tags: [tag],
        operationId: `create${name}`,
        requestParams: { header: IdempotencyKeyHeader },
        requestBody: json(create),
        responses: {
          '201': { description: 'Created', ...json(item) },
          '422': err('Validation failed'),
        },
      }),
    },
    [`${base}/{id}`]: {
      get: op({
        tags: [tag],
        operationId: `get${name}`,
        requestParams: { path: IdParam },
        responses: { '200': { description: 'OK', ...json(item) }, '404': err('Not found') },
      }),
      patch: op({
        tags: [tag],
        operationId: `update${name}`,
        requestParams: { path: IdParam },
        requestBody: json(update),
        responses: {
          '200': { description: 'Updated', ...json(item) },
          '404': err('Not found'),
          '409': err('Version conflict'),
          '422': err('Validation failed'),
        },
      }),
      delete: op({
        tags: [tag],
        operationId: `delete${name}`,
        summary: 'Soft delete (sets deletedAt tombstone)',
        requestParams: { path: IdParam },
        responses: { '204': { description: 'Deleted' }, '404': err('Not found') },
      }),
    },
  };
}

export type OpenApiDocument = ReturnType<typeof createDocument>;

export function buildOpenApiDocument(): OpenApiDocument {
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'AriForce API',
      version: '1.0.0',
      description: 'Pharma field-force automation. See docs/API-CONVENTIONS.md.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local' }],
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' },
        bearer: { type: 'http', scheme: 'bearer', description: 'Session token (Android app)' },
      },
    },
    paths: {
      '/v1/health': {
        get: {
          tags: ['System'],
          operationId: 'health',
          responses: {
            '200': { description: 'OK', ...json(z.object({ status: z.literal('ok') })) },
          },
        },
      },
      '/v1/auth/sign-in/email': {
        post: {
          tags: ['Auth'],
          operationId: 'signInEmail',
          summary: 'Email + password sign-in (better-auth). Sets the session cookie.',
          requestBody: json(SignInEmailBody),
          responses: {
            '200': {
              description: 'Signed in',
              ...json(z.object({ token: z.string(), user: SessionInfo.shape.user })),
            },
            '401': err('Invalid credentials'),
          },
        },
      },
      '/v1/auth/sign-out': {
        post: op({
          tags: ['Auth'],
          operationId: 'signOut',
          responses: { '200': { description: 'Signed out' } },
        }),
      },
      '/v1/auth/get-session': {
        get: op({
          tags: ['Auth'],
          operationId: 'getSession',
          responses: {
            '200': { description: 'Current session or null', ...json(SessionInfo.nullable()) },
          },
        }),
      },
      '/v1/me': {
        get: op({
          tags: ['Me'],
          operationId: 'getMe',
          responses: { '200': { description: 'Caller', ...json(Me) } },
        }),
      },
      '/v1/roles': {
        get: op({
          tags: ['Roles'],
          operationId: 'listRoles',
          responses: { '200': { description: 'Roles', ...json(RoleList) } },
        }),
      },
      '/v1/territories': {
        get: op({
          tags: ['Territories'],
          operationId: 'listTerritories',
          summary: "Territories in the caller's subtree",
          requestParams: { query: ListQuery },
          responses: { '200': { description: 'Page', ...json(page(Territory, 'TerritoryPage')) } },
        }),
      },
      '/v1/territories/{id}': {
        get: op({
          tags: ['Territories'],
          operationId: 'getTerritory',
          requestParams: { path: IdParam },
          responses: { '200': { description: 'OK', ...json(Territory) }, '404': err('Not found') },
        }),
      },
      '/v1/specialties': {
        get: op({
          tags: ['Masters'],
          operationId: 'listSpecialties',
          requestParams: { query: ListQuery },
          responses: { '200': { description: 'Page', ...json(page(Specialty, 'SpecialtyPage')) } },
        }),
      },
      '/v1/doctor-categories': {
        get: op({
          tags: ['Masters'],
          operationId: 'listDoctorCategories',
          requestParams: { query: ListQuery },
          responses: {
            '200': { description: 'Page', ...json(page(DoctorCategory, 'DoctorCategoryPage')) },
          },
        }),
      },
      ...crud('Doctors', '/v1/doctors', Doctor, DoctorCreate, DoctorUpdate, 'Doctor'),
      ...crud('Chemists', '/v1/chemists', Chemist, ChemistCreate, ChemistUpdate, 'Chemist'),
      ...crud('Stockists', '/v1/stockists', Stockist, StockistCreate, StockistUpdate, 'Stockist'),
    },
  });
}
