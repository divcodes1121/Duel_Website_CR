import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnalyticsError,
  fetchTeamAnalysis,
  type TeamFolder,
  type TeamMember,
  type TeamReport,
} from '../../../state/analyticsClient';
import {
  MAX_SQUAD,
  overlappingTags,
  parseSquad,
  squadProblem,
  type SquadParse,
} from '../../../utils/squadParse';
import { recordDuration } from '../../../state/loadTiming';
import { ReadingState } from '../ReadingState';
import { VsMark } from '../../VsMark/VsMark';
import { FolderGallery, OpenFolder } from './TeamFolders';
import styles from './TeamAnalysis.module.css';

/**
 * TEAM ANALYSIS — two rosters in, a folder per opponent out.
 *
 * Paste your squad on the left and theirs on the right. Every opponent gets a
 * folder holding the decks they actually play and, beside them, the decks from
 * YOUR squad that answer that spread — each labelled with the teammate who
 * already pilots it.
 *
 * ── WHY THE SCREEN IS SHAPED LIKE THIS ────────────────────────────────────
 *
 * THE ENTRY IS TWO BOXES AND A VS, because that is the thing being described:
 * one team against another. A single field with a side toggle would have been
 * fewer pixels and would have made the reader hold "which side am I filling in"
 * in their head while pasting sixteen tags.
 *
 * THE RESULT IS FOLDERS, not one long page. Eight opponents each carrying six
 * of their decks and three recommendations is fifty-odd decks — a scroll nobody
 * can navigate. A folder per opponent is the unit the work is actually done in:
 * a coach preparing for a match opens one person at a time.
 *
 * NOTHING IS FETCHED WHILE TYPING. The extractor runs locally on every
 * keystroke so the chips confirm who was understood; the analysis itself is the
 * most expensive call this client makes and is fired by a button. That split is
 * deliberate and is the same mistake the tag search already made once — see the
 * GooeySearch note in the README about one query costing ~180 requests.
 */

function useSquad(text: string): SquadParse {
  return useMemo(() => parseSquad(text), [text]);
}

/** What the server managed to read about a roster member. */
function BasisChip({ member }: { member: TeamMember }) {
  const label =
    member.basis === 'stored'
      ? `${member.battles.toLocaleString()} battles`
      : member.basis === 'live'
        ? 'live log only'
        : 'no history';
  const title =
    member.basis === 'stored'
      ? `Stored history: ${member.battles.toLocaleString()} battles, ${member.decks} decks in this window.`
      : member.basis === 'live'
        ? 'Never tracked before, so this is the last ~25 battles from the Clash Royale API. The tag has been queued — a fuller read appears once it has been collected.'
        : 'Not tracked, and the live battlelog could not be reached for this tag.';
  return (
    <span className={styles.basis} data-basis={member.basis} title={title}>
      {label}
    </span>
  );
}

/** One side's paste box, with the squad it produced shown back underneath. */
function SquadInput({
  side,
  label,
  hint,
  value,
  onChange,
  squad,
  resolved,
}: {
  side: 'blue' | 'red';
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  squad: SquadParse;
  resolved: TeamMember[] | null;
}) {
  const over = squad.members.length > MAX_SQUAD;

  /* AUTO-GROW. Measured off `scrollHeight`, which needs the box reset to `auto`
     first or it can only ever get taller — a shrinking paste would leave the
     field at its high-water mark. Capped so a pasted novel cannot push the
     Analyse button off the screen; past the cap it scrolls itself, which is
     the one place on this screen that is allowed to. */
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [value]);

  return (
    <div className={styles.side} data-side={side}>
      <div className={styles.sideHead}>
        <h3 className={styles.sideTitle}>{label}</h3>
        <span className={styles.sideCount} data-over={over || undefined}>
          {squad.members.length}
          {over ? ` / ${MAX_SQUAD}` : ''}
        </span>
      </div>

      {/* IT GROWS WITH WHAT IS IN IT. A fixed seven rows is a tall empty box
          for the two lines most rosters actually are, and on a laptop that
          dead space was most of the reason the results sat below the fold. */}
      <textarea
        ref={box}
        className={styles.paste}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        spellCheck={false}
        aria-label={label}
        rows={3}
      />

      {/* THE CHIPS ARE THE CONFIRMATION. A roster is pasted in bulk, so the one
          thing a person cannot check by re-reading their own paste is what the
          parser made of it. */}
      {squad.members.length > 0 && (
        <ul className={styles.chips}>
          {squad.members.map((m) => {
            const found = resolved?.find((r) => r.tag === m.tag);
            /* THE SERVER'S NAME ONLY WINS WHEN IT IS A REAL NAME. `_resolve`
               falls back to the tag when neither the database nor the CR
               profile knows one, so preferring it unconditionally printed the
               chip as "#2PP0PYLQ #2PP0PYLQ" and threw away the label the
               person had actually pasted beside the tag. */
            const real = found && found.name !== found.tag ? found.name : null;
            return (
              <li key={m.tag} className={styles.chip} data-basis={found?.basis}>
                <span className={styles.chipName}>{real ?? m.name ?? m.tag}</span>
                <span className={styles.chipTag}>{m.tag}</span>
                {found && <BasisChip member={found} />}
              </li>
            );
          })}
        </ul>
      )}

      {/* Never silently dropped — a squad is pasted, so "one of these is
          malformed" has to name which one or the person proof-reads sixteen. */}
      {squad.rejected.length > 0 && (
        <p className={styles.reject}>
          Not read as a tag: {squad.rejected.map((r) => `"${r}"`).join(', ')}
        </p>
      )}
      {squad.duplicates.length > 0 && (
        <p className={styles.note}>
          Listed twice, counted once: {squad.duplicates.join(', ')}
        </p>
      )}
    </div>
  );
}

