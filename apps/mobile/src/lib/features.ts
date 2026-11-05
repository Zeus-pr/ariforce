import { canViewTeamField, isSalesRole } from './roles';
import type { IconName } from '@/components/icon';
import type { Tone } from '@/theme';

type Feature = {
  title: string;
  icon: IconName;
  tone: Tone;
  /** One line for list rows (fits a 360 dp phone). */
  short: string;
  /** Longer description on the Coming soon screen. */
  blurb: string;
};

/**
 * AriForce features the mobile app links to. Each opens a "Coming soon" screen until it is built
 * (DCR, doctors, chemists, stockists and products are built: see featureHref).
 * Titles match the website's navigation.
 */
export const FEATURES = {
  dcr: {
    title: 'DCR',
    icon: 'clipboard-text-outline',
    tone: 'teal',
    short: 'Daily call report',
    blurb: 'Pick the work type, add doctor, chemist and stockist calls, and submit the day.',
  },
  'tour-plan': {
    title: 'Tour plan',
    icon: 'calendar-month-outline',
    tone: 'blue',
    short: 'Monthly plan and approval',
    blurb: 'Plan the month day by day and send it to your manager for approval.',
  },
  leave: {
    title: 'Leave',
    icon: 'beach',
    tone: 'orange',
    short: 'Balance and requests',
    blurb: 'See your leave balance, apply for leave and track requests.',
  },
  expenses: {
    title: 'Expenses',
    icon: 'receipt-text-outline',
    tone: 'blue',
    short: 'TA/DA and other claims',
    blurb: 'TA/DA from your DCRs, plus other claims with bills.',
  },
  pob: {
    title: 'POB',
    icon: 'cart-outline',
    tone: 'blue',
    short: 'Orders booked today',
    blurb: "See today's chemist and stockist orders from your DCR, and jump in to book more.",
  },
  doctors: {
    title: 'Doctors',
    icon: 'stethoscope',
    tone: 'teal',
    short: 'Listed doctors by territory',
    blurb: 'Your listed doctors by territory, with visit history.',
  },
  chemists: {
    title: 'Chemists',
    icon: 'pill',
    tone: 'green',
    short: 'Chemists in your territories',
    blurb: 'Chemists in your territories.',
  },
  stockists: {
    title: 'Stockists',
    icon: 'truck-delivery-outline',
    tone: 'orange',
    short: 'Stockists for your territories',
    blurb: 'Stockists that supply your territories.',
  },
  products: {
    title: 'Products',
    icon: 'package-variant-closed',
    tone: 'blue',
    short: 'Product details and prices',
    blurb: 'Browse product compositions, strengths and prices.',
  },
  approvals: {
    title: 'Approvals',
    icon: 'check-decagram-outline',
    tone: 'blue',
    short: 'DCR, tour plans, leave, expenses',
    blurb: "Approve your team's DCRs, tour plans, leave and expenses.",
  },
  attendance: {
    title: 'Attendance',
    icon: 'map-marker-radius-outline',
    tone: 'green',
    short: 'Punch in and out',
    blurb: 'Punch in and out with your location, and see your attendance for the month.',
  },
  teamField: {
    title: 'Team field',
    icon: 'account-group-outline',
    tone: 'teal',
    short: 'Team punch and visits',
    blurb: 'See who is on the field, punch times, and visit check-ins with GPS for your team.',
  },
  notifications: {
    title: 'Notifications',
    icon: 'bell-outline',
    tone: 'blue',
    short: 'Flags and approval updates',
    blurb: 'Flags for missed DCRs, punch-in and tour plans, and approval updates.',
  },
} satisfies Record<string, Feature>;

export type FeatureKey = keyof typeof FEATURES;

export const isFeatureKey = (k: string): k is FeatureKey => Object.hasOwn(FEATURES, k);

const MASTER_BUILT = ['doctors', 'chemists', 'stockists'] as const;
type MasterBuilt = (typeof MASTER_BUILT)[number];
const isMasterBuilt = (k: FeatureKey): k is MasterBuilt =>
  (MASTER_BUILT as readonly string[]).includes(k);

/** Features a person may open: DCR/POB need a sales role (same as the website's nav). */
export const canOpenFeature = (feature: FeatureKey, roles: readonly string[]) => {
  if (feature === 'dcr' || feature === 'pob') return isSalesRole(roles);
  if (feature === 'teamField') return canViewTeamField(roles);
  return true;
};

/** Link to a feature: its screen when the app has it, else its "Coming soon" screen. */
export const featureHref = (feature: FeatureKey, roles?: readonly string[]) => {
  // DCR / POB are for the sales ladder only (web nav.ts SALES); others land on Home.
  if (feature === 'dcr') return roles && !isSalesRole(roles) ? ('/' as const) : ('/dcr' as const);
  if (feature === 'pob') return roles && !isSalesRole(roles) ? ('/' as const) : ('/pob' as const);
  // Approvals: DCR review and DCR unlock requests are built; the screen checks isApprover.
  if (feature === 'approvals') return '/approvals' as const;
  if (feature === 'tour-plan') return '/tour-plan' as const;
  if (feature === 'notifications') return '/notifications' as const;
  if (feature === 'leave') return '/leave' as const;
  if (feature === 'expenses') return '/expenses' as const;
  if (feature === 'products') return '/products' as const;
  if (feature === 'teamField') return '/team-field' as const;
  if (isMasterBuilt(feature))
    return { pathname: '/masters/[kind]', params: { kind: feature } } as const;
  return { pathname: '/coming-soon/[feature]', params: { feature } } as const;
};
