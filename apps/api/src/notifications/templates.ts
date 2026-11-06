import type { NotificationType } from '@ariforce/contracts';

export type NotifyData = Record<string, unknown> & { actorName?: string };

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const range = (d: NotifyData) =>
  d.fromDate
    ? d.fromDate === d.toDate || !d.toDate
      ? ` on ${s(d.fromDate)}`
      : ` ${s(d.fromDate)} to ${s(d.toDate)}`
    : '';
const kind = (d: NotifyData) => (d.typeCode ? `${s(d.typeCode)} leave` : 'leave');
const reason = (d: NotifyData) =>
  d.reason || d.comment ? ` Reason: ${s(d.reason || d.comment)}` : '';
const comment = (d: NotifyData) => (d.comment ? ` Comment: ${s(d.comment)}` : '');
const amount = (d: NotifyData) =>
  typeof d.total === 'number' || typeof d.total === 'string' ? ` (INR ${s(d.total)})` : '';
const on = (d: NotifyData) => (d.date ? ` for ${s(d.date)}` : '');
const by = (d: NotifyData, who: string) =>
  d.autoApproved ? 'automatically (no manager)' : `by ${who}`;
const plan = (d: NotifyData) =>
  d.from
    ? `tour plan ${d.from === d.to || !d.to ? `for ${s(d.from)}` : `${s(d.from)} to ${s(d.to)}`}`
    : `${d.month ? `${s(d.month)} ` : ''}tour plan`;
const claim = (d: NotifyData) => `${d.month ? `${s(d.month)} ` : ''}expense claim`;

/** English title/body rendered once, at notification time. */
export function render(type: NotificationType, d: NotifyData): { title: string; body: string } {
  const who = d.actorName || 'Someone';
  switch (type) {
    case 'leave.submitted':
      return {
        title: 'Leave request to review',
        body: `${who} applied for ${kind(d)}${range(d)}.`,
      };
    case 'leave.approved':
      return {
        title: 'Leave approved',
        body: `Your ${kind(d)}${range(d)} was approved ${by(d, who)}.${d.autoApproved ? '' : comment(d)}`,
      };
    case 'leave.rejected':
      return {
        title: 'Leave rejected',
        body: `Your ${kind(d)}${range(d)} was rejected by ${who}.${reason(d)}`,
      };
    case 'leave.cancelled':
      return { title: 'Leave cancelled', body: `${who} cancelled the ${kind(d)}${range(d)}.` };
    case 'expense.submitted':
      return {
        title: 'Expense claim to review',
        body: `${who} submitted the ${claim(d)}${amount(d)}.`,
      };
    case 'expense.approved':
      return {
        title: 'Expense claim approved',
        body: `Your ${claim(d)}${amount(d)} was approved ${by(d, who)}.${d.autoApproved ? '' : comment(d)}`,
      };
    case 'expense.blocked': {
      const dates = Array.isArray(d.dates) ? d.dates.map(s).join(', ') : '';
      return {
        title: 'DCRs waiting for you',
        body: `${d.ownerName ? s(d.ownerName) : 'A team member'}'s ${claim(d)} can't be approved until the DCRs${dates ? ` for ${dates}` : ''} are approved.`,
      };
    }
    case 'tour_plan.submitted':
      return { title: 'Tour plan to review', body: `${who} submitted the ${plan(d)}.` };
    case 'dcr.submitted':
      return { title: 'DCR to review', body: `${who} submitted the DCR${on(d)}.` };
    case 'dcr.approved':
      return {
        title: 'DCR approved',
        body: `Your DCR${on(d)} was approved ${by(d, who)}.`,
      };
    case 'dcr.rejected':
      return {
        title: 'DCR rejected',
        body: `Your DCR${on(d)} was rejected by ${who}.${reason(d)}`,
      };
    case 'dcr_unlock.submitted':
      return {
        title: 'DCR correction to review',
        body: `${who} asked to correct the DCR${on(d)}.${d.reason ? ` Reason: ${s(d.reason)}` : ''}`,
      };
    case 'dcr_unlock.approved':
      return {
        title: 'DCR correction approved',
        body: `Your DCR correction${on(d)} was approved by ${who}. The day is open for editing.`,
      };
    case 'expense.rejected':
      return {
        title: 'Expense claim rejected',
        body: `Your ${claim(d)}${amount(d)} was rejected by ${who}.${reason(d)}`,
      };
    case 'expense.paid':
      return {
        title: 'Expense claim paid',
        body: `Your ${claim(d)}${amount(d)} was marked paid${d.paymentRef ? ` (ref ${s(d.paymentRef)})` : ''}.`,
      };
    case 'exceptions.digest': {
      const n = Number(d.total ?? 0);
      const high = Number(d.high ?? 0);
      return {
        title: 'Team exceptions need attention',
        body: `${n} new exception${n === 1 ? '' : 's'} in your team${high ? ` (${high} high)` : ''}${d.from ? ` for ${s(d.from)} to ${s(d.to)}` : ''}.`,
      };
    }
    case 'tour_plan.approved':
      return {
        title: 'Tour plan approved',
        body: `Your ${plan(d)} was approved ${by(d, who)}.${d.autoApproved ? '' : comment(d)}`,
      };
    case 'doctor.approved':
      return {
        title: 'Doctor approved',
        body: `${d.name ? s(d.name) : 'The doctor you added'} was approved by ${who}.${comment(d)}`,
      };
    case 'tour_plan.rejected':
      return {
        title: 'Tour plan rejected',
        body: `Your ${plan(d)} was rejected by ${who}.${reason(d)}`,
      };
    case 'doctor.rejected':
      return {
        title: 'Doctor not approved',
        body: `${d.name ? s(d.name) : 'The doctor you added'} was rejected by ${who}.${reason(d)}`,
      };
    case 'dcr_unlock.rejected':
      return {
        title: 'DCR correction rejected',
        body: `Your DCR correction${d.date ? ` for ${s(d.date)}` : ''} was rejected by ${who}.${reason(d)}`,
      };
    case 'company.message':
      return {
        title: s(d.title).slice(0, 120) || 'Company message',
        body: s(d.body).slice(0, 500) || 'You have a company message.',
      };
    case 'doctor.occasion':
      return {
        title: s(d.title).slice(0, 120) || 'Doctor dates coming up',
        body: s(d.summary).slice(0, 500) || 'A doctor birthday or anniversary is coming up.',
      };
  }
}