export function TeamAnalysis() {
  const [blueText, setBlueText] = useState('');
  const [redText, setRedText] = useState('');
  const [report, setReport] = useState<TeamReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTag, setOpenTag] = useState<string | null>(null);

  const blue = useSquad(blueText);
  const red = useSquad(redText);

  /* THE ANSWER HAS TO COME INTO VIEW. The entry board fills the first screen,
     so a finished analysis landed entirely below the fold and the screen looked
     like it had done nothing. `.page` is this screen's scroll region (see the
     module CSS) — scrolling `window` or `main` here would move the wrong box on
     a desktop, where neither of them is what scrolls. */
  const results = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const revealResults = useCallback(() => {
    // Two frames: the first commits the results, the second can measure them.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const box = scroller.current;
        const target = results.current;
        if (!box || !target) return;
        const top = target.offsetTop - box.offsetTop - 12;
        box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }),
    );
  }, []);

  const problem = squadProblem(blue, red);
  const overlap = overlappingTags(blue, red);

  const run = useCallback(async () => {
    if (problem) return;
    setLoading(true);
    setError(null);
    setOpenTag(null);
    const started = performance.now();
    try {
      const r = await fetchTeamAnalysis(
        blue.members.map((m) => m.tag),
        red.members.map((m) => m.tag),
      );
      setReport(r);
      revealResults();
      // Measured, so the next run's progress bar is paced by this machine's
      // real timing rather than by the seed.
      recordDuration('teams', performance.now() - started);
    } catch (e) {
      setReport(null);
      setError(
        e instanceof AnalyticsError
          ? e.message
          : 'The analysis could not be completed. Try again in a moment.',
      );
    } finally {
      setLoading(false);
    }
  }, [blue.members, red.members, problem, revealResults]);

  /* Opening a folder starts at the folder's top. Without this you land
     mid-way down a board because the gallery you clicked from was scrolled. */
  const openFolder = useCallback((tag: string) => {
    setOpenTag(tag);
    revealResults();
  }, [revealResults]);

  const open: TeamFolder | null = openTag
    ? report?.folders.find((f) => f.player.tag === openTag) ?? null
    : null;

  return (
    <div className={styles.page} ref={scroller}>
      <header className={styles.head}>
        <h2 className={styles.title}>Team Analysis</h2>
        <p className={styles.lede}>
          Paste both rosters — names and tags, or tags on their own. Every opponent gets a folder
          holding the decks they play and the decks your squad should answer them with.
        </p>
      </header>

      <section className={styles.entry}>
        <SquadInput
          side="blue"
          label="Your team"
          hint={'Ravi #Y022GRCJQ\nAditya #2PP0PYLQ\n#L8GVPJ900'}
          value={blueText}
          onChange={setBlueText}
          squad={blue}
          resolved={report?.blue ?? null}
        />

        <div className={styles.vs}>
          <VsMark size="lg" />
        </div>

        <SquadInput
          side="red"
          label="Opponent team"
          hint={'Mohamed Light #Y022GRCJQ\n#2PP0PYLQ'}
          value={redText}
          onChange={setRedText}
          squad={red}
          resolved={report?.red ?? null}
        />
      </section>

      <div className={styles.actions}>
        <button type="button" className={styles.analyze} onClick={run} disabled={!!problem || loading}>
          {loading ? 'Analysing…' : 'Analyse squads'}
        </button>
        {problem && <p className={styles.problem}>{problem}</p>}
        {/* Not an error — a scrim with a shared stand-in is real — but without
            this the folder recommends a player's own deck against themselves,
            which reads as a bug. */}
        {!problem && overlap.length > 0 && (
          <p className={styles.note}>
            {overlap.join(', ')} {overlap.length === 1 ? 'is' : 'are'} on both sides. Their own decks
            can be recommended against them.
          </p>
        )}
      </div>

      {loading && (
        <ReadingState k="teams" hue="pink">
          <p>
            Reading {blue.members.length + red.members.length} players and scoring every deck your
            squad plays against each opponent&apos;s spread.
          </p>
        </ReadingState>
      )}

      {error && !loading && <p className={styles.error}>{error}</p>}

      {report && !loading && (
        <section className={styles.results} ref={results}>
          {/* Named ONCE at the top. Eight identical empty folders do not read as
              "your side has no stored history" — they read as a broken tool. */}
          {report.pool.reason && (
            <p className={styles.warn}>
              {report.pool.reason === 'no_blue_history'
                ? 'Nothing is stored for your side yet, so there are no decks to recommend. Newly added tags are queued for collection and fill in within a couple of hours.'
                : `No deck on your side clears the ${report.pool.minGames}-game floor, so there is nothing anyone has actually piloted to recommend.`}
            </p>
          )}

          {(report.rejected.blue.length > 0 || report.rejected.red.length > 0) && (
            <p className={styles.reject}>
              Refused by the server:{' '}
              {[...report.rejected.blue, ...report.rejected.red].join(', ')}
            </p>
          )}

          {open ? (
            <OpenFolder
              folder={open}
              onBack={() => {
                setOpenTag(null);
                revealResults();
              }}
            />
          ) : (
            <FolderGallery report={report} onOpen={openFolder} />
          )}
        </section>
      )}
    </div>
  );
}
