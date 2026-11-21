'use client';

import { useEffect, useState, type HTMLAttributes } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { api, apiReady, toApiError } from '@/lib/api';
import { assignMessage } from '@/lib/assign-errors';
import {
  failure,
  listPeople,
  updatePerson,
  type Person,
  type PersonPatch,
} from '@/lib/people/adapter';
import { getTerritories } from '@/lib/query';
import { ROLES, ROLE_LABEL, roleLabel, roleLevel, type Role } from '@/lib/roles';
import { useRole } from '@/components/shell/role-context';

const SELECT =
  'h-10 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm';

const TABS = [
  { id: 'overview', title: 'Overview' },
  { id: 'address', title: 'Address & Contacts' },
  { id: 'attendance', title: 'Attendance & Leaves' },
  { id: 'salary', title: 'Salary' },
  { id: 'personal', title: 'Personal Details' },
  { id: 'profile', title: 'Profile' },
  { id: 'joining', title: 'Joining' },
  { id: 'exit', title: 'Exit' },
] as const;

type Tab = (typeof TABS)[number]['id'];
type Terr = { id: string; name: string; level: string };
type Kind = 'text' | 'date' | 'select' | 'area' | 'check';

const GENDER = ['Male', 'Female', 'Other', 'Prefer not to say'];
const SALUTE = ['Mr', 'Ms', 'Mrs', 'Dr'];
const EMPLOYMENT = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Probation'];
const HR_STATUS = ['Active', 'Inactive', 'Suspended', 'Left'];
const PAY = ['Bank', 'Cash', 'Cheque'];
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const YESNO = ['Yes', 'No'];

const TEXT_KEYS = [
  'series',
  'gender',
  'salutation',
  'firstName',
  'middleName',
  'lastName',
  'hrUserId',
  'department',
  'branch',
  'grade',
  'employeeGroup',
  'employmentType',
  'hrStatus',
  'personalEmail',
  'currentAddress',
  'permanentAddress',
  'city',
  'state',
  'pincode',
  'emergencyName',
  'emergencyPhone',
  'attendanceDeviceId',
  'holidayList',
  'defaultShift',
  'leaveApprover',
  'ctc',
  'salaryMode',
  'bankName',
  'bankAccount',
  'ifsc',
  'pan',
  'pfAccount',
  'esiNumber',
  'maritalStatus',
  'bloodGroup',
  'passport',
  'family',
  'confirmationDate',
  'contractEnd',
  'noticeDays',
  'retirementDate',
  'resignationDate',
  'relievingDate',
  'leaveEncashed',
  'reasonForLeaving',
  'feedback',
  'email',
  'phone',
  'employeeCode',
  'designation',
  'joinedOn',
  'dateOfBirth',
] as const;

type TextKey = (typeof TEXT_KEYS)[number];
type Draft = Record<TextKey, string> & {
  createUser: boolean;
  role: Role;
  territoryId: string;
  managerId: string;
};

const functional = (role: Role) => roleLevel(role) === 0;
const needsPlace = (role: Role) => !functional(role);
const needsManager = (role: Role) => !functional(role) && role !== 'director';
const blankText = Object.fromEntries(TEXT_KEYS.map((key) => [key, ''])) as Record<TextKey, string>;

function blank(): Draft {
  return {
    ...blankText,
    hrStatus: 'Active',
    createUser: true,
    role: 'business_manager',
    territoryId: '',
    managerId: '',
  };
}

function textOf(value: string | number | null | undefined) {
  return value == null ? '' : String(value);
}

function fromPerson(p: Person): Draft {
  const role = (p.primaryRole ?? p.roles[0] ?? 'business_manager') as Role;
  const next = blank();
  for (const key of TEXT_KEYS) next[key] = textOf(p[key]);
  if (!next.firstName) next.firstName = p.name;
  if (!next.hrStatus) next.hrStatus = 'Active';
  next.email = p.email;
  next.createUser = p.createUser ?? true;
  next.role = ROLES.includes(role) ? role : 'business_manager';
  next.territoryId = p.territoryIds[0] ?? '';
  next.managerId = p.managerId ?? '';
  return next;
}

