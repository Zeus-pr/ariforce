import * as z from 'zod';
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
} from 'zod-openapi';
import { ErrorBody, IdParam, IdempotencyKeyHeader, Month, page } from './schemas/common';
import { ImportJob, ImportRequest } from './schemas/imports';
import {
  Division,
  Product,
  ProductCreate,
  ProductHqMapping,
  ProductHqMappingCreate,
  ProductListQuery,
  ProductUpdate,
  WorkType,
  WorkTypeCreate,
  WorkTypeUpdate,
} from './schemas/products';
import {
  Approval,
  ApprovalDecision,
  ApprovalListQuery,
  AttendanceDay,
  CheckIn,
  CheckInCreate,
  CheckInListQuery,
  ConsentState,
  Dcr,
  DcrListQuery,
  DcrUpsert,
  FieldListQuery,
  GeofenceSettings,
  TourPlan,
  TourPlanCopy,
  TourPlanListQuery,
  TourPlanUpsert,
} from './schemas/field';
import { Me, SessionInfo, SignInEmailBody } from './schemas/auth';
import { RoleList } from './schemas/roles';
import { Territory, TerritoryListQuery } from './schemas/territories';
import {
  Chemist,
  ChemistCreate,
  ChemistUpdate,
  CodeNameListQuery,
  Doctor,
  DoctorCategory,
  DoctorCreate,
  DoctorListQuery,
  DoctorUpdate,
  OutletListQuery,
  Specialty,
  Stockist,
  StockistCreate,
  StockistUpdate,
} from './schemas/masters';
import {
  DownloadUrlRequest,
  DownloadUrlResponse,
  UploadUrlRequest,
  UploadUrlResponse,
} from './schemas/files';
import { ConsentGrant, ConsentRecord, Device, DeviceEnrol } from './schemas/devices';

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
  query: z.ZodObject = CodeNameListQuery,
  importable = false,
): ZodOpenApiPathsObject {
  const imp: ZodOpenApiPathsObject = importable
    ? {
        [`${base}/import`]: {
          post: op({
            tags: [tag, 'Imports'],
            operationId: `import${name}s`,
            summary: `Bulk import ${tag.toLowerCase()} from Excel/CSV rows (dry-run first)`,
            description:
              'Validates every row with the create schema, resolves codes (territory, specialty, …) and applies duplicate rules (#26). With dryRun=true nothing is written. See docs/IMPORT.md.',
            requestParams: { header: IdempotencyKeyHeader },
            requestBody: json(ImportRequest),
            responses: {
              '200': { description: 'Dry-run preview', ...json(ImportJob) },
              '201': { description: 'Import applied', ...json(ImportJob) },
              '413': err('More than 5,000 rows'),
              '422': err('Request malformed'),
            },
          }),
        },
      }
    : {};
  return {
    ...imp,
    [base]: {
      get: op({
        tags: [tag],
        operationId: `list${name}s`,
        summary: `List ${tag.toLowerCase()} visible to the caller (own territory subtree)`,
        requestParams: { query },
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
          summary: "Territories in the caller's subtree (cursor-paginated, no 200 cap overall)",
          requestParams: { query: TerritoryListQuery },
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
          summary: 'Read-only in v1',
          requestParams: { query: CodeNameListQuery },
          responses: { '200': { description: 'Page', ...json(page(Specialty, 'SpecialtyPage')) } },
        }),
      },
      '/v1/doctor-categories': {
        get: op({
          tags: ['Masters'],
          operationId: 'listDoctorCategories',
          summary: 'Read-only in v1',
          requestParams: { query: CodeNameListQuery },
          responses: {
            '200': { description: 'Page', ...json(page(DoctorCategory, 'DoctorCategoryPage')) },
          },
        }),
      },
      '/v1/files/upload-url': {
        post: op({
          tags: ['Files'],
          operationId: 'createUploadUrl',
          summary:
            'Presigned R2 PUT URL (10 min). Upload directly to R2, then save fileKey on the record.',
          requestBody: json(UploadUrlRequest),
          responses: {
            '200': { description: 'Presigned upload', ...json(UploadUrlResponse) },
            '422': err('Validation failed (type/size)'),
            '503': err('Storage not configured'),
          },
        }),
      },
      '/v1/files/download-url': {
        post: op({
          tags: ['Files'],
          operationId: 'createDownloadUrl',
          summary: 'Presigned R2 GET URL (5 min) for a fileKey owned by the caller company',
          requestBody: json(DownloadUrlRequest),
          responses: {
            '200': { description: 'Presigned download', ...json(DownloadUrlResponse) },
            '404': err('Unknown or foreign file'),
            '503': err('Storage not configured'),
          },
        }),
      },
      '/v1/devices': {
        get: op({
          tags: ['Devices'],
          operationId: 'listMyDevices',
          responses: {
            '200': {
              description: 'Caller devices',
              ...json(z.object({ items: z.array(Device) }).meta({ id: 'DeviceList' })),
            },
          },
        }),
        post: op({
          tags: ['Devices'],
          operationId: 'enrolDevice',
          summary: 'Enrol this install (company or personal phone)',
          requestBody: json(DeviceEnrol),
          responses: {
            '201': { description: 'Enrolled', ...json(Device) },
            '422': err('Validation failed'),
          },
        }),
      },
      '/v1/devices/{id}/consents': {
        post: op({
          tags: ['Devices'],
          operationId: 'recordConsent',
          summary: 'Grant or withdraw consent (append-only DPDP ledger)',
          requestParams: { path: IdParam },
          requestBody: json(ConsentGrant),
          responses: {
            '201': { description: 'Recorded', ...json(ConsentRecord) },
            '404': err('Not found'),
          },
        }),
      },
      ...crud(
        'Doctors',
        '/v1/doctors',
        Doctor,
        DoctorCreate,
        DoctorUpdate,
        'Doctor',
        DoctorListQuery,
        true,
      ),
      ...crud(
        'Chemists',
        '/v1/chemists',
        Chemist,
        ChemistCreate,
        ChemistUpdate,
        'Chemist',
        OutletListQuery,
        true,
      ),
      ...crud(
        'Stockists',
        '/v1/stockists',
        Stockist,
        StockistCreate,
        StockistUpdate,
        'Stockist',
        OutletListQuery,
        true,
      ),
      ...crud(
        'Products',
        '/v1/products',
        Product,
        ProductCreate,
        ProductUpdate,
        'Product',
        ProductListQuery,
        true,
      ),
      ...crud('WorkTypes', '/v1/work-types', WorkType, WorkTypeCreate, WorkTypeUpdate, 'WorkType'),
      '/v1/divisions': {
        get: op({
          tags: ['Products'],
          operationId: 'listDivisions',
          requestParams: { query: CodeNameListQuery },
          responses: { '200': { description: 'Page', ...json(page(Division, 'DivisionPage')) } },
        }),
      },
      '/v1/product-hq-mappings': {
        get: op({
          tags: ['Products'],
          operationId: 'listProductHqMappings',
          requestParams: { query: ProductListQuery },
          responses: {
            '200': { description: 'Page', ...json(page(ProductHqMapping, 'ProductHqMappingPage')) },
          },
        }),
        post: op({
          tags: ['Products'],
          operationId: 'createProductHqMapping',
          requestBody: json(ProductHqMappingCreate),
          responses: { '201': { description: 'Created', ...json(ProductHqMapping) } },
        }),
      },
      '/v1/imports/{id}': {
        get: op({
          tags: ['Imports'],
          operationId: 'getImportJob',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'Job with per-row results', ...json(ImportJob) },
            '404': err('Not found'),
          },
        }),
      },
      '/v1/check-ins': {
        get: op({
          tags: ['Attendance'],
          operationId: 'listCheckIns',
          summary: 'Check-ins of the caller and their reporting-line team',
          requestParams: { query: CheckInListQuery },
          responses: { '200': { description: 'Page', ...json(page(CheckIn, 'CheckInPage')) } },
        }),
        post: op({
          tags: ['Attendance'],
          operationId: 'createCheckIn',
          summary: 'Punch-in, visit or punch-out with a single GPS fix (no continuous tracking)',
          requestParams: { header: IdempotencyKeyHeader },
          requestBody: json(CheckInCreate),
          responses: {
            '201': { description: 'Recorded', ...json(CheckIn) },
            '200': { description: 'Already recorded (same clientId)', ...json(CheckIn) },
            '409': err('Sequence error (e.g. visit before punch-in, second punch-in)'),
            '412': err('Consent missing (DPDP)'),
            '422': err('Validation failed, out of fence or mock location when blocked'),
          },
        }),
      },
      '/v1/attendance': {
        get: op({
          tags: ['Attendance'],
          operationId: 'listAttendance',
          summary: 'One row per user per day',
          requestParams: { query: FieldListQuery },
          responses: {
            '200': { description: 'Page', ...json(page(AttendanceDay, 'AttendanceDayPage')) },
          },
        }),
      },
      '/v1/settings/geofence': {
        get: op({
          tags: ['Settings'],
          operationId: 'getGeofenceSettings',
          responses: { '200': { description: 'OK', ...json(GeofenceSettings) } },
        }),
        put: op({
          tags: ['Settings'],
          operationId: 'putGeofenceSettings',
          summary: 'Requires settings:write',
          requestBody: json(GeofenceSettings),
          responses: {
            '200': { description: 'Saved', ...json(GeofenceSettings) },
            '409': err('Version conflict'),
          },
        }),
      },
      '/v1/me/consent': {
        get: op({
          tags: ['Me'],
          operationId: 'getConsentState',
          responses: {
            '200': { description: 'Consent state for this device', ...json(ConsentState) },
          },
        }),
      },
      '/v1/tour-plans': {
        get: op({
          tags: ['TourPlans'],
          operationId: 'listTourPlans',
          requestParams: { query: TourPlanListQuery },
          responses: { '200': { description: 'Page', ...json(page(TourPlan, 'TourPlanPage')) } },
        }),
      },
      '/v1/tour-plans/{month}': {
        get: op({
          tags: ['TourPlans'],
          operationId: 'getTourPlan',
          summary: "Caller's plan for the month (or userId's, if in team). Used for DCR prefill.",
          requestParams: {
            path: z.object({ month: Month }),
            query: z.object({ userId: IdParam.shape.id.optional() }),
          },
          responses: { '200': { description: 'OK', ...json(TourPlan) }, '404': err('No plan') },
        }),
        put: op({
          tags: ['TourPlans'],
          operationId: 'upsertTourPlan',
          requestParams: { path: z.object({ month: Month }) },
          requestBody: json(TourPlanUpsert),
          responses: {
            '200': { description: 'Saved draft', ...json(TourPlan) },
            '409': err('Not editable (submitted/approved) or version conflict'),
          },
        }),
      },
      '/v1/tour-plans/{month}/copy': {
        post: op({
          tags: ['TourPlans'],
          operationId: 'copyTourPlan',
          requestParams: { path: z.object({ month: Month }) },
          requestBody: json(TourPlanCopy),
          responses: {
            '200': { description: 'Draft created from STP/previous month', ...json(TourPlan) },
          },
        }),
      },
      '/v1/tour-plans/{month}/submit': {
        post: op({
          tags: ['TourPlans'],
          operationId: 'submitTourPlan',
          requestParams: { path: z.object({ month: Month }) },
          responses: {
            '200': { description: 'Submitted; approval created', ...json(TourPlan) },
            '409': err('Not in draft'),
          },
        }),
      },
      '/v1/dcrs': {
        get: op({
          tags: ['DCR'],
          operationId: 'listDcrs',
          requestParams: { query: DcrListQuery },
          responses: { '200': { description: 'Page', ...json(page(Dcr, 'DcrPage')) } },
        }),
        put: op({
          tags: ['DCR'],
          operationId: 'upsertDcr',
          summary:
            "Create or update the caller's DCR for a date (idempotent on date + call clientIds)",
          requestBody: json(DcrUpsert),
          responses: {
            '200': { description: 'Saved', ...json(Dcr) },
            '409': err('Day locked or version conflict'),
            '422': err('Validation failed (e.g. deviation reason missing)'),
          },
        }),
      },
      '/v1/dcrs/{id}': {
        get: op({
          tags: ['DCR'],
          operationId: 'getDcr',
          requestParams: { path: IdParam },
          responses: { '200': { description: 'OK', ...json(Dcr) }, '404': err('Not found') },
        }),
      },
      '/v1/approvals': {
        get: op({
          tags: ['Approvals'],
          operationId: 'listApprovals',
          requestParams: { query: ApprovalListQuery },
          responses: { '200': { description: 'Page', ...json(page(Approval, 'ApprovalPage')) } },
        }),
      },
      '/v1/approvals/{id}/decision': {
        post: op({
          tags: ['Approvals'],
          operationId: 'decideApproval',
          summary:
            'Approve or reject. Only a manager above the requester in the reporting line (approvals:decide).',
          requestParams: { path: IdParam },
          requestBody: json(ApprovalDecision),
          responses: {
            '200': { description: 'Decided', ...json(Approval) },
            '404': err('Not found'),
            '409': err('Already decided'),
          },
        }),
      },
    },
  });
}
