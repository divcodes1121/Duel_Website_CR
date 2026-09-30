import type { DailySession, SessionDeck } from '../../../state/analyticsClient';
import { CardArt } from '../../Analytics/CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ChartCard, InsightRow } from '../../ui/bionis-dashboard';
import { ShieldIcon } from '../../Dashboard/icons';
import { formatDay } from '../../../state/coachToday';
import { drawnDeck, formInferred } from '../../../utils/deckSeating';
import styles from './CoachRoster.module.css';

const nf = new Intl.NumberFormat('en-US');

/**
 * TODAY'S SESSION — the one block on the practise tab that is MEANT to change
 * daily (`server/coach_session.py`).
 *
 * Reported: "the daily practice for everyone on the roster does not change".
 * Measured: the deck put in front of a player was identical five days running
 * for seven of eight real roster players, because everything else on this tab
 * answers "what beats the field over thirty days" — correctly stable. This
 * answers "what do we work on today": one matchup, the deck to bring into it,
 * the real meta list to practise against, what wins it in duels, and what the
 * meta is taking up this week.
 *
 * `why` IS SAID DIFFERENTLY FOR EACH VALUE. A focus that came from yesterday's
 * games is evidence and prints the counts; a rotation is a SCHEDULE and prints
 * "day n of m" — dressing a calendar up as a finding would claim something the
 * data never said.
 */
export function SessionCard({ session, self = false }: { session: DailySession | null | undefined; self?: boolean }) {
  if (!session) return null;
  const f = session.focus;
  const last = session.lastDays;
  const day = formatDay(session.day);

  if (!f) {
    return (
      <ChartCard title={`Today · ${day}`} badge="No focus">
        <p className={styles.muted}>No matchup to drill: no measured weakness and no meta board.</p>
      </ChartCard>
    );
  }

  const whyLine =
    f.why === 'lost_recently' && f.recent
      ? `${f.recent.wins}–${f.recent.losses} since ${formatDay(session.since)}${
          f.excessLosses != null ? ` · ${f.excessLosses.toFixed(1)} more losses than usual` : ''
        }`
      : f.rotation
        ? `${f.why === 'field_rotation' ? 'Field rotation' : 'Rotation'} day ${f.rotation.index} of ${f.rotation.of} · next ${f.rotation.next}`
        : null;
  const recordLine = f.record
    ? `${f.record.winRate.toFixed(1)}% over ${nf.format(f.record.battles)} · ${f.record.deficit >= 0 ? '−' : '+'}${Math.abs(
        f.record.deficit,
      ).toFixed(1)} vs ${self ? 'your' : 'their'} rate`
    : f.why === 'field_rotation'
      ? 'The field’s most-played'
      : 'Not met enough to rate';

  const p = session.practise;
  const a = session.against;
  const d = session.duel;

  return (
    <ChartCard
      title={`Today · ${day}`}
      badge={`vs ${f.name}`}
      note={[
        last.battles > 0
          ? `Since ${formatDay(session.since)}: ${nf.format(last.battles)} games · ${last.wins}–${last.losses}`
          : `No games since ${formatDay(session.since)}`,
        session.duelWeek && session.duelWeek.games > 0
          ? `duels ${session.duelWeek.days}d: ${session.duelWeek.games} games · ${session.duelWeek.wins} won`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <InsightRow
        icon={<ShieldIcon />}
        tone={f.why === 'lost_recently' ? 'bad' : 'warn'}
        title={`Drill ${f.name}${f.rising ? ' · rising this week' : ''}`}
        description={[whyLine, recordLine].filter(Boolean).join(' · ')}
      />

      <ul className={styles.deckList}>
        {p && (
          <SessionRow
            label="Practise with"
            deck={p}
            figures={[
              `${p.vsFocus.winRate.toFixed(1)}% vs ${f.name}`,
              `${p.expectedWinRate.toFixed(1)}% vs field`,
              p.source === 'their-cards' && p.shared != null
                ? `${p.shared}/8 of ${self ? 'your' : 'their'} deck${p.deckBattles ? ` · ${nf.format(p.deckBattles)}g` : ''}`
                : 'the field’s deck',
            ]}
          />
        )}
        {a && (
          <SessionRow
            label="Practise against"
            deck={a}
            figures={[
              a.useRate != null ? `${a.useRate.toFixed(2)}% of the meta` : null,
              a.winRate != null ? `wins ${a.winRate.toFixed(1)}%` : null,
              a.entered ? 'new this week' : a.rankDelta ? `${a.rankDelta > 0 ? '▲' : '▼'}${Math.abs(a.rankDelta)} this week` : null,
            ]}
          />
        )}
        {d && d.duel && (
          <SessionRow
            label="Proven in duels"
            deck={d}
            figures={[
              `${d.duel.winRate.toFixed(1)}% vs ${f.name} in duels`,
              `${nf.format(d.duel.games)} games`,
              d.pick === 'own'
                ? `${self ? 'your' : 'their'} own duel deck`
                : d.known > 0
                  ? `${d.known}/8 ${self ? 'your' : 'their'} cards`
                  : null,
            ]}
          />
        )}
      </ul>

      {session.rising.length > 0 && (
        <>
          <p className={styles.muted}>Rising this week</p>
          <ul className={styles.deckList}>
            {session.rising.map((r) => (
              <SessionRow
                key={r.deckHash}
                deck={r}
                figures={[
                  `▲${r.rankDelta} to #${r.rank ?? '—'}`,
                  r.useRate != null ? `${r.previousUseRate.toFixed(2)} → ${r.useRate.toFixed(2)}%` : null,
                  r.threatensYou ? (self ? 'you lose to this' : 'they lose to this') : null,
                ]}
              />
            ))}
          </ul>
        </>
      )}
    </ChartCard>
  );
}

function SessionRow({ label, deck, figures }: { label?: string; deck: SessionDeck; figures: (string | null)[] }) {
  const cards = deck.cards ?? [];
  const drawn = cards.length === 8 ? drawnDeck(cards, deck.art, deck.artInferred, deck.artFilled) : null;
  return (
    <li className={styles.deckItem}>
      <div className={`${styles.deckItemHead} ${styles.deckHeadTight}`} style={{ cursor: 'default' }}>
        {drawn && (
          <div className={styles.deckCards}>
            {drawn.cards.map((c) => (
              <CardArt key={c} card={c} variant={drawn.art[c]} inferred={formInferred(drawn, c)} className={styles.deckCard} />
            ))}
          </div>
        )}
        <span className={`${styles.deckFigures} ${styles.deckFiguresInline}`}>
          {label && <span className={styles.oppTag}>{label}</span>}
          <span className={styles.deckName}>{deck.name}</span>
          {figures.filter(Boolean).map((t) => (
            <span key={t as string} className={styles.oppTag}>
              {t}
            </span>
          ))}
          {drawn && <DeckActions cards={drawn.cards} name={deck.name} />}
        </span>
      </div>
    </li>
  );
}
