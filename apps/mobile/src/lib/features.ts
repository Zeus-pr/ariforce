import type { IconName } from '@/components/icon';
import type { Tone } from '@/theme';

type Feature = { title: string; icon: IconName; tone: Tone; blurb: string };

/**
 * AriForce features the mobile app links to. Each opens a "Coming soon" screen until it is built.
 * Titles match the website's navigation.
 */
export const FEATURES = {
  dcr: {
    title: 'DCR',
    icon: 'clipboard-text-outline',
    tone: 'teal',
    blurb: 'Pick the work type, add doctor, chemist and stockist calls, and submit the day.',
  },
  'tour-plan': {
    title: 'Tour plan',
    icon: 'calendar-month-outline',
    tone: 'blue',
    blurb: 'Plan the month day by day and send it to your manager for approval.',
  },
  leave: {
    title: 'Leave',
    icon: 'beach',
    tone: 'orange',
    blurb: 'See your leave balance, apply for leave and track requests.',
  },
  expenses: {
    title: 'Expenses',
    icon: 'receipt-text-outline',
    tone: 'blue',
    blurb: 'TA/DA from your DCRs, plus other claims with bills.',
  },
  doctors: {
    title: 'Doctors',
    icon: 'stethoscope',
    tone: 'teal',
    blurb: 'Your listed doctors by territory, with visit history.',
  },
  chemists: {
    title: 'Chemists',
    icon: 'pill',
    tone: 'green',
    blurb: 'Chemists in your territories.',
  },
  stockists: {
    title: 'Stockists',
    icon: 'truck-delivery-outline',
    tone: 'orange',
    blurb: 'Stockists that supply your territories.',
  },
  approvals: {
    title: 'Approvals',
    icon: 'check-decagram-outline',
    tone: 'blue',
    blurb: "Approve your team's DCRs, tour plans, leave and expenses.",
  },
  attendance: {
    title: 'Attendance',
    icon: 'map-marker-radius-outline',
    tone: 'green',
    blurb: 'Punch in and out with your location, and see your attendance for the month.',
  },
  notifications: {
    title: 'Notifications',
    icon: 'bell-outline',
    tone: 'blue',
    blurb: 'Flags for missed DCRs, punch-in and tour plans, and approval updates.',
  },
} satisfies Record<string, Feature>;

export type FeatureKey = keyof typeof FEATURES;

export const isFeatureKey = (k: string): k is FeatureKey => Object.hasOwn(FEATURES, k);

/** Typed link to a feature's "Coming soon" screen. */
export const featureHref = (feature: FeatureKey) =>
  ({ pathname: '/coming-soon/[feature]', params: { feature } }) as const;
