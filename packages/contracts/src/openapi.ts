import {
  ExceptionEvaluateRequest,
  ExceptionEvaluateResult,
  ExceptionItem,
  ExceptionListQuery,
  ExceptionNote,
  ExceptionPage,
  ExceptionRule,
  ExceptionRuleList,
  ExceptionRuleParam,
  ExceptionRuleUpdate,
  ExceptionSummary,
  ExceptionSummaryQuery,
  ExceptionUpdate,
} from './schemas/exceptions';
import {
  JobStats,
  NotificationPage,
  NotificationQuery,
  Notification as NotificationSchema,
  ReadAllResult,
  UnreadCount,
} from './schemas/notifications';
import { ApprovalDetail } from './schemas/approval-detail';
import * as z from 'zod';
import { masterReadPermission } from './schemas/roles';
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
} from 'zod-openapi';
import { ErrorBody, Id, IdParam, IdempotencyKeyHeader, Month, page } from './schemas/common';
import { ImportJob, ImportRequest } from './schemas/imports';
import {
  AdminProduct,
  AdminProductList,
  AdminProductQuery,
  ProductPriceHistory,
  ProductPricesBulkRequest,
  ProductPricesBulkResponse,
  ProductPricesUpdate,
} from './schemas/product-prices';
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
  UserListQuery,
  UserSummary,
  CompetitorBrandList,
  CompetitorBrandQuery,
  ConsentState,
  Dcr,
  DcrListQuery,
  DcrCorrectionRequest,
  DcrUpsert,
  FieldListQuery,
  GeofenceSettings,
  TourPlan,
  TourPlanCalendar,
  StandardTourPlan,
  StandardTourPlanUpsert,
  TourPlanCopy,
  TourPlanListQuery,
  TourPlanSubmit,
  TourPlanUpsert,
} from './schemas/field';
import {
  AllowanceDraftRequest,
  AllowanceDraftResult,
  AllowancePlace,
  AllowancePlaceInput,
  AllowancePlaceList,
  AllowancePlaceQuery,
  AllowancePlaceUpdate,
  AllowanceRate,
  AllowanceRateInput,
  AllowanceRateList,
  AllowanceRateQuery,
  AllowanceRateUpdate,
} from './schemas/allowances';
import {
  SfcEmployeeList,
  SfcEmployeeQuery,
  SfcHqList,
  SfcSettings,
  SfcTable,
  SfcTablePut,
} from './schemas/sfc';
import {
  Me,
  PasswordForgot,
  PasswordForgotAccepted,
  PasswordReset,
  PasswordResetDone,
  SessionInfo,
  SignInEmailBody,
} from './schemas/auth';
import { RoleList } from './schemas/roles';
import { Health } from './schemas/health';
import { KpiQuery, KpiReport, ProductKpiReport } from './schemas/kpis';
import { Territory, TerritoryListQuery } from './schemas/territories';
import {
  Chemist,
  ChemistCreate,
  ChemistUpdate,
  CodeNameListQuery,
  Doctor,
  DoctorCategory,
  DoctorCreate,
  DoctorDuplicateCheck,
  DoctorDuplicateResult,
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
import {
  EmployeeCreate,
  EmployeeCreated,
  EmployeeInviteBulk,
  InviteBulkResponse,
  EmployeeUpdate,
  Invite,
  InviteAccept,
  InviteAccepted,
  ManagerAssign,
  TeamNode,
  TeamTree,
} from './schemas/team';
import {
  SignupApprove,
  SignupReject,
  SignupRequest,
  SignupRequestAccepted,
  SignupOptions,
  SignupRequestCreate,
  SignupRequestList,
  SignupRequestQuery,
} from './schemas/signup';
import {
  ExpenseAttachment,
  ExpenseAttachmentCreate,
  ExpenseAttachmentUpload,
  ExpenseClaim,
  ExpenseClaimCreate,
  ExpenseClaimList,
  ExpenseClaimListQuery,
  ExpenseDecision,
  ExpenseDownload,
  ExpenseExportQuery,
  ExpenseLineInput,
  ExpenseLineUpdate,
  ExpensePay,
  ExpenseReconciliation,
  ExpenseReport,
  ExpenseReportQuery,
} from './schemas/expenses';
import {
  LeaveApply,
  LeaveBalance,
  LeaveBalanceQuery,
  LeaveCalendar,
  LeaveCalendarQuery,
  LeaveCancel,
  LeaveCarryForward,
  LeaveCarryForwardResult,
  LeaveCode,
  LeaveDecision,
  LeaveGrant,
  LeaveGrantCreate,
  LeaveGrantList,
  LeaveGrantQuery,
  LeaveRequest,
  LeaveRequestList,
  LeaveRequestQuery,
  LeaveSettings,
  LeaveSettingsUpdate,
  LeaveType,
  LeaveTypeList,
  LeaveTypeUpdate,
} from './schemas/leave';
import {
  TeamMemberChemistPage,
  TeamMemberDoctorPage,
  TeamOutletQuery,
  TeamPerformance,
  TeamPerformanceQuery,
  TeamProfile,
  TeamProfileExportQuery,
} from './schemas/team-profile';
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

function importPath(tag: string, base: string, name: string): ZodOpenApiPathsObject {
  return {
    [`${base}/import`]: {
      post: op({
        tags: [tag, 'Imports'],
        operationId: `import${name}s`,
        summary: `Bulk import ${tag.toLowerCase()} from Excel/CSV rows (dry-run first)`,
        description:
          'Rows use the snake_case template columns with master codes (territory_code, specialty_code, division_code, …; camelCase keys and *_id UUIDs accepted as aliases). Each row is mapped and validated with the create schema, then duplicate rules (#26) apply. With dryRun=true nothing is written to the master table (the job and its row results are still stored). Upload the source sheet first via POST /v1/files/upload-url (purpose import_source) and pass fileKey. See docs/IMPORT.md.',
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
  };
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
  createConflict?: string,
): ZodOpenApiPathsObject {
  const imp: ZodOpenApiPathsObject = importable ? importPath(tag, base, name) : {};
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
          ...(createConflict ? { '409': err(createConflict) } : {}),
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

const MASTER_SEGMENTS = new Set([
  'doctors',
  'chemists',
  'stockists',
  'products',
  'divisions',
  'territories',
  'work-types',
  'product-hq-mappings',
  'specialties',
  'doctor-categories',
]);
/** Permission(s) the API requires for masters endpoints (docs/RBAC.md); undefined = not a master route. */
export function mastersPermissions(path: string, method: string): string[] | undefined {
  const [, , seg, rest] = path.split('/');
  if (seg === 'imports') return ['imports:write'];
  if (!seg || !MASTER_SEGMENTS.has(seg)) return undefined;
  const read = masterReadPermission(seg);
  const write = seg === 'territories' ? 'territories:write' : 'masters:write';
  if (method === 'get' || (seg === 'doctors' && rest === 'duplicate-check')) return [read];
  return rest === 'import' ? ['imports:write', write] : [write];
}

export function buildOpenApiDocument(): OpenApiDocument {
  const doc = buildDocument();
  for (const [path, item] of Object.entries(doc.paths ?? {}))
    for (const [method, o] of Object.entries(item ?? {})) {
      const perms = mastersPermissions(path, method);
      if (!perms || typeof o !== 'object' || !o || !('responses' in o)) continue;
      const opObj = o as { description?: string; responses: Record<string, unknown> } & Record<
        string,
        unknown
      >;
      opObj['x-required-permissions'] = perms;
      const write = perms.some((x) => x.endsWith(':write'));
      opObj.description = [
        opObj.description,
        `Requires: ${perms.join(' + ')}.${write ? ' Masters write = RBM and above or system_admin; ABM/BM get 403.' : ' Results are territory-subtree scoped.'}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      opObj.responses['403'] ??= {
        description: 'Missing permission',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      };
    }
  return doc;
}

function buildDocument(): OpenApiDocument {
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
            '200': {
              description: 'OK. `warnings` are informational and never change the status',
              ...json(Health),
            },
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
        'DOCTOR_DUPLICATE: same registration number (cannot be overridden); DOCTOR_POSSIBLE_DUPLICATE: same name (without "Dr.") + pincode, re-send with allowPossibleDuplicate: true. details.matches: DoctorDuplicate[]. Field-added doctors are created pending with an approval request (docs/DOCTOR-APPROVAL.md)',
      ),
      '/v1/doctors/duplicate-check': {
        post: op({
          tags: ['Doctors'],
          operationId: 'checkDoctorDuplicates',
          summary:
            'Existing doctors (company-wide) matching registration no. or name + pincode, for the add-doctor form (#26)',
          requestBody: json(DoctorDuplicateCheck),
          responses: {
            '200': { description: 'Matches, strong first', ...json(DoctorDuplicateResult) },
            '422': err('Validation failed'),
          },
        }),
      },
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
      ...importPath('Products', '/v1/divisions', 'Division'),
      ...importPath('Territories', '/v1/territories', 'Territory'),
      ...importPath('Products', '/v1/product-hq-mappings', 'ProductHqMapping'),
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
      '/v1/users': {
        get: op({
          tags: ['Users'],
          operationId: 'listUsers',
          summary: 'Team directory: the caller and their reporting line (gap #3)',
          requestParams: { query: UserListQuery },
          responses: {
            '200': { description: 'Page', ...json(page(UserSummary, 'UserSummaryPage')) },
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
            '404': err('Outlet not found or outside your territories'),
            '412': err(
              'No active enrolled device (DEVICE_NOT_ACTIVE) or consent missing (CONSENT_REQUIRED)',
            ),
            '422': err(
              'Validation failed; LOW_ACCURACY, MOCK_LOCATION or OUT_OF_FENCE when the company policy blocks',
            ),
          },
        }),
      },
      '/v1/kpis': {
        get: op({
          tags: ['KPIs'],
          operationId: 'getKpis',
          summary:
            'KPI report (docs/kpi-definitions.md). Requires reports:read; scoped to the reporting line',
          requestParams: { query: KpiQuery },
          responses: {
            '200': { description: 'OK', ...json(KpiReport) },
            '403': err('rollup=company without company-wide scope, or userId outside your team'),
            '422': err('Invalid query'),
          },
        }),
      },
      '/v1/kpis/products': {
        get: op({
          tags: ['KPIs'],
          operationId: 'getProductKpis',
          summary: 'Product-wise detailing, samples and POB',
          requestParams: { query: KpiQuery },
          responses: {
            '200': { description: 'OK', ...json(ProductKpiReport) },
            '403': err('userId outside your team'),
            '422': err('Invalid query'),
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
      '/v1/tour-plans/standard': {
        get: op({
          tags: ['TourPlans'],
          operationId: 'getStandardTourPlan',
          summary:
            "Caller's standard plan (STP), or userId's if in team. Empty days when none saved.",
          requestParams: { query: z.object({ userId: IdParam.shape.id.optional() }) },
          responses: {
            '200': { description: 'OK', ...json(StandardTourPlan) },
            '403': err('User outside your team'),
          },
        }),
        put: op({
          tags: ['TourPlans'],
          operationId: 'upsertStandardTourPlan',
          summary: "Replace the caller's standard plan",
          requestBody: json(StandardTourPlanUpsert),
          responses: {
            '200': { description: 'Saved', ...json(StandardTourPlan) },
            '409': err('Version conflict'),
            '422': err(
              'Validation failed (duplicate week/weekday, unknown work type or territory)',
            ),
          },
        }),
      },
      '/v1/tour-plans/{month}': {
        get: op({
          tags: ['TourPlans'],
          operationId: 'getTourPlan',
          summary: "Caller's plan for the month (or userId's, if in team), or one plan by id.",
          description:
            '`{month}` is YYYY-MM, or a tour plan id (uuid). By id: readable by the owner, their reporting line with field:read, or an assigned approver (current or past step); otherwise 404. `userId` is ignored for an id.',
          requestParams: {
            path: z.object({
              month: z.union([Month, IdParam.shape.id]).meta({ description: 'YYYY-MM or plan id' }),
            }),
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
            '200': { description: 'Saved', ...json(TourPlan) },
            '409': err(
              'DAY_LOCKED (details.dates): a submitted/approved day was changed or removed (#86); or VERSION_CONFLICT. Other days are always editable',
            ),
            '422': err(
              'Validation failed (date outside month, duplicate date, unknown work type/territory)',
            ),
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
            '200': { description: 'Draft filled from the STP or another month', ...json(TourPlan) },
            '404': err('Source plan not found'),
            '409': err('VERSION_CONFLICT. Submitted/approved days are kept as they are (#86)'),
          },
        }),
      },
      '/v1/tour-plans/{month}/submit': {
        post: op({
          tags: ['TourPlans'],
          operationId: 'submitTourPlan',
          requestParams: { path: z.object({ month: Month }) },
          requestBody: { required: false, ...json(TourPlanSubmit) },
          responses: {
            '200': {
              description:
                'New submission (its own approval request) holding the chosen days; see `submissions` (#86)',
              ...json(TourPlan),
            },
            '404': err('No plan for the month'),
            '409': err('DAY_LOCKED (details.dates): a chosen day is already submitted or approved'),
            '422': err(
              'EMPTY_PLAN: the plan has no day with an entry. Any other day (past, weekly off, leave, unplanned) may be empty.',
            ),
          },
        }),
      },
      '/v1/tour-plans/{month}/calendar': {
        get: op({
          tags: ['TourPlans'],
          operationId: 'getTourPlanCalendar',
          description:
            'Submit rule inputs for a month (no plan needed): today in IST, company weekly-off days, required dates.',
          requestParams: { path: z.object({ month: Month }) },
          responses: { '200': { description: 'OK', ...json(TourPlanCalendar) } },
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
            '409': err('DAY_LOCKED (request a correction) or VERSION_CONFLICT'),
            '422': err(
              'Validation failed: DEVIATION_REASON_REQUIRED, future date, calls on a non-field day, unknown or inactive products, a check-in that is not your visit to that outlet, RCPA on a non-chemist call (details.rcpaOutletCallIds), duplicate POB products or RCPA brands in a call (details.duplicatePob / duplicateRcpa), or an out-of-scope stockistId / RCPA doctorId',
            ),
          },
        }),
      },
      '/v1/rcpa/competitor-brands': {
        get: op({
          tags: ['DCR'],
          operationId: 'listCompetitorBrands',
          summary: 'Competitor brands already captured in RCPA in your company (#40)',
          description:
            'Distinct brands (case-insensitive, most used first) so reps reuse an existing spelling. q matches a prefix of any word. Needs field:read.',
          requestParams: { query: CompetitorBrandQuery },
          responses: { '200': { description: 'OK', ...json(CompetitorBrandList) } },
        }),
      },
      '/v1/dcrs/correction-requests': {
        post: op({
          tags: ['DCR'],
          operationId: 'requestDcrCorrection',
          summary: 'Ask your manager to reopen a locked day (gap #8)',
          requestBody: json(DcrCorrectionRequest),
          responses: {
            '201': { description: 'Approval request created', ...json(Approval) },
            '409': err('Day is not locked, or already unlocked'),
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
      '/v1/team': {
        get: op({
          tags: ['Team'],
          operationId: 'getTeam',
          summary:
            'The caller and their reporting-line subtree (flat, depth-first) plus unassigned people in their territory scope',
          responses: { '200': { description: 'OK', ...json(TeamTree) } },
        }),
      },
      '/v1/team/{id}/manager': {
        post: op({
          tags: ['Team'],
          operationId: 'assignManager',
          summary:
            'Set the manager of someone in your subtree or unassigned list; the new manager must be you or in your subtree and rank above them',
          requestParams: { path: IdParam },
          requestBody: json(ManagerAssign),
          responses: {
            '200': { description: 'Assigned', ...json(TeamNode) },
            '403': err('Target or manager outside your scope, or rank rule broken'),
            '404': err('Not found'),
            '409': err('Would create a reporting cycle'),
          },
        }),
      },
      '/v1/employees': {
        post: op({
          tags: ['Team'],
          operationId: 'createEmployee',
          summary:
            'ABM and above: add an employee with a role strictly below yours, territory in your subtree; creates a single-use invite',
          requestBody: json(EmployeeCreate),
          responses: {
            '201': { description: 'Created (status invited)', ...json(EmployeeCreated) },
            '403': err('Privilege escalation or outside your scope'),
            '409': err('Email or employee code already exists'),
            '422': err('Validation failed'),
          },
        }),
      },
      '/v1/employees/invite-bulk': {
        post: op({
          tags: ['Team'],
          operationId: 'inviteEmployeesBulk',
          summary:
            'ABM and above: create + invite up to 200 employees. Each row follows the single createEmployee rules and is saved (and audited) on its own; partial success returns 200 with per-row results',
          requestBody: json(EmployeeInviteBulk),
          responses: {
            '200': {
              description: 'Per-row results (invited | skipped | failed)',
              ...json(InviteBulkResponse),
            },
            '403': err('Only ABM and above can add employees'),
            '422': err('Body is not { employees: [1..200 objects] }'),
          },
        }),
      },
      '/v1/employees/{id}': {
        patch: op({
          tags: ['Team'],
          operationId: 'updateEmployee',
          summary:
            'Edit, move, deactivate or reactivate someone below you in your subtree (never yourself or anyone at/above your level)',
          requestParams: { path: IdParam },
          requestBody: json(EmployeeUpdate),
          responses: {
            '200': { description: 'Saved', ...json(TeamNode) },
            '403': err('Privilege escalation or outside your scope'),
            '404': err('Not found'),
            '409': err('Version conflict or reporting cycle'),
          },
        }),
      },
      '/v1/employees/{id}/invite': {
        post: op({
          tags: ['Team'],
          operationId: 'reinviteEmployee',
          summary: 'Issue a new invite (revokes earlier unused ones) for an invited employee',
          requestParams: { path: IdParam },
          responses: {
            '201': { description: 'Invite issued', ...json(Invite) },
            '403': err('Outside your scope'),
            '404': err('Not found'),
            '409': err('Employee already active'),
          },
        }),
      },
      '/v1/invites/accept': {
        post: {
          tags: ['Team'],
          operationId: 'acceptInvite',
          summary:
            'Public. Single-use, expiring token from the invite link: creates the sign-in identity and activates the employee',
          requestBody: json(InviteAccept),
          responses: {
            '200': {
              description: 'Activated; sign in with email + password',
              ...json(InviteAccepted),
            },
            '404': err('INVITE_INVALID: unknown token, or replaced by a newer invite'),
            '409': err('INVITE_USED: already redeemed (or the account already exists)'),
            '410': err('INVITE_EXPIRED: past its expiry; ask for a new invite'),
            '422': err('VALIDATION: password shorter than 12 characters (or token malformed)'),
            '429': err('RATE_LIMITED: too many attempts from this IP; Retry-After header'),
          },
        },
      },
      '/v1/auth/sign-up-options': {
        get: {
          tags: ['Auth'],
          operationId: 'getSignUpOptions',
          summary:
            'Public. Pick-lists for the sign-up form: territories {id,name,code} and possible managers {id,name,role} (active ABM-and-above hierarchy users only; no emails or phones).',
          responses: {
            '200': { description: 'Options', ...json(SignupOptions) },
            '429': err('RATE_LIMITED (per IP)'),
            '503': err('SIGNUP_DISABLED: company not configured'),
          },
        },
      },
      '/v1/team/members/{userId}/profile': {
        get: op({
          tags: ['Team'],
          operationId: 'getTeamMemberProfile',
          summary: 'Profile of yourself or someone below you (ABM+; Director: everyone)',
          requestParams: { path: z.object({ userId: Id }) },
          responses: {
            '200': { description: 'Profile', ...json(TeamProfile) },
            '403': err(
              'FORBIDDEN: viewing someone else while below ABM or without reports:read (BM for others); non-hierarchy roles (System Admin, Distribution Head, Accountant) always',
            ),
            '404': err('Not in your subtree (or not a hierarchy user)'),
          },
        }),
      },
      '/v1/team/members/{userId}/performance': {
        get: op({
          tags: ['Team'],
          operationId: 'getTeamMemberPerformance',
          summary: 'Weekly or monthly KPI series for one person',
          requestParams: { path: z.object({ userId: Id }), query: TeamPerformanceQuery },
          responses: {
            '200': { description: 'Series', ...json(TeamPerformance) },
            '403': err(
              'FORBIDDEN: viewing someone else while below ABM or without reports:read (BM for others); non-hierarchy roles (System Admin, Distribution Head, Accountant) always',
            ),
            '404': err('Not in your subtree (or not a hierarchy user)'),
            '422': err('RANGE_TOO_LONG (max 26 weeks / 24 months), VALIDATION'),
          },
        }),
      },
      '/v1/team/members/{userId}/doctors': {
        get: op({
          tags: ['Team'],
          operationId: 'listTeamMemberDoctors',
          summary: 'Approved doctors in the person’s territories, with their visits',
          requestParams: { path: z.object({ userId: Id }), query: TeamOutletQuery },
          responses: {
            '200': { description: 'Page', ...json(TeamMemberDoctorPage) },
            '403': err(
              'FORBIDDEN: viewing someone else while below ABM or without reports:read (BM for others); non-hierarchy roles (System Admin, Distribution Head, Accountant) always',
            ),
            '404': err('Not in your subtree (or not a hierarchy user)'),
          },
        }),
      },
      '/v1/team/members/{userId}/chemists': {
        get: op({
          tags: ['Team'],
          operationId: 'listTeamMemberChemists',
          summary: 'Chemists in the person’s territories',
          requestParams: { path: z.object({ userId: Id }), query: TeamOutletQuery },
          responses: {
            '200': { description: 'Page', ...json(TeamMemberChemistPage) },
            '403': err(
              'FORBIDDEN: viewing someone else while below ABM or without reports:read (BM for others); non-hierarchy roles (System Admin, Distribution Head, Accountant) always',
            ),
            '404': err('Not in your subtree (or not a hierarchy user)'),
          },
        }),
      },
      '/v1/team/members/{userId}/export': {
        get: op({
          tags: ['Team'],
          operationId: 'exportTeamMemberProfile',
          summary: 'Profile + performance as Excel (Profile, Performance sheets) or PDF',
          requestParams: { path: z.object({ userId: Id }), query: TeamProfileExportQuery },
          responses: {
            '200': {
              description: 'File (content-disposition: attachment)',
              content: {
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                  schema: z.string().meta({ format: 'binary' }),
                },
                'application/pdf': { schema: z.string().meta({ format: 'binary' }) },
              },
            },
            '403': err(
              'FORBIDDEN: viewing someone else while below ABM or without reports:read (BM for others); non-hierarchy roles (System Admin, Distribution Head, Accountant) always',
            ),
            '404': err('Not in your subtree (or not a hierarchy user)'),
            '422': err('RANGE_TOO_LONG, VALIDATION'),
          },
        }),
      },
      '/v1/leave/types': {
        get: op({
          tags: ['Leave'],
          operationId: 'listLeaveTypes',
          summary: 'Leave types (policies) with quotas',
          responses: { '200': { description: 'Types', ...json(LeaveTypeList) } },
        }),
      },
      '/v1/leave/types/{code}': {
        put: op({
          tags: ['Leave'],
          operationId: 'putLeaveType',
          summary: 'Create or update a leave type (settings:write)',
          requestParams: { path: z.object({ code: LeaveCode }) },
          requestBody: json(LeaveTypeUpdate),
          responses: {
            '200': { description: 'Type', ...json(LeaveType) },
            '409': err('VERSION_CONFLICT'),
            '422': err('Validation'),
          },
        }),
      },
      '/v1/leave/settings': {
        get: op({
          tags: ['Leave'],
          operationId: 'getLeaveSettings',
          summary: 'Approval levels, backdate window, weekly offs, future limit',
          responses: { '200': { description: 'Settings', ...json(LeaveSettings) } },
        }),
        put: op({
          tags: ['Leave'],
          operationId: 'putLeaveSettings',
          summary: 'Update leave settings (settings:write)',
          requestBody: json(LeaveSettingsUpdate),
          responses: {
            '200': { description: 'Settings', ...json(LeaveSettings) },
            '409': err('VERSION_CONFLICT'),
            '422': err('Validation'),
          },
        }),
      },
      '/v1/leave/balances': {
        get: op({
          tags: ['Leave'],
          operationId: 'getLeaveBalances',
          summary: 'Balances per type for a year; others need leave:approve over them',
          requestParams: { query: LeaveBalanceQuery },
          responses: {
            '200': { description: 'Balance', ...json(LeaveBalance) },
            '404': err('User not found / not in your reporting line'),
          },
        }),
      },
      '/v1/notifications': {
        get: op({
          tags: ['Notifications'],
          operationId: 'listNotifications',
          summary: 'Your own in-app notifications, newest first (cursor paged)',
          requestParams: { query: NotificationQuery },
          responses: { '200': { description: 'Page', ...json(NotificationPage) } },
        }),
      },
      '/v1/notifications/unread-count': {
        get: op({
          tags: ['Notifications'],
          operationId: 'getUnreadNotificationCount',
          responses: { '200': { description: 'Unread count', ...json(UnreadCount) } },
        }),
      },
      '/v1/notifications/{id}/read': {
        post: op({
          tags: ['Notifications'],
          operationId: 'markNotificationRead',
          summary: 'Idempotent; keeps the first readAt',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'Notification', ...json(NotificationSchema) },
            '404': err('Not found (or not yours)'),
          },
        }),
      },
      '/v1/notifications/read-all': {
        post: op({
          tags: ['Notifications'],
          operationId: 'markAllNotificationsRead',
          responses: { '200': { description: 'Rows marked read', ...json(ReadAllResult) } },
        }),
      },
      '/v1/jobs/stats': {
        get: op({
          tags: ['Notifications'],
          operationId: 'getJobStats',
          summary: "System admin only: background job counts for the caller's company",
          responses: {
            '200': { description: 'Counts', ...json(JobStats) },
            '403': err('System admin only'),
          },
        }),
      },
      '/v1/leave/requests': {
        get: op({
          tags: ['Leave'],
          operationId: 'listLeaveRequests',
          summary: 'Own requests; with leave:approve also your reporting line',
          requestParams: { query: LeaveRequestQuery },
          responses: { '200': { description: 'Requests', ...json(LeaveRequestList) } },
        }),
        post: op({
          tags: ['Leave'],
          operationId: 'applyLeave',
          summary: 'Apply for leave; starts the approval chain',
          requestBody: json(LeaveApply),
          responses: {
            '201': { description: 'Pending request', ...json(LeaveRequest) },
            '409': err('LEAVE_OVERLAP, LEAVE_DCR_EXISTS'),
            '422': err(
              'LEAVE_TYPE_UNKNOWN, LEAVE_HALF_DAY_NOT_ALLOWED, LEAVE_SPANS_YEARS, LEAVE_BACKDATE_WINDOW, LEAVE_TOO_FAR_AHEAD, LEAVE_NO_WORKING_DAYS, LEAVE_INSUFFICIENT_BALANCE, VALIDATION',
            ),
          },
        }),
      },
      '/v1/leave/requests/{id}': {
        get: op({
          tags: ['Leave'],
          operationId: 'getLeaveRequest',
          summary: 'One leave request',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'Request', ...json(LeaveRequest) },
            '404': err('Not found'),
          },
        }),
      },
      '/v1/leave/requests/{id}/cancel': {
        post: op({
          tags: ['Leave'],
          operationId: 'cancelLeaveRequest',
          summary:
            'Owner: pending, or approved before it starts. Manager above: pending or approved.',
          requestParams: { path: IdParam },
          requestBody: json(LeaveCancel),
          responses: {
            '200': { description: 'Cancelled', ...json(LeaveRequest) },
            '404': err('Not found'),
            '409': err('LEAVE_NOT_CANCELLABLE'),
          },
        }),
      },
      '/v1/leave/requests/{id}/decision': {
        post: op({
          tags: ['Leave'],
          operationId: 'decideLeaveRequest',
          summary: 'Current step approver or above; never your own. Same engine as expenses.',
          requestParams: { path: IdParam },
          requestBody: json(LeaveDecision),
          responses: {
            '200': { description: 'Request after the decision', ...json(LeaveRequest) },
            '403': err('Own request, APPROVAL_NOT_YOUR_STEP or APPROVAL_ALREADY_DECIDED_BY_YOU'),
            '404': err('Not found'),
            '409': err('Not pending'),
            '422': err('REJECTION_REASON_REQUIRED: reject without a non-blank comment'),
          },
        }),
      },
      '/v1/leave/grants': {
        get: op({
          tags: ['Leave'],
          operationId: 'listLeaveGrants',
          summary: 'Grants (opening, carry-forward, comp-off, adjustments)',
          requestParams: { query: LeaveGrantQuery },
          responses: { '200': { description: 'Grants', ...json(LeaveGrantList) } },
        }),
        post: op({
          tags: ['Leave'],
          operationId: 'createLeaveGrant',
          summary: 'Grant days (e.g. comp-off) to someone in your reporting line',
          requestBody: json(LeaveGrantCreate),
          responses: {
            '201': { description: 'Grant', ...json(LeaveGrant) },
            '403': err('LEAVE_SELF_GRANT'),
            '404': err('User not found'),
            '422': err('LEAVE_TYPE_UNKNOWN, unlimited type'),
          },
        }),
      },
      '/v1/leave/carry-forward': {
        post: op({
          tags: ['Leave'],
          operationId: 'carryForwardLeave',
          summary: 'Carry capped balances into the next year (idempotent, settings:write)',
          requestBody: json(LeaveCarryForward),
          responses: { '200': { description: 'Result', ...json(LeaveCarryForwardResult) } },
        }),
      },
      '/v1/leave/calendar': {
        get: op({
          tags: ['Leave'],
          operationId: 'leaveCalendar',
          summary: 'Team leave calendar (max 92 days); yourself only without leave:approve',
          requestParams: { query: LeaveCalendarQuery },
          responses: {
            '200': { description: 'Calendar', ...json(LeaveCalendar) },
            '422': err('Range too long'),
          },
        }),
      },
      '/v1/expense-claims': {
        get: op({
          tags: ['Expenses'],
          operationId: 'listExpenseClaims',
          summary:
            'Your claims; with expenses:approve also non-draft claims of your reporting line; with expenses:pay approved/paid claims company-wide',
          requestParams: { query: ExpenseClaimListQuery },
          responses: { '200': { description: 'Claims', ...json(ExpenseClaimList) } },
        }),
        post: op({
          tags: ['Expenses'],
          operationId: 'createExpenseClaim',
          summary:
            'Create your claim for a month (one per user per month); returns the existing one with 200',
          requestBody: json(ExpenseClaimCreate),
          responses: {
            '200': { description: 'Existing claim', ...json(ExpenseClaim) },
            '201': { description: 'Created (draft)', ...json(ExpenseClaim) },
            '422': err('Future month'),
          },
        }),
      },
      '/v1/expense-claims/{id}': {
        get: op({
          tags: ['Expenses'],
          operationId: 'getExpenseClaim',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'Claim with lines and attachments', ...json(ExpenseClaim) },
            '404': err('Not found or not visible'),
          },
        }),
      },
      '/v1/expense-claims/{id}/lines': {
        post: op({
          tags: ['Expenses'],
          operationId: 'addExpenseLine',
          summary: 'Owner only, claim draft or rejected',
          requestParams: { path: IdParam },
          requestBody: json(ExpenseLineInput),
          responses: {
            '201': { description: 'Updated claim', ...json(ExpenseClaim) },
            '404': err('Not found'),
            '409': err('EXPENSE_NOT_EDITABLE'),
            '422': err(
              'Validation: date outside month/future, DCR not yours or other date, mileageKm rule',
            ),
          },
        }),
      },
      '/v1/expense-claims/{id}/lines/{lineId}': {
        put: op({
          tags: ['Expenses'],
          operationId: 'updateExpenseLine',
          requestParams: { path: z.object({ id: IdParam.shape.id, lineId: IdParam.shape.id }) },
          requestBody: json(ExpenseLineUpdate),
          responses: {
            '200': { description: 'Updated claim', ...json(ExpenseClaim) },
            '404': err('Not found'),
            '409': err('EXPENSE_NOT_EDITABLE or VERSION_CONFLICT'),
            '422': err('Validation'),
          },
        }),
        delete: op({
          tags: ['Expenses'],
          operationId: 'deleteExpenseLine',
          requestParams: { path: z.object({ id: IdParam.shape.id, lineId: IdParam.shape.id }) },
          responses: {
            '200': { description: 'Updated claim', ...json(ExpenseClaim) },
            '404': err('Not found'),
            '409': err('EXPENSE_NOT_EDITABLE'),
          },
        }),
      },
      '/v1/expense-claims/{id}/lines/{lineId}/attachments': {
        post: op({
          tags: ['Expenses'],
          operationId: 'createExpenseAttachment',
          summary:
            'Step 1 of the receipt upload: strict type/extension/size allow-list, max 5 per line. Returns a presigned PUT (10 min). Then PUT the bytes and call confirm.',
          requestParams: { path: z.object({ id: IdParam.shape.id, lineId: IdParam.shape.id }) },
          requestBody: json(ExpenseAttachmentCreate),
          responses: {
            '201': {
              description: 'Pending attachment + upload URL',
              ...json(ExpenseAttachmentUpload),
            },
            '404': err('Not found'),
            '409': err('EXPENSE_NOT_EDITABLE'),
            '422': err('VALIDATION (type, extension mismatch, size) or TOO_MANY_FILES'),
            '503': err('File storage not configured'),
          },
        }),
      },
      '/v1/expense-attachments/{id}/confirm': {
        post: op({
          tags: ['Expenses'],
          operationId: 'confirmExpenseAttachment',
          summary:
            'Step 3: server checks the object exists, its size and content type equal the declared ones and its first bytes match the format. On mismatch the object is deleted.',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'Confirmed', ...json(ExpenseAttachment) },
            '404': err('Not found'),
            '409': err('UPLOAD_MISSING or EXPENSE_NOT_EDITABLE'),
            '422': err('UPLOAD_SIZE_MISMATCH, UPLOAD_TYPE_MISMATCH or UPLOAD_FORMAT_INVALID'),
          },
        }),
      },
      '/v1/expense-attachments/{id}': {
        delete: op({
          tags: ['Expenses'],
          operationId: 'deleteExpenseAttachment',
          requestParams: { path: IdParam },
          responses: {
            '204': { description: 'Deleted' },
            '404': err('Not found'),
            '409': err('EXPENSE_NOT_EDITABLE'),
          },
        }),
      },
      '/v1/expense-attachments/{id}/download-url': {
        post: op({
          tags: ['Expenses'],
          operationId: 'expenseAttachmentDownloadUrl',
          summary:
            'Owner, the approver chain or finance (approved/paid). 5-minute signed GET; audited (expense.attachment_downloaded).',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'Signed URL', ...json(ExpenseDownload) },
            '404': err('Not found or not visible'),
            '409': err('UPLOAD_NOT_CONFIRMED'),
          },
        }),
      },
      '/v1/allowance-rates': {
        get: op({
          tags: ['TA/DA'],
          operationId: 'listAllowanceRates',
          deprecated: true,
          summary: 'expenses:read, expenses:pay or settings:write',
          requestParams: { query: AllowanceRateQuery },
          responses: {
            '200': { description: 'OK', ...json(AllowanceRateList) },
            '403': err('FORBIDDEN'),
          },
        }),
        post: op({
          tags: ['TA/DA'],
          operationId: 'createAllowanceRate',
          deprecated: true,
          summary: 'settings:write',
          requestBody: json(AllowanceRateInput),
          responses: {
            '201': { description: 'Created', ...json(AllowanceRate) },
            '403': err('FORBIDDEN (needs settings:write)'),
            '409': err('DUPLICATE_RATE (same band, role and effectiveFrom)'),
            '422': err('VALIDATION'),
          },
        }),
      },
      '/v1/allowance-rates/{id}': {
        put: op({
          tags: ['TA/DA'],
          operationId: 'updateAllowanceRate',
          deprecated: true,
          summary: 'settings:write; optimistic version',
          requestParams: { path: IdParam },
          requestBody: json(AllowanceRateUpdate),
          responses: {
            '200': { description: 'Saved', ...json(AllowanceRate) },
            '403': err('FORBIDDEN (needs settings:write)'),
            '404': err('Not found'),
            '409': err('VERSION_CONFLICT or DUPLICATE_RATE (same band, role and effectiveFrom)'),
            '422': err('VALIDATION'),
          },
        }),
        delete: op({
          tags: ['TA/DA'],
          operationId: 'deleteAllowanceRate',
          deprecated: true,
          summary: 'settings:write; soft delete (existing claim lines keep their amounts)',
          requestParams: { path: IdParam },
          responses: {
            '204': { description: 'Deleted' },
            '403': err('FORBIDDEN (needs settings:write)'),
            '404': err('Not found'),
          },
        }),
      },
      '/v1/allowance-places': {
        get: op({
          tags: ['TA/DA'],
          operationId: 'listAllowancePlaces',
          deprecated: true,
          summary: 'expenses:read, expenses:pay or settings:write',
          requestParams: { query: AllowancePlaceQuery },
          responses: {
            '200': { description: 'OK', ...json(AllowancePlaceList) },
            '403': err('FORBIDDEN'),
          },
        }),
        post: op({
          tags: ['TA/DA'],
          operationId: 'createAllowancePlace',
          deprecated: true,
          summary: 'settings:write',
          requestBody: json(AllowancePlaceInput),
          responses: {
            '201': { description: 'Created', ...json(AllowancePlace) },
            '403': err('FORBIDDEN (needs settings:write)'),
            '409': err('DUPLICATE_PLACE (same HQ and name)'),
            '422': err('VALIDATION or NOT_HQ_TERRITORY'),
          },
        }),
      },
      '/v1/allowance-places/{id}': {
        put: op({
          tags: ['TA/DA'],
          operationId: 'updateAllowancePlace',
          deprecated: true,
          summary: 'settings:write; optimistic version',
          requestParams: { path: IdParam },
          requestBody: json(AllowancePlaceUpdate),
          responses: {
            '200': { description: 'Saved', ...json(AllowancePlace) },
            '403': err('FORBIDDEN (needs settings:write)'),
            '404': err('Not found'),
            '409': err('VERSION_CONFLICT or DUPLICATE_PLACE (same HQ and name)'),
            '422': err('VALIDATION or NOT_HQ_TERRITORY'),
          },
        }),
        delete: op({
          tags: ['TA/DA'],
          operationId: 'deleteAllowancePlace',
          deprecated: true,
          summary: 'settings:write; soft delete (existing claim lines keep their amounts)',
          requestParams: { path: IdParam },
          responses: {
            '204': { description: 'Deleted' },
            '403': err('FORBIDDEN (needs settings:write)'),
            '404': err('Not found'),
          },
        }),
      },
      '/v1/sfc/settings': {
        get: op({
          tags: ['SFC'],
          operationId: 'getSfcSettings',
          summary: 'sfc:read. Company TA rate per km used for SFC amounts (default 2.95)',
          responses: {
            '200': { description: 'OK', ...json(SfcSettings) },
            '403': err('FORBIDDEN'),
          },
        }),
        put: op({
          tags: ['SFC'],
          operationId: 'putSfcSettings',
          summary:
            'settings:write; optimistic version. Existing routes keep their stored amounts until next save',
          requestBody: json(SfcSettings),
          responses: {
            '200': { description: 'Saved', ...json(SfcSettings) },
            '403': err('FORBIDDEN'),
            '409': err('VERSION_CONFLICT'),
            '422': err('VALIDATION'),
          },
        }),
      },
      '/v1/sfc/hqs': {
        get: op({
          tags: ['SFC'],
          operationId: 'listSfcHqs',
          summary: 'sfc:read. Headquarter-level territories in the caller scope (subtree included)',
          responses: { '200': { description: 'OK', ...json(SfcHqList) }, '403': err('FORBIDDEN') },
        }),
      },
      '/v1/sfc/employees': {
        get: op({
          tags: ['SFC'],
          operationId: 'listSfcEmployees',
          summary:
            'sfc:read. Visible sales-hierarchy employees, optionally under a territory (subtree)',
          requestParams: { query: SfcEmployeeQuery },
          responses: {
            '200': { description: 'OK', ...json(SfcEmployeeList) },
            '403': err('FORBIDDEN'),
          },
        }),
      },
      '/v1/sfc/employees/{userId}/routes': {
        get: op({
          tags: ['SFC'],
          operationId: 'getSfcTable',
          summary: 'sfc:read. One employee SFC table with its etag',
          requestParams: { path: z.object({ userId: Id }) },
          responses: {
            '200': { description: 'OK', ...json(SfcTable) },
            '403': err('FORBIDDEN'),
            '404': err('NOT_FOUND (not visible or not in the sales hierarchy)'),
          },
        }),
        put: op({
          tags: ['SFC'],
          operationId: 'putSfcTable',
          summary:
            'sfc:write over this employee (never your own unless system_admin). Replaces the whole table; amounts computed by the server; audited (sfc.routes_saved)',
          requestParams: { path: z.object({ userId: Id }) },
          requestBody: json(SfcTablePut),
          responses: {
            '200': { description: 'Saved', ...json(SfcTable) },
            '403': err('FORBIDDEN'),
            '404': err('NOT_FOUND'),
            '409': err('VERSION_CONFLICT (etag changed; details.etag is current)'),
            '422': err('VALIDATION, SFC_HQ_NOT_ASSIGNED or SFC_ROUTE_NOT_FOUND'),
          },
        }),
      },
      '/v1/expense-claims/{id}/allowances': {
        post: op({
          tags: ['Expenses', 'TA/DA'],
          operationId: 'draftExpenseAllowances',
          summary:
            'Owner, draft or rejected claim: compute DA/TA per DCR day of the month from the rate card and fare chart and replace the auto lines (dryRun: preview only). Manual lines are never touched.',
          requestParams: { path: IdParam },
          requestBody: json(AllowanceDraftRequest),
          responses: {
            '200': {
              description: 'Per-day breakdown, totals and the updated claim',
              ...json(AllowanceDraftResult),
            },
            '403': err('Not the owner'),
            '404': err('Not found'),
            '409': err('EXPENSE_NOT_EDITABLE'),
            '422': err('VALIDATION or PLACE_NOT_USABLE'),
          },
        }),
      },
      '/v1/expense-claims/{id}/submit': {
        post: op({
          tags: ['Expenses'],
          operationId: 'submitExpenseClaim',
          summary:
            'Draft or rejected -> submitted; opens an approval request (subjectType expense) to your reporting manager, then up the chain (EXPENSE_APPROVAL_LEVELS, default 2)',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'Submitted', ...json(ExpenseClaim) },
            '404': err('Not found'),
            '409': err('EXPENSE_NOT_EDITABLE'),
            '422': err('EXPENSE_EMPTY or RECEIPT_REQUIRED (hotel lines need a confirmed receipt)'),
          },
        }),
      },
      '/v1/expense-claims/{id}/decision': {
        post: op({
          tags: ['Expenses'],
          operationId: 'decideExpenseClaim',
          summary:
            'Current step approver or anyone above them; never your own claim or a second step you already approved. Same as POST /v1/approvals/{approvalId}/decision.',
          requestParams: { path: IdParam },
          requestBody: json(ExpenseDecision),
          responses: {
            '200': { description: 'Claim after the decision', ...json(ExpenseClaim) },
            '403': err('Own claim, APPROVAL_NOT_YOUR_STEP or APPROVAL_ALREADY_DECIDED_BY_YOU'),
            '404': err('Not found'),
            '409': err('Not submitted / already decided'),
            '422': err('REJECTION_REASON_REQUIRED: reject without a non-blank comment'),
          },
        }),
      },
      '/v1/expense-claims/{id}/pay': {
        post: op({
          tags: ['Expenses'],
          operationId: 'payExpenseClaim',
          summary: 'Director / system admin (expenses:pay): approved -> paid',
          requestParams: { path: IdParam },
          requestBody: json(ExpensePay),
          responses: {
            '200': { description: 'Paid', ...json(ExpenseClaim) },
            '404': err('Not found'),
            '409': err('Not approved'),
          },
        }),
      },
      '/v1/expense-claims/{id}/reconciliation': {
        get: op({
          tags: ['Expenses'],
          operationId: 'reconcileExpenseClaim',
          summary: 'Claimed days vs DCR days with per-day flags',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'Reconciliation', ...json(ExpenseReconciliation) },
            '404': err('Not found'),
          },
        }),
      },
      '/v1/expense-reports': {
        get: op({
          tags: ['Expenses'],
          operationId: 'expenseReport',
          summary: 'Month report over the claims you may read (same scope as the list)',
          requestParams: { query: ExpenseReportQuery },
          responses: { '200': { description: 'Report', ...json(ExpenseReport) } },
        }),
      },
      '/v1/expense-reports/export': {
        get: op({
          tags: ['Expenses'],
          operationId: 'exportExpenseReport',
          summary: 'Same scope as the report, as an Excel (Claims + Lines sheets) or PDF download',
          requestParams: { query: ExpenseExportQuery },
          responses: {
            '200': {
              description: 'File (content-disposition: attachment)',
              content: {
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                  schema: z.string().meta({ format: 'binary' }),
                },
                'application/pdf': { schema: z.string().meta({ format: 'binary' }) },
              },
            },
          },
        }),
      },
      '/v1/auth/password/forgot': {
        post: {
          tags: ['Auth'],
          operationId: 'forgotPassword',
          summary:
            'Public. Emails a 6-digit reset code (valid 10 minutes, 3 tries) to an ACTIVE account. Always answers 200 with the same message, whether or not the email has an account; suspended, pending, rejected, retired and never-signed-in (invited) accounts get no email.',
          requestBody: json(PasswordForgot),
          responses: {
            '200': { description: 'Accepted (generic)', ...json(PasswordForgotAccepted) },
            '422': err('Validation failed (email)'),
            '429': err('RATE_LIMITED: 3 per email per hour and 10 per IP per hour (Retry-After)'),
          },
        },
      },
      '/v1/auth/password/reset': {
        post: {
          tags: ['Auth'],
          operationId: 'resetPassword',
          summary:
            'Public. Sets a new password (min 12) with the emailed code and signs out every device; sign in again afterwards. Unknown or ineligible accounts get the same error as a wrong code.',
          requestBody: json(PasswordReset),
          responses: {
            '200': {
              description: 'Password changed; all sessions revoked',
              ...json(PasswordResetDone),
            },
            '400': err(
              'PASSWORD_RESET_CODE_INVALID (wrong code, no code requested, or no eligible account) or PASSWORD_RESET_CODE_EXPIRED',
            ),
            '403': err(
              'PASSWORD_RESET_TOO_MANY_ATTEMPTS: 3 wrong codes already used up this code (even the right code is refused); request a new one',
            ),
            '422': err('Validation failed (email, 6-digit code, password 12-128)'),
            '429': err('RATE_LIMITED: 20 per IP per hour (Retry-After)'),
          },
        },
      },
      '/v1/auth/sign-up-request': {
        post: {
          tags: ['Auth'],
          operationId: 'requestSignUp',
          summary:
            'Public. Self sign-up for company arighna: creates the login and a pending employee. The role is only a request; the account cannot sign in until approved. Sign-in then returns 403 code ACCOUNT_PENDING_APPROVAL (or ACCOUNT_REJECTED).',
          requestBody: json(SignupRequestCreate),
          responses: {
            '202': {
              description: 'Request stored (status pending)',
              ...json(SignupRequestAccepted),
            },
            '403': err('CAPTCHA_FAILED (only when TURNSTILE_SECRET is set)'),
            '409': err('SIGNUP_UNAVAILABLE: generic, also for emails that already have a login'),
            '422': err('Validation failed (password min 12; system_admin cannot be requested)'),
            '429': err('RATE_LIMITED (per IP and per email)'),
            '503': err('SIGNUP_DISABLED: company not configured'),
          },
        },
      },
      '/v1/signup-requests': {
        get: op({
          tags: ['Team'],
          operationId: 'listSignupRequests',
          summary:
            'System admin: all requests. ABM and above: requests for a hierarchy role below theirs whose territory or manager is in their subtree.',
          requestParams: { query: SignupRequestQuery },
          responses: {
            '200': { description: 'Requests', ...json(SignupRequestList) },
            '403': err('BM and functional roles cannot review sign-ups'),
          },
        }),
      },
      '/v1/signup-requests/{id}/approve': {
        post: op({
          tags: ['Team'],
          operationId: 'approveSignupRequest',
          summary:
            'Grant a role (may differ from the request) within your authority; activates the account. Directors and functional roles have no manager.',
          requestParams: { path: IdParam },
          requestBody: json(SignupApprove),
          responses: {
            '200': { description: 'Approved', ...json(SignupRequest) },
            '403': err(
              'Role above your authority, territory outside your scope, or your own request',
            ),
            '404': err('Not found or not visible to you'),
            '409': err('Already decided'),
            '422': err(
              'Validation (no territory for a hierarchy role, manager for a director, ...)',
            ),
          },
        }),
      },
      '/v1/signup-requests/{id}/reject': {
        post: op({
          tags: ['Team'],
          operationId: 'rejectSignupRequest',
          summary: 'Reject; the login stays blocked (sign-in returns ACCOUNT_REJECTED)',
          requestParams: { path: IdParam },
          requestBody: json(SignupReject),
          responses: {
            '200': { description: 'Rejected', ...json(SignupRequest) },
            '403': err('Your own request'),
            '404': err('Not found or not visible to you'),
            '409': err('Already decided'),
            '422': err('REJECTION_REASON_REQUIRED: reason missing or blank'),
          },
        }),
      },
      '/v1/approvals/{id}': {
        get: op({
          tags: ['Approvals'],
          operationId: 'getApproval',
          summary:
            'One approval request. Visible to the requester, an assigned approver (current or past step) and the reporting line above the requester. `subject` holds the full details (null for in-line viewers without read access to the subject).',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'OK', ...json(ApprovalDetail) },
            '404': err('Not found or not visible'),
          },
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
            '403': err('Own request, or requester not below you in the reporting line'),
            '404': err('Not found'),
            '409': err('Already decided'),
            '422': err('REJECTION_REASON_REQUIRED: reject without a non-blank comment'),
          },
        }),
      },
      '/v1/exceptions': {
        get: op({
          tags: ['Exceptions'],
          operationId: 'listExceptions',
          summary: 'Needs Attention list: exceptions in your scope (#56, #29)',
          description:
            'Own exceptions plus your reporting-line subtree (Director: company). Sorted by severity (high first), then periodDate desc. Needs field:read. See docs/EXCEPTIONS.md.',
          requestParams: { query: ExceptionListQuery },
          responses: {
            '200': { description: 'Page', ...json(ExceptionPage) },
            '422': err('Invalid filters'),
          },
        }),
      },
      '/v1/exceptions/summary': {
        get: op({
          tags: ['Exceptions'],
          operationId: 'exceptionSummary',
          summary: 'Exception counts by rule and severity for a period, in your scope',
          requestParams: { query: ExceptionSummaryQuery },
          responses: { '200': { description: 'OK', ...json(ExceptionSummary) } },
        }),
      },
      '/v1/exceptions/evaluate': {
        post: op({
          tags: ['Exceptions'],
          operationId: 'evaluateExceptions',
          summary: 'Backfill: queue a rule evaluation for a past date range (settings:write)',
          description:
            'Max 92 days, to < today (company-local). Idempotent per (user, rule, period). No digest notifications.',
          requestBody: json(ExceptionEvaluateRequest),
          responses: {
            '202': { description: 'Queued', ...json(ExceptionEvaluateResult) },
            '422': err('Range invalid, too long or not in the past'),
          },
        }),
      },
      '/v1/exceptions/{id}': {
        get: op({
          tags: ['Exceptions'],
          operationId: 'getException',
          summary: 'One exception with context, owner, status and follow-up date',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'OK', ...json(ExceptionItem) },
            '404': err('Not found or out of scope'),
          },
        }),
        patch: op({
          tags: ['Exceptions'],
          operationId: 'updateException',
          summary: 'Assign an owner and/or set the follow-up date (manager in scope)',
          description:
            'Needs approvals:decide; the person must be strictly below you. assigneeId must be you or someone in your scope.',
          requestParams: { path: IdParam },
          requestBody: json(ExceptionUpdate),
          responses: {
            '200': { description: 'Updated', ...json(ExceptionItem) },
            '404': err('Not found or out of scope'),
            '409': err('VERSION_CONFLICT or EXCEPTION_CLOSED'),
            '422': err('ASSIGNEE_OUT_OF_SCOPE'),
          },
        }),
      },
      '/v1/exceptions/{id}/explain': {
        post: op({
          tags: ['Exceptions'],
          operationId: 'explainException',
          summary:
            'Add your explanation (the person the exception is about); status -> acknowledged',
          requestParams: { path: IdParam },
          requestBody: json(ExceptionNote),
          responses: {
            '200': { description: 'Saved', ...json(ExceptionItem) },
            '404': err('Not found or out of scope'),
            '409': err('EXCEPTION_CLOSED'),
          },
        }),
      },
      '/v1/exceptions/{id}/resolve': {
        post: op({
          tags: ['Exceptions'],
          operationId: 'resolveException',
          summary: 'Resolve with a note (manager in scope, approvals:decide)',
          requestParams: { path: IdParam },
          requestBody: json(ExceptionNote),
          responses: {
            '200': { description: 'Resolved', ...json(ExceptionItem) },
            '404': err('Not found or out of scope'),
            '409': err('EXCEPTION_CLOSED'),
          },
        }),
      },
      '/v1/exceptions/{id}/dismiss': {
        post: op({
          tags: ['Exceptions'],
          operationId: 'dismissException',
          summary: 'Dismiss (not a real issue) with a note (manager in scope, approvals:decide)',
          requestParams: { path: IdParam },
          requestBody: json(ExceptionNote),
          responses: {
            '200': { description: 'Dismissed', ...json(ExceptionItem) },
            '404': err('Not found or out of scope'),
            '409': err('EXCEPTION_CLOSED'),
          },
        }),
      },
      '/v1/exception-rules': {
        get: op({
          tags: ['Exceptions'],
          operationId: 'listExceptionRules',
          summary: 'Exception rules with effective thresholds (defaults + company overrides)',
          responses: { '200': { description: 'OK', ...json(ExceptionRuleList) } },
        }),
      },
      '/v1/exception-rules/{code}': {
        put: op({
          tags: ['Exceptions'],
          operationId: 'updateExceptionRule',
          summary:
            'Override a rule for your company (settings:write); reset=true restores defaults',
          requestParams: { path: ExceptionRuleParam },
          requestBody: json(ExceptionRuleUpdate),
          responses: {
            '200': { description: 'Saved', ...json(ExceptionRule) },
            '409': err('VERSION_CONFLICT'),
            '422': err('THRESHOLD_OUT_OF_RANGE or rule has no threshold'),
          },
        }),
      },
      '/v1/admin/products': {
        get: op({
          tags: ['Product prices'],
          operationId: 'listAdminProducts',
          summary: 'Products with current MRP/PTR/PTS for the prices admin (system_admin only)',
          requestParams: { query: AdminProductQuery },
          responses: {
            '200': { description: 'OK', ...json(AdminProductList) },
            '403': err('FORBIDDEN (needs products:prices)'),
          },
        }),
      },
      '/v1/admin/products/{id}/prices': {
        patch: op({
          tags: ['Product prices'],
          operationId: 'updateProductPrices',
          summary:
            'Set MRP/PTR/PTS of one product (system_admin only). Saved POB values are never re-priced.',
          requestParams: { path: IdParam },
          requestBody: json(ProductPricesUpdate),
          responses: {
            '200': { description: 'Saved', ...json(AdminProduct) },
            '403': err('FORBIDDEN (needs products:prices)'),
            '404': err('PRODUCT_NOT_FOUND'),
            '409': err('VERSION_CONFLICT'),
            '422': err('VALIDATION or PTR_ABOVE_MRP'),
          },
        }),
      },
      '/v1/admin/products/prices/bulk': {
        post: op({
          tags: ['Product prices'],
          operationId: 'bulkUpdateProductPrices',
          summary:
            'Up to 300 rows by productId or code; each row in its own transaction, per-row results',
          requestBody: json(ProductPricesBulkRequest),
          responses: {
            '200': {
              description: 'Per-row results and summary',
              ...json(ProductPricesBulkResponse),
            },
            '403': err('FORBIDDEN (needs products:prices)'),
            '422': err('VALIDATION (rows missing, empty or more than 300)'),
          },
        }),
      },
      '/v1/admin/products/{id}/price-history': {
        get: op({
          tags: ['Product prices'],
          operationId: 'getProductPriceHistory',
          summary: 'Price changes of one product, newest first (max 200; system_admin only)',
          requestParams: { path: IdParam },
          responses: {
            '200': { description: 'OK', ...json(ProductPriceHistory) },
            '403': err('FORBIDDEN (needs products:prices)'),
            '404': err('PRODUCT_NOT_FOUND'),
          },
        }),
      },
    },
  });
}