function displayName(d: Draft) {
  return [d.firstName, d.middleName, d.lastName]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

function empty(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function whole(value: string) {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function profileBody(d: Draft) {
  return {
    series: empty(d.series),
    gender: empty(d.gender),
    salutation: empty(d.salutation),
    firstName: empty(d.firstName),
    middleName: empty(d.middleName),
    lastName: empty(d.lastName),
    hrUserId: empty(d.hrUserId),
    createUser: d.createUser,
    department: empty(d.department),
    branch: empty(d.branch),
    grade: empty(d.grade),
    employeeGroup: empty(d.employeeGroup),
    employmentType: empty(d.employmentType),
    hrStatus: empty(d.hrStatus),
    personalEmail: empty(d.personalEmail),
    currentAddress: empty(d.currentAddress),
    permanentAddress: empty(d.permanentAddress),
    city: empty(d.city),
    state: empty(d.state),
    pincode: empty(d.pincode),
    emergencyName: empty(d.emergencyName),
    emergencyPhone: empty(d.emergencyPhone),
    attendanceDeviceId: empty(d.attendanceDeviceId),
    holidayList: empty(d.holidayList),
    defaultShift: empty(d.defaultShift),
    leaveApprover: empty(d.leaveApprover),
    ctc: whole(d.ctc),
    salaryMode: empty(d.salaryMode),
    bankName: empty(d.bankName),
    bankAccount: empty(d.bankAccount),
    ifsc: empty(d.ifsc),
    pan: empty(d.pan),
    pfAccount: empty(d.pfAccount),
    esiNumber: empty(d.esiNumber),
    maritalStatus: empty(d.maritalStatus),
    bloodGroup: empty(d.bloodGroup),
    passport: empty(d.passport),
    family: empty(d.family),
    confirmationDate: d.confirmationDate || null,
    contractEnd: d.contractEnd || null,
    noticeDays: whole(d.noticeDays),
    retirementDate: d.retirementDate || null,
    resignationDate: d.resignationDate || null,
    relievingDate: d.relievingDate || null,
    leaveEncashed: empty(d.leaveEncashed),
    reasonForLeaving: empty(d.reasonForLeaving),
    feedback: empty(d.feedback),
  };
}

async function findPerson(id: string): Promise<Person | null> {
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await listPeople({ cursor, limit: 50 });
    const hit = page.items.find((row) => row.id === id);
    if (hit) return hit;
    cursor = page.nextCursor ?? undefined;
    if (!cursor) return null;
  }
  return null;
}

const FIELDS: {
  tab: Tab;
  key: TextKey;
  label: string;
  kind: Kind;
  options?: string[];
  required?: boolean;
  span?: 2 | 3;
  section?: string;
}[] = [
  { tab: 'overview', key: 'series', label: 'Series', kind: 'text' },
  {
    tab: 'overview',
    key: 'gender',
    label: 'Gender',
    kind: 'select',
    options: GENDER,
    required: true,
  },
  { tab: 'overview', key: 'joinedOn', label: 'Date of Joining', kind: 'date', required: true },
  { tab: 'overview', key: 'firstName', label: 'First Name', kind: 'text', required: true },
  { tab: 'overview', key: 'dateOfBirth', label: 'Date of Birth', kind: 'date', required: true },
  {
    tab: 'overview',
    key: 'hrStatus',
    label: 'Status',
    kind: 'select',
    options: HR_STATUS,
    required: true,
  },
  { tab: 'overview', key: 'middleName', label: 'Middle Name', kind: 'text' },
  { tab: 'overview', key: 'salutation', label: 'Salutation', kind: 'select', options: SALUTE },
  { tab: 'overview', key: 'lastName', label: 'Last Name', kind: 'text' },
  { tab: 'overview', key: 'hrUserId', label: 'User ID', kind: 'text', section: 'User Details' },
  { tab: 'overview', key: 'employeeCode', label: 'Employee code', kind: 'text' },
  {
    tab: 'overview',
    key: 'department',
    label: 'Department',
    kind: 'text',
    section: 'Company Details',
  },
  { tab: 'overview', key: 'designation', label: 'Designation', kind: 'text' },
  { tab: 'overview', key: 'branch', label: 'Branch', kind: 'text' },
  { tab: 'overview', key: 'grade', label: 'Employee Grade', kind: 'text' },
  { tab: 'overview', key: 'employeeGroup', label: 'Employee Group', kind: 'text' },
  {
    tab: 'overview',
    key: 'employmentType',
    label: 'Employment type',
    kind: 'select',
    options: EMPLOYMENT,
  },
  { tab: 'address', key: 'phone', label: 'Mobile', kind: 'text' },
  { tab: 'address', key: 'personalEmail', label: 'Personal email', kind: 'text' },
  { tab: 'address', key: 'email', label: 'Company email', kind: 'text', required: true },
  { tab: 'address', key: 'currentAddress', label: 'Current address', kind: 'area', span: 3 },
  { tab: 'address', key: 'permanentAddress', label: 'Permanent address', kind: 'area', span: 3 },
  { tab: 'address', key: 'city', label: 'City', kind: 'text' },
  { tab: 'address', key: 'state', label: 'State', kind: 'text' },
  { tab: 'address', key: 'pincode', label: 'PIN code', kind: 'text' },
  {
    tab: 'address',
    key: 'emergencyName',
    label: 'Emergency contact',
    kind: 'text',
    section: 'Emergency',
  },
  { tab: 'address', key: 'emergencyPhone', label: 'Emergency phone', kind: 'text' },
  { tab: 'attendance', key: 'attendanceDeviceId', label: 'Attendance device ID', kind: 'text' },
  { tab: 'attendance', key: 'holidayList', label: 'Holiday list', kind: 'text' },
  { tab: 'attendance', key: 'defaultShift', label: 'Default shift', kind: 'text' },
  { tab: 'attendance', key: 'leaveApprover', label: 'Leave approver', kind: 'text' },
  { tab: 'salary', key: 'ctc', label: 'Cost to company (INR / year)', kind: 'text' },
  { tab: 'salary', key: 'salaryMode', label: 'Salary mode', kind: 'select', options: PAY },
  { tab: 'salary', key: 'bankName', label: 'Bank', kind: 'text' },
  { tab: 'salary', key: 'bankAccount', label: 'Account no.', kind: 'text' },
  { tab: 'salary', key: 'ifsc', label: 'IFSC', kind: 'text' },
  { tab: 'salary', key: 'pan', label: 'PAN', kind: 'text' },
  { tab: 'salary', key: 'pfAccount', label: 'PF account', kind: 'text', section: 'Statutory' },
  { tab: 'salary', key: 'esiNumber', label: 'ESI number', kind: 'text' },
  {
    tab: 'personal',
    key: 'maritalStatus',
    label: 'Marital status',
    kind: 'select',
    options: MARITAL,
  },
  { tab: 'personal', key: 'bloodGroup', label: 'Blood group', kind: 'select', options: BLOOD },
  { tab: 'personal', key: 'passport', label: 'Passport no.', kind: 'text' },
  { tab: 'personal', key: 'family', label: 'Family', kind: 'area', span: 3 },
  {
    tab: 'profile',
    key: 'employmentType',
    label: 'Employment type',
    kind: 'select',
    options: EMPLOYMENT,
  },
  { tab: 'profile', key: 'designation', label: 'Designation', kind: 'text' },
  { tab: 'profile', key: 'department', label: 'Department', kind: 'text' },
  { tab: 'joining', key: 'joinedOn', label: 'Date of joining', kind: 'date' },
  { tab: 'joining', key: 'confirmationDate', label: 'Confirmation date', kind: 'date' },
  { tab: 'joining', key: 'contractEnd', label: 'Contract end', kind: 'date' },
  { tab: 'joining', key: 'noticeDays', label: 'Notice (days)', kind: 'text' },
  { tab: 'joining', key: 'retirementDate', label: 'Retirement date', kind: 'date' },
  { tab: 'exit', key: 'resignationDate', label: 'Resignation letter date', kind: 'date' },
  { tab: 'exit', key: 'relievingDate', label: 'Relieving date', kind: 'date' },
  { tab: 'exit', key: 'leaveEncashed', label: 'Leave encashed', kind: 'select', options: YESNO },
  { tab: 'exit', key: 'reasonForLeaving', label: 'Reason for leaving', kind: 'area', span: 3 },
  { tab: 'exit', key: 'feedback', label: 'Feedback', kind: 'area', span: 3 },
];

export function EmployeeForm({ personId }: { personId: string | null }) {
  const router = useRouter();
  const { user } = useRole();
  const [tab, setTab] = useState<Tab>('overview');
  const [person, setPerson] = useState<Person | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [saved, setSaved] = useState(JSON.stringify(blank()));
  const [places, setPlaces] = useState<Terr[]>([]);
  const [managers, setManagers] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void getTerritories()
      .then((rows) => {
        if (!live) return;
        setPlaces(
          rows.filter((t) => !t.deletedAt).map((t) => ({ id: t.id, name: t.name, level: t.level })),
        );
      })
      .catch(() => live && setPlaces([]));
    void (async () => {
      const rows: Person[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const page = await listPeople({ cursor, limit: 50 });
        rows.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (!cursor) break;
      }
      if (live) setManagers(rows);
    })().catch(() => live && setManagers([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!personId) return;
    let live = true;
    void findPerson(personId)
      .then((row) => {
        if (!live) return;
        if (!row) {
          setMissing(true);
          return;
        }
        const next = fromPerson(row);
        setPerson(row);
        setDraft(next);
        setSaved(JSON.stringify(next));
      })
      .catch(
        (e) => live && setError(e instanceof Error ? e.message : 'Could not open this employee.'),
      );
    return () => {
      live = false;
    };
  }, [personId]);

  const dirty = JSON.stringify(draft) !== saved;
  const placeChoices = places.filter((t) =>
    draft.role === 'business_manager' ? t.level === 'headquarter' : true,
  );

  function setText(key: TextKey, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function generateEmployeeCode() {
    await apiReady();
    const r = await api.GET('/v1/employees/next-code', {
      params: { query: { role: draft.role } },
    });
    if (!r.data) return toast.error(toApiError(r).message || 'Could not make a code.');
    setText('employeeCode', r.data.code);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName(draft);
    if (
      !draft.firstName.trim() ||
      !draft.gender ||
      !draft.joinedOn ||
      !draft.dateOfBirth ||
      !draft.hrStatus
    ) {
      setTab('overview');
      setError('First name, gender, date of joining, date of birth, and status are required.');
      return;
    }
    if (!draft.email.trim()) {
      setTab('address');
      setError('Company email is required.');
      return;
    }
    const phone = draft.phone.trim();
    if (phone && (phone.length < 6 || phone.length > 20)) {
      setTab('address');
      setError('Mobile needs 6 to 20 characters.');
      return;
    }
    if (needsManager(draft.role) && !draft.managerId) {
      setTab('overview');
      setError('Pick who they report to.');
      return;
    }
    if (needsPlace(draft.role) && !draft.territoryId) {
      setTab('overview');
      setError(draft.role === 'business_manager' ? 'Pick a headquarters.' : 'Pick a place.');
      return;
    }
    if (draft.ctc.trim() && whole(draft.ctc) == null) {
      setTab('salary');
      setError('Cost to company must be a whole number of rupees.');
      return;
    }
    if (draft.noticeDays.trim() && whole(draft.noticeDays) == null) {
      setTab('joining');
      setError('Notice days must be a whole number.');
      return;
    }
    setSaving(true);
    setError(null);
    const email = draft.email.trim();
    const profile = profileBody(draft);
    try {
      if (!person) {
        const created = await api.POST('/v1/employees', {
          body: {
            name,
            email,
            phone: phone || null,
            employeeCode: empty(draft.employeeCode),
            designation: empty(draft.designation),
            joinedOn: draft.joinedOn || null,
            dateOfBirth: draft.dateOfBirth || null,
            role: draft.role,
            territoryIds: needsPlace(draft.role) && draft.territoryId ? [draft.territoryId] : [],
            managerId: needsManager(draft.role) ? draft.managerId || null : null,
            ...profile,
          } as never,
        });
        if (created.error || !created.data) {
          const apiError = toApiError(created);
          throw new Error(
            (assignMessage(apiError) ?? apiError.message) || 'Could not create the employee.',
          );
        }
        toast.success(draft.createUser ? `Invite sent to ${email}` : `Saved ${name}`);
        router.replace(`/hr/employees/${created.data.employee.id}`);
        return;
      }
      const base = fromPerson(person);
      const patch = { version: person.version ?? 0, ...profile } as PersonPatch;
      if (name !== displayName(base)) patch.name = name;
      if (!person.hasLogin && email !== base.email) patch.email = email;
      patch.phone = phone || null;
      patch.employeeCode = empty(draft.employeeCode);
      patch.designation = empty(draft.designation);
      patch.joinedOn = draft.joinedOn || null;
      patch.dateOfBirth = draft.dateOfBirth || null;
      if (draft.role !== base.role) patch.role = draft.role;
      if (needsPlace(draft.role)) {
        if (draft.territoryId !== base.territoryId || patch.role)
          patch.territoryIds = draft.territoryId ? [draft.territoryId] : [];
      } else if (person.territoryIds.length) patch.territoryIds = [];
      const manager = needsManager(draft.role) ? draft.managerId || null : null;
      if (manager !== (person.managerId ?? null)) patch.managerId = manager;
      await updatePerson(person.id, patch);
      const fresh = await findPerson(person.id);
      if (fresh) {
        const next = fromPerson(fresh);
        setPerson(fresh);
        setDraft(next);
        setSaved(JSON.stringify(next));
      }
      toast.success(`Saved ${name}`);
    } catch (err) {
      const fail = (err as { kind?: string }).kind ? (err as ReturnType<typeof failure>) : null;
      setError(fail?.message ?? (err instanceof Error ? err.message : 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  if (personId && !person && !missing && !error)
    return <p className="p-6 text-sm text-muted-foreground">Loading employee…</p>;
  if (missing)
    return (
      <p className="p-6 text-sm">
        This employee is not in the directory.{' '}
        <Link href="/hr/employees" className="text-primary">
          Back to employees
        </Link>
      </p>
    );

  return (
    <form
      onSubmit={(e) => void save(e)}
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          <Link href="/hr" className="hover:text-foreground">
            HR
          </Link>
          {' / '}
          <Link href="/hr/employees" className="hover:text-foreground">
            People
          </Link>
          {' / '}
          <span className="text-foreground">
            {person ? displayName(draft) || person.name : 'New employee'}
          </span>
        </p>
        {dirty && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            Not saved
          </span>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {person && (
        <p className="text-sm text-muted-foreground">
          Sign-in status: {person.status}. Status above is the HR status and does not by itself
          block sign-in.
        </p>
      )}
      <div
        {...({ focusgroup: 'tablist' } as HTMLAttributes<HTMLDivElement>)}
        aria-label="Employee sections"
        className="flex gap-1 overflow-x-auto border-b"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-selected={tab === item.id}
            onClick={(e) => {
              setTab(item.id);
              e.currentTarget.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
                container: 'nearest',
              } as ScrollIntoViewOptions);
            }}
            className="shrink-0 border-b border-transparent px-3 py-2 text-sm text-muted-foreground aria-selected:border-primary aria-selected:text-primary"
          >
            {item.title}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {FIELDS.filter((field) => field.tab === tab).map((field) => {
          const span =
            field.span === 3
              ? 'md:col-span-2 xl:col-span-3'
              : field.span === 2
                ? 'md:col-span-2'
                : '';
          const id = `hr-${field.tab}-${field.key}`;
          const locked = field.key === 'email' && !!person?.hasLogin;
          return (
            <div
              key={id}
              className={cn(
                'grid gap-1.5',
                field.section ? 'mt-2 border-t pt-4 md:col-span-2 xl:col-span-3' : span,
              )}
            >
              {field.section && (
                <h2 className="text-sm font-medium md:col-span-2 xl:col-span-3">{field.section}</h2>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor={id}>
                  {field.label}
                  {field.required && <span className="text-primary"> *</span>}
                </Label>
                {field.kind === 'select' ? (
                  <select
                    id={id}
                    className={SELECT}
                    required={field.required}
                    value={draft[field.key]}
                    onChange={(e) => setText(field.key, e.target.value)}
                  >
                    <option value="">Select</option>
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.key === 'employeeCode' ? (
                  <div className="flex gap-2">
                    <Input
                      id={id}
                      name={field.key}
                      value={draft.employeeCode}
                      onChange={(e) => setText('employeeCode', e.target.value)}
                      className="h-10"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 shrink-0"
                      onClick={() => void generateEmployeeCode()}
                    >
                      Generate
                    </Button>
                  </div>
                ) : field.kind === 'area' ? (
                  <textarea
                    id={id}
                    rows={3}
                    value={draft[field.key]}
                    onChange={(e) => setText(field.key, e.target.value)}
                    className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  />
                ) : (
                  <Input
                    id={id}
                    name={field.key}
                    type={
                      field.kind === 'date'
                        ? 'date'
                        : field.key === 'email' || field.key === 'personalEmail'
                          ? 'email'
                          : field.key === 'phone' || field.key === 'emergencyPhone'
                            ? 'tel'
                            : 'text'
                    }
                    required={field.required}
                    disabled={locked}
                    autoComplete={
                      field.key === 'firstName'
                        ? 'given-name'
                        : field.key === 'email'
                          ? 'email'
                          : field.key === 'phone'
                            ? 'tel'
                            : undefined
                    }
                    value={draft[field.key]}
                    onChange={(e) => setText(field.key, e.target.value)}
                    className="h-10"
                  />
                )}
              </div>
            </div>
          );
        })}
        {tab === 'overview' && (
          <>
            <label className="flex items-start gap-2 text-sm md:col-span-2 xl:col-span-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.createUser}
                onChange={(e) => setDraft((d) => ({ ...d, createUser: e.target.checked }))}
              />
              <span>
                Create user automatically
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Sends a sign-in invite to the company email. Leave this off to store the employee
                  without a login.
                </span>
              </span>
            </label>
            <div className="grid gap-1.5">
              <Label htmlFor="hr-company">Company</Label>
              <Input
                id="hr-company"
                value={user.territory || 'Current company'}
                disabled
                className="h-10"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="hr-role">
                Role <span className="text-primary">*</span>
              </Label>
              <select
                id="hr-role"
                className={SELECT}
                required
                value={draft.role}
                onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as Role }))}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
            </div>
            {needsManager(draft.role) && (
              <div className="grid gap-1.5">
                <Label htmlFor="hr-manager">
                  Reports to <span className="text-primary">*</span>
                </Label>
                <select
                  id="hr-manager"
                  className={SELECT}
                  required
                  value={draft.managerId}
                  onChange={(e) => setDraft((d) => ({ ...d, managerId: e.target.value }))}
                >
                  <option value="">Select</option>
                  {managers
                    .filter((m) => m.id !== person?.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({roleLabel(m.primaryRole ?? m.roles[0])})
                      </option>
                    ))}
                </select>
              </div>
            )}
            {needsPlace(draft.role) && (
              <div className="grid gap-1.5">
                <Label htmlFor="hr-place">
                  {draft.role === 'business_manager' ? 'Headquarters' : 'Place'}{' '}
                  <span className="text-primary">*</span>
                </Label>
                <select
                  id="hr-place"
                  className={SELECT}
                  required
                  value={draft.territoryId}
                  onChange={(e) => setDraft((d) => ({ ...d, territoryId: e.target.value }))}
                >
                  <option value="">Select</option>
                  {placeChoices.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>
    </form>
  );
}
