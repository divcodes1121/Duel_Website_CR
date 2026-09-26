import {
  fetchCardBoard,
  fetchDuelReport,
  fetchDuelZone,
  fetchPlayerCounter,
  fetchPlayerReport,
  fetchRecentBattles,
  isLiveReport,
  type DateWindow,
  type DuelZoneReport,
} from '../state/analyticsClient';
import { sectionAllowed, type Access } from '../state/tiers';
import type { ReportBlock, ReportDoc, StatsBlock } from './analyticsReport';
import { duelAnalysisDoc, duelZoneDoc } from './duelAdapters';
import { cardBoardDoc, livePlayerReportDoc, playerReportDoc } from './reportAdapters';
import { deckCounterDoc, duelInsightBlocks, recentBattlesDoc } from './screenAdapters';
import { printableName } from './report/text';

/* THE FULL PLAYER REPORT — every section of the player page in one document.
 *
 * The shell's Export button sits above all of a player's sections, so it can
 * offer what no single screen can: the whole dossier. Each section is read
 * over the SAME window, by the SAME adapter its own screen exports with, so a
 * section of this document and that screen's own PDF can never disagree.
 *
 * GATED BY THE SAME RULE AS THE SCREENS. A section the account may not open
 * is not fetched and not printed — `sectionAllowed` is the one definition, so
 * the dossier cannot become a way round a gate.
 *
 * Reads run in parallel and a failed one costs its section, not the report:
 * the contents say which sections are present, and a failure is listed at the
 * end rather than silently dropped. */

interface Part {
  /** The rail label, which is what `sectionAllowed` keys on. */
  label: string;
  run: () => Promise<ReportDoc>;
}

/** Fold several screen reports into one sectioned document. */
export function combineReports(
  docs: ReportDoc[],
  opts: { screen: string; subject?: string; summary?: string; missing?: string[] },
): ReportDoc {
  const blocks: ReportBlock[] = [];
  const leadTiles: StatsBlock['tiles'] = [];
  for (const d of docs) {
    let body = d.blocks;
    let tiles: StatsBlock['tiles'] = [];
    if (body[0]?.kind === 'stats' && !body[0].heading) {
      tiles = body[0].tiles;
      body = body.slice(1);
    }
    if (!leadTiles.length && tiles.length) leadTiles.push(...tiles.slice(0, 4));
    const window = d.meta.find((m) => m.label === 'Window')?.value;
    blocks.push({
      kind: 'divider',
      title: d.screen,
      subtitle: window ? `Window ${window}` : undefined,
      tag: d.summary,
      hue: d.hue,
      stats: tiles.slice(0, 4).map((t) => ({ label: t.label, value: t.value, note: t.note })),
      contents: d.screen,
    });
    if (d.read) blocks.push({ kind: 'note', body: d.read });
    blocks.push(...body.filter((b) => b.kind !== 'break'));
    if (d.caveats?.length) {
      blocks.push({ kind: 'note', heading: `About ${d.screen}`, body: d.caveats.join('  ·  ') });
    }
  }
  if (opts.missing?.length) {
    blocks.push({ kind: 'note', heading: 'Not included', body: opts.missing.join('  ·  ') });
  }
  return {
    screen: opts.screen,
    subject: opts.subject,
    summary: opts.summary,
    hue: 'violet',
    contents: true,
    cover: 'full',
    meta: docs[0]?.meta ?? [],
    blocks: [...(leadTiles.length ? [{ kind: 'stats' as const, tiles: leadTiles }] : []), ...blocks],
  };
}

export async function buildPlayerDossier(
  tag: string,
  win: DateWindow,
  access: Access,
  step: (text: string) => void = () => {},
): Promise<ReportDoc> {
  // One Duel Zone read serves both the Duel Zone section and the insights at
  // the foot of Duel Analysis.
  let zone: Promise<DuelZoneReport> | null = null;
  const duelZone = () => {
    zone ??= fetchDuelZone(tag, win);
    return zone;
  };
  let name: string | undefined;

  const parts: Part[] = ([
    {
      label: 'Search Player',
      run: async () => {
        const r = await fetchPlayerReport(tag, win);
        if (isLiveReport(r)) return livePlayerReportDoc(r, tag);
        name = r.player.name ?? undefined;
        return playerReportDoc(r, tag);
      },
    },
    {
      label: 'Recent Battles',
      run: async () => {
        const r = await fetchRecentBattles(tag, win, 1, 50);
        name ??= r.player.name ?? undefined;
        return recentBattlesDoc(r, tag);
      },
    },
    {
      label: 'Duel Analysis',
      run: async () => {
        const [d, z] = await Promise.all([fetchDuelReport(tag, win), duelZone().catch(() => null)]);
        return duelAnalysisDoc(d, tag, z ? duelInsightBlocks(z) : []);
      },
    },
    { label: 'Duel Zone', run: async () => duelZoneDoc(await duelZone(), tag) },
    { label: 'Cards', run: async () => cardBoardDoc(await fetchCardBoard(tag, win), tag) },
    { label: 'Deck Counter', run: async () => deckCounterDoc(await fetchPlayerCounter(tag, win), tag) },
  ] as Part[]).filter((p) => sectionAllowed(access, p.label));

  let done = 0;
  step(`Reading 0 of ${parts.length} sections…`);
  const settled = await Promise.all(parts.map((p) => p.run()
    .then((doc) => ({ doc, label: p.label }))
    .catch((e) => {
      console.warn('[report] section failed', p.label, e);
      return { doc: null, label: p.label };
    })
    .finally(() => {
      done += 1;
      step(`Reading ${done} of ${parts.length} sections…`);
    })));

  const docs = settled.filter((x) => x.doc).map((x) => x.doc as ReportDoc);
  const missing = settled.filter((x) => !x.doc).map((x) => `${x.label}: could not be read`);
  if (!docs.length) throw new Error('No section of the player report could be read');
  return combineReports(docs, {
    screen: 'Player Report',
    subject: tag,
    summary: name ? printableName(name, '') || undefined : undefined,
    missing,
  });
}
