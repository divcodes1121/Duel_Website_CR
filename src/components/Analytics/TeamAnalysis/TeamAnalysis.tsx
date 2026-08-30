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
import {
  defaultSaveName,
  MAX_SAVES,
  useTeamSaves,
  type SavedTeamAnalysis,
} from '../../../state/teamSaves';
import { ago } from '../../../utils/format';
import { ReportButton } from '../../Export/ReportButton';
import { ReadingState } from '../ReadingState';
import { VsMark } from '../../VsMark/VsMark';
import { FolderGallery, OpenFolder } from './TeamFolders';
import { SavedAnalyses } from './TeamSaves';
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
    el.style.height = `${Math.min(el.scrollHeight, 460)}px`;
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

      {/* IT GROWS WITH WHAT IS IN IT, from a floor that already fits a full
          roster — see the note on `.paste`. `rows` is left at the HTML default
          on purpose: the floor is CSS (`min-height`) so that the inline height
          this effect writes cannot go under it, and a `rows` value would be a
          second, silently-losing declaration of the same thing. */}
      <textarea
        ref={box}
        className={styles.paste}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        spellCheck={false}
        aria-label={label}
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

  /* WHICH SAVE IS ON SCREEN, and it is runtime-only on purpose — the same call
     `activeSavedId` makes in the builder store. It exists so Save can offer
     "Update" instead of silently making a thirteenth copy of one board; it is
     not a property of the analysis, so persisting it would mean a reload
     restores a "you are looking at a saved board" claim with no board. */
  const [savedId, setSavedId] = useState<string | null>(null);
  /* Set only when a board came OUT of storage. `report.days` cannot answer
     this — every report has a window, and only a restored one is stale. */
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const saves = useTeamSaves((s) => s.saves);
  const doSave = useTeamSaves((s) => s.save);

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
    setSaveNote(null);
    /* A FRESH RUN IS NO LONGER THE SAVED BOARD. Leaving `savedId` set would
       point Update at a record whose figures the new run has replaced, and
       leaving `savedAt` set would keep the stale banner over live numbers. */
    setSavedId(null);
    setSavedAt(null);
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

  /* SAVE STORES THE REPORT AND THE PASTE. The report is what you came back
     for; the paste is what lets a stale one be re-run rather than retyped,
     which is the only real answer to a snapshot getting old. */
  const saveCurrent = useCallback(
    (asNew: boolean) => {
      if (!report) return;
      const existing = asNew ? null : saves.find((s) => s.id === savedId) ?? null;
      const result = doSave(
        {
          name: existing?.name ?? defaultSaveName(report),
          blueText,
          redText,
          report,
        },
        existing?.id,
      );
      if (result.ok) {
        setSavedId(result.id);
        /* NOT `savedAt`. What is on screen was measured just now; it becomes a
           snapshot when it is re-opened, not when it is written. */
        setSaveNote(existing ? 'Updated.' : 'Saved. It is in the list above.');
        return;
      }
      setSaveNote(
        result.reason === 'full'
          ? `You already have ${MAX_SAVES} saved analyses. Delete one to keep this.`
          : result.reason === 'too-large'
            ? 'This board is too large to store in the browser. Narrow the rosters and run it again.'
            : 'The browser refused to store it — its storage may be full or blocked.',
      );
    },
    [report, saves, savedId, blueText, redText, doSave],
  );

  /* OPENING A SAVE RESTORES THE BOXES TOO, so the next thing a person is
     likely to want — the same match-up, re-run against today's window — is one
     click away rather than a re-paste. */
  const openSave = useCallback(
    (save: SavedTeamAnalysis) => {
      setBlueText(save.blueText);
      setRedText(save.redText);
      setReport(save.report);
      setSavedId(save.id);
      setSavedAt(save.savedAt);
      setOpenTag(null);
      setError(null);
      setSaveNote(null);
      revealResults();
    },
    [revealResults],
  );

  const open: TeamFolder | null = openTag
    ? report?.folders.find((f) => f.player.tag === openTag) ?? null
    : null;

  /* THE TWO CAPS CAN DISAGREE, AND ONLY ONE OF THEM SAYS SO.
   *
   * `MAX_SQUAD` lives in two files — here and `server/team_analysis.py` — and
   * they enforce it differently: this side REFUSES a roster over the cap, the
   * server SLICES one (`blue_tags[:MAX_SQUAD]`). That asymmetry is harmless
   * while the numbers match and dangerous the moment they do not, because the
   * dropped tags are not in `rejected`, are not in `folders`, and produce a
   * report that looks exactly as complete as a full one.
   *
   * They CAN drift, because the two halves ship separately: Vercel deploys
   * this from `main` in a minute or two and the Python service is copied to
   * the VPS by hand. Between those two events a raised cap here is a lowered
   * cap there. So the report's own `limits.maxSquad` is checked against this
   * file's — the server publishes it, and this is what that field is for. */
  const serverCap = report?.limits?.maxSquad ?? MAX_SQUAD;
  const capSkew =
    !!report &&
    serverCap < MAX_SQUAD &&
    (report.blue.length >= serverCap || report.red.length >= serverCap);

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

      <SavedAnalyses openId={savedId} onOpen={openSave} />

      <div className={styles.actions}>
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.analyze}
            onClick={run}
            disabled={!!problem || loading}
          >
            {loading ? 'Analysing…' : savedAt ? 'Re-run against today' : 'Analyse squads'}
          </button>

          {/* SAVE APPEARS ONLY WITH SOMETHING TO SAVE. A disabled Save beside
              an empty screen is a control that has never once been usable at
              the moment it is read. */}
          {report && !loading && (
            <>
              <button type="button" className={styles.save} onClick={() => saveCurrent(false)}>
                {savedId ? 'Update saved' : 'Save analysis'}
              </button>
              {/* The second button exists only once the first has an "update"
                  meaning — otherwise the two would do the same thing under two
                  names, which is how a person learns to distrust both. */}
              {savedId && (
                <button type="button" className={styles.save} onClick={() => saveCurrent(true)}>
                  Save as new
                </button>
              )}

              {/* A THUNK, not a built document — the same contract every other
                  analytics screen's export uses. It keeps the adapter off the
                  render path (nobody who never exports pays to build a
                  forty-page model on every keystroke) and it guarantees the
                  PDF describes the report as it is at the moment of the click,
                  including a restored save's own age. */}
              <ReportButton
                build={async () =>
                  (await import('../../../utils/teamReport')).teamAnalysisReport(report, {
                    savedAt,
                  })
                }
                label="Export PDF"
              />
            </>
          )}
        </div>

        {saveNote && <p className={styles.note}>{saveNote}</p>}
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
          {/* A RESTORED BOARD SAYS WHAT IT IS, EVERY TIME. Every figure below
              was measured over a window that closed when the analysis ran —
              the opponent's spread, the win rates, which of your decks cleared
              the comfort floor. None of it has been recomputed. Showing it
              without this line presents a fortnight-old read as the current
              one, which is the single way this feature could mislead. */}
          {savedAt && (
            <p className={styles.snapshot}>
              Saved {ago(savedAt)} — these are the figures as they were then, not as they are now.
              Use <strong>Re-run against today</strong> to measure the same squads again.
            </p>
          )}

          {/* Named ONCE at the top. Eight identical empty folders do not read as
              "your side has no stored history" — they read as a broken tool. */}
          {report.pool.reason && (
            <p className={styles.warn}>
              {report.pool.reason === 'no_blue_history'
                ? 'Nothing is stored for your side yet, so there are no decks to recommend. Newly added tags are queued for collection and fill in within a couple of hours.'
                : `No deck on your side clears the ${report.pool.minGames}-game floor, so there is nothing anyone has actually piloted to recommend.`}
            </p>
          )}

          {/* Named ABOVE the folders, because it is a statement about which
              folders exist rather than about anything inside one. */}
          {capSkew && (
            <p className={styles.warn}>
              The analytics service is still enforcing a limit of {serverCap} players a side, so
              this report covers only the first {serverCap} of each roster — anyone past that was
              dropped without being listed. Deploying the current{' '}
              <code>server/team_analysis.py</code> to the API host lifts it to {MAX_SQUAD}.
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
