/**
 * Does the server draft TA/DA expense lines on DCR submit? (GET /v1/dcrs/options
 * .autoExpenseOnDcrSubmit, e80d8f6; missing = false.) Set whenever options are read.
 */
export const expenseCaps: { serverDrafts: boolean | null } = { serverDrafts: null };
