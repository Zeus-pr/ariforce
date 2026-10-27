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
        body: `Your ${kind(d)}${range(d)} was approved by ${who}.${comment(d)}`,
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
        body: `Your ${claim(d)}${amount(d)} was approved by ${who}.${comment(d)}`,
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
        body: `Your ${d.month ? `${s(d.month)} ` : ''}tour plan was approved by ${who}.${comment(d)}`,
      };
    case 'doctor.approved':
      return {
        title: 'Doctor approved',
        body: `${d.name ? s(d.name) : 'The doctor you added'} was approved by ${who}.${comment(d)}`,
      };
    case 'tour_plan.rejected':
      return {
        title: 'Tour plan rejected',
        body: `Your ${d.month ? `${s(d.month)} ` : ''}tour plan was rejected by ${who}.${reason(d)}`,
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
  }
}
