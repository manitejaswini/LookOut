import type { SavedReport } from '../flows/funds-flow';

/**
 * The reports THIS browser filed, so the Funds and Claim pages know which report ids to look up. Nothing secret: a report id is
 * public once the report is on Arkiv. It lives in localStorage, so reports filed from another browser are not listed here.
 */

const KEY = 'lookout.reports.v0';

export const savedReports = (): SavedReport[] => {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as SavedReport[];
    return list.filter((r) => /^[0-9a-f]{32}$/.test(r.reportId));
  } catch {
    return [];
  }
};

export function rememberReport(r: SavedReport): void {
  const rest = savedReports().filter((x) => x.reportId !== r.reportId);
  window.localStorage.setItem(KEY, JSON.stringify([r, ...rest].slice(0, 50)));
}
