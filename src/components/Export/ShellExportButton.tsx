import { useReportSource } from '../../state/reportExport';
import type { Access } from '../../state/tiers';
import { ExportButton, type FullReport } from './ExportButton';

/* The player shell's Export button, in the query row above every section.
 *
 * "This page" is whatever the open section registered — its whole report,
 * every tab included. "Full player report" reads every section the account
 * may open, over the window the open section is showing, and binds them into
 * one document. The composer is imported only when that item is pressed. */
export function ShellExportButton({ tag, access }: { tag: string; access: Access }) {
  const source = useReportSource((s) => s.source);
  const clean = tag.replace(/^#/, '').toUpperCase();
  const full: FullReport = {
    label: 'Full player report',
    hint: `Every section for #${clean}, in one document`,
    build: async (step) => {
      const win = useReportSource.getState().source?.win ?? { days: 30 };
      const { buildPlayerDossier } = await import('../../utils/playerDossier');
      return buildPlayerDossier(tag, win, access, step);
    },
  };
  return <ExportButton build={source?.build ?? null} full={full} />;
}
