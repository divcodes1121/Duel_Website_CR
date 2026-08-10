/**
 * Client for the analytics API.
 *
 * The API is local right now (server/app.py, proxied by Vite) and will be
 * hosted later. Nothing in this file knows which — it only ever calls
 * `/api/analytics/*`, so moving the service is a proxy or base-URL change
 * rather than a code change. `VITE_ANALYTICS_BASE` is the escape hatch for
 * pointing a build straight at a remote host.
 */

const BASE = import.meta.env.VITE_ANALYTICS_BASE ?? '';

export interface ApiPlayer {
  name: string;
  tag: string;
  verified: boolean;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  crownsFor: number;
  crownsAgainst: number;
  lastSeen: string;
}

export interface ApiDeck {
  rank: number;
  name: string;
  deckHash: string;
  cards: string[];
  useRate: number;
  winRate: number;
  matches: number;
  wins: number;
  losses: number;
  avgElixir: number | null;
  winCondition: string | null;
  lastSeen: string;
}

export interface ApiTrends {
  days: string[];
  series: { deckHash: string; use: number[]; win: number[] }[];
  archiveUsed: boolean;
}

export interface ApiSources {
  hot: { path: string | null; available: boolean; sizeBytes: number };
  archive: { path: string; available: boolean; sizeBytes: number };
}

export interface PlayerReport {
  player: ApiPlayer;
  decks: ApiDeck[];
  trends: ApiTrends;
  sources: ApiSources;
}

/** Distinguishes "no data for this player" from "the service is not running". */
export class AnalyticsError extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'not_found' | 'invalid_tag' | 'server',
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`);
  } catch {
    // Nothing listening — the local API is not running.
    throw new AnalyticsError(
      'The analytics service is not running. Start it with: python server/app.py',
      'offline',
    );
  }
  if (res.ok) return (await res.json()) as T;

  const body = await res.json().catch(() => ({}) as { error?: string });
  const err = (body as { error?: string }).error;
  if (res.status === 404) throw new AnalyticsError('No stored battles for that tag yet.', 'not_found');
  if (res.status === 400) throw new AnalyticsError('That is not a valid Clash Royale tag.', 'invalid_tag');
  throw new AnalyticsError(err || `Request failed (${res.status})`, 'server');
}

export function fetchPlayerReport(tag: string, days = 30): Promise<PlayerReport> {
  return get<PlayerReport>(`/api/analytics/player/${encodeURIComponent(tag)}?days=${days}`);
}

export function fetchSuggestedTags(): Promise<{
  tags: { tag: string; name: string | null; battles: number }[];
}> {
  return get('/api/analytics/suggest');
}

export function fetchSources(): Promise<ApiSources> {
  return get<ApiSources>('/api/analytics/status');
}
