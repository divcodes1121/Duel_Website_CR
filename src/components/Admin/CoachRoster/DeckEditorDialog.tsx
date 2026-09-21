import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

import { CARDS, CARDS_BY_KEY, getCardIconUrl } from '../../../data/cards';
import {
  ARCHETYPE_MAX,
  ARSENAL_DECK_SIZE,
  ArsenalError,
  COMFORT_MAX,
  DECK_NAME_MAX,
  DECK_NOTES_MAX,
  TAGS_MAX,
  TAG_SUGGESTIONS,
  averageElixir,
  deckProblem,
  parseClashRoyaleDeckLink,
  type ArsenalDeck,
  type ArsenalSource,
} from '../../../state/coachArsenal';
import { useCoachArsenal } from '../../../state/coachArsenalStore';
import { positionalArt, seatDeck } from '../../../utils/deckSeating';
import { filterCards, type CardTypeFilter } from '../../../utils/filter';
import { sortCards } from '../../../utils/sort';
import { CardArt } from '../../Analytics/CardArt';
import { CardTile } from '../../CardPicker/CardTile';
import { Dropdown } from '../../ui/dropdown-menu-14';
import styles from './CoachRoster.module.css';

/**
 * Build or edit ONE arsenal deck.
 *
 * IT DOES NOT USE THE BUILDER'S CARD LIBRARY, and that is deliberate rather
 * than duplication. `CardLibrary`, `CardGrid`, `useFilteredCards` and
 * `CardFilterTabs` all read AND WRITE `useBuilderStore` — `selectedSlot`,
 * `sets`, `assignCard`. Mounting them here would make editing a coaching deck
 * mutate the account's own saved duel decks, which persist and sync across
 * devices. What is reused is everything underneath that coupling: `CardTile`,
 * the pure `filterCards` / `sortCards`, the catalogue itself, the deck-link
 * parser and the card art. The eight slots live in local state and go nowhere
 * near the builder.
 *
 * THREE WAYS IN, ONE RECORD OF WHICH. Cards can be clicked in, pasted as a
 * Clash Royale deck link, or carried in from a deck the player has actually
 * played — and `source` keeps that distinction, because phases 4 and 5 must
 * never confuse a coach's choice with an engine's suggestion.
 *
 * Portalled to <body>, like every dialog here: a `backdrop-filter` ancestor
 * would otherwise trap it.
 */

const TYPE_TABS: { value: CardTypeFilter; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'Troop', label: 'Troops' },
  { value: 'Spell', label: 'Spells' },
  { value: 'Building', label: 'Buildings' },
  { value: 'WinCondition', label: 'Win cons' },
  { value: 'Champion', label: 'Champions' },
];

export function DeckEditorDialog({
  playerId,
  deck,
  initialCards,
  initialSource = 'manual',
  initialSourceRef = null,
  initialName,
  onClose,
}: {
  playerId: string;
  /** Present when editing; absent when adding. */
  deck?: ArsenalDeck;
  initialCards?: string[];
  initialSource?: ArsenalSource;
  initialSourceRef?: unknown;
  initialName?: string;
  onClose: () => void;
}) {
  const add = useCoachArsenal((s) => s.add);
  const update = useCoachArsenal((s) => s.update);

  const [cards, setCards] = useState<string[]>(deck?.cards ?? initialCards ?? []);
  /* WHETHER THE ORDER IS ALREADY THE GAME'S. A pasted link, a suggestion and
     a deck taken from their battles all arrive seated — evolution, hero, wild
     first — and are kept exactly as they are. Cards clicked in by hand arrive
     in the order they were clicked, which says nothing about slots, so a
     hand-built deck is seated by the site's slot rule the moment it is whole.
     Without that a coach's deck saved with a champion in slot 6 and no
     evolution frame, and "Open in Game" handed the game that order. */
  const [trusted, setTrusted] = useState(!!(deck?.cards?.length || initialCards?.length));
  const [name, setName] = useState(deck?.name ?? initialName ?? '');
  const [archetype, setArchetype] = useState(deck?.archetype ?? '');
  const [comfort, setComfort] = useState<number | null>(deck?.comfort ?? null);
  const [tags, setTags] = useState<string[]>(deck?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [notes, setNotes] = useState(deck?.notes ?? '');
  const [link, setLink] = useState('');
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [type, setType] = useState<CardTypeFilter>('All');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = useMemo(
    () => sortCards(filterCards(CARDS, { type, search, elixir: 'all', rarity: 'all' }), 'rarity', 'asc'),
    [type, search],
  );

  const inDeck = useMemo(() => new Set(cards), [cards]);
  const seated = useMemo(
    () => (!trusted && cards.length === ARSENAL_DECK_SIZE ? seatDeck(cards).cards : cards),
    [cards, trusted],
  );
  const slotArt = useMemo(() => positionalArt(seated), [seated]);
  const problem = deckProblem(cards);
  const elixir = averageElixir(cards);
  const full = cards.length >= ARSENAL_DECK_SIZE;

  function toggleCard(key: string) {
    setError(null);
    setTrusted(false);
    setCards((c) => (c.includes(key) ? c.filter((x) => x !== key) : c.length >= ARSENAL_DECK_SIZE ? c : [...c, key]));
  }

  function readLink(text: string) {
    setLink(text);
    if (!text.trim()) {
      setLinkNote(null);
      return;
    }
    const keys = parseClashRoyaleDeckLink(text);
    if (!keys) {
      // Said at the paste, not at Submit: a link that names a card this build
      // has not been told about reads exactly like a typo otherwise.
      setLinkNote('That is not a Clash Royale deck link this build can read (eight known cards).');
      return;
    }
    setCards(keys);
    setTrusted(true);
    setLinkNote(`Read eight cards from the link${initialSource === 'history' ? '' : ' — source recorded as a link'}.`);
    setError(null);
  }

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setTagDraft('');
      return;
    }
    if (tags.length >= TAGS_MAX) {
      setError(`A deck can carry at most ${TAGS_MAX} tags.`);
      return;
    }
    setTags((x) => [...x, t]);
    setTagDraft('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (deck) {
        await update(playerId, deck.id, {
          cards: seated,
          name: name.trim() || null,
          archetype: archetype.trim() || null,
          comfort,
          tags,
          notes: notes.trim() || null,
        });
      } else {
        await add(playerId, {
          cards: seated,
          name: name.trim() || null,
          archetype: archetype.trim() || null,
          comfort,
          tags,
          notes: notes.trim() || null,
          // A pasted link wins over the button that opened the dialog: it is
          // the more specific truth about where these eight cards came from.
          source: linkNote && link.trim() ? 'link' : initialSource,
          sourceRef: initialSourceRef,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof ArsenalError ? err.message : 'Could not save that deck.');
      setBusy(false);
    }
  }

  return createPortal(
    <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={`${styles.dialog} ${styles.editorDialog}`} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="deck-editor-title">
        <h2 className={styles.dialogTitle} id="deck-editor-title">
          {deck ? 'Edit deck' : 'Add a deck to the arsenal'}
        </h2>

        {/* The eight slots. A slot is a button that takes its card back out —
            the same gesture as putting one in, rather than a second control. */}
        <div className={styles.slotRow}>
          {Array.from({ length: ARSENAL_DECK_SIZE }, (_, i) => {
            const key = seated[i];
            const card = key ? CARDS_BY_KEY.get(key) : undefined;
            return (
              <button
                key={i}
                type="button"
                className={styles.slot}
                data-filled={key ? true : undefined}
                disabled={!key}
                title={card ? `Remove ${card.name}` : 'Empty slot'}
                aria-label={card ? `Remove ${card.name}` : `Empty slot ${i + 1}`}
                onClick={() => key && toggleCard(key)}
              >
                {key ? <CardArt card={key} variant={slotArt[key]} /> : <span aria-hidden>+</span>}
              </button>
            );
          })}
        </div>
        <p className={styles.slotNote}>
          {problem ? problem : `Eight cards · average elixir ${elixir?.toFixed(1) ?? '—'}`}
        </p>

        <div className={styles.editorGrid}>
          <div className={styles.editorFields}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Deck name</span>
              <input
                ref={nameRef}
                className={styles.input}
                value={name}
                maxLength={DECK_NAME_MAX}
                placeholder="What the player calls it"
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Archetype</span>
              <input
                className={styles.input}
                value={archetype}
                maxLength={ARCHETYPE_MAX}
                placeholder="Hog cycle, Golem beatdown…"
                onChange={(e) => setArchetype(e.target.value)}
              />
            </label>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Comfort</span>
              <div className={styles.stars} role="group" aria-label="Comfort, 1 to 5 stars">
                {Array.from({ length: COMFORT_MAX }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={styles.star}
                    aria-pressed={comfort !== null && comfort >= n}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    // Pressing the current rating clears it: unrated is a real
                    // answer, and without this the first tap is permanent.
                    onClick={() => setComfort(comfort === n ? null : n)}
                  >
                    ★
                  </button>
                ))}
                <span className={styles.muted}>{comfort === null ? 'not rated' : `${comfort} of ${COMFORT_MAX}`}</span>
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Tags</span>
              <div className={styles.tagRow}>
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={styles.tagChip}
                    data-on
                    title={`Remove ${t}`}
                    onClick={() => setTags((x) => x.filter((y) => y !== t))}
                  >
                    {t} ×
                  </button>
                ))}
              </div>
              <div className={styles.tagAdd}>
                <input
                  className={styles.input}
                  value={tagDraft}
                  placeholder="Add a tag"
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      // Enter in a text field inside a form submits it; a tag
                      // is not the form.
                      e.preventDefault();
                      addTag(tagDraft);
                    }
                  }}
                />
                <button type="button" className={styles.ghostButton} onClick={() => addTag(tagDraft)}>
                  Add
                </button>
              </div>
              <div className={styles.tagRow}>
                {TAG_SUGGESTIONS.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase())).map((t) => (
                  <button key={t} type="button" className={styles.tagChip} onClick={() => addTag(t)}>
                    + {t}
                  </button>
                ))}
              </div>
            </div>

            {!deck && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Or paste a deck link</span>
                <input
                  className={styles.input}
                  value={link}
                  placeholder="https://link.clashroyale.com/deck/…"
                  onChange={(e) => readLink(e.target.value)}
                />
                {linkNote && <span className={styles.hint}>{linkNote}</span>}
              </label>
            )}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Coach notes</span>
              <textarea
                className={styles.textarea}
                value={notes}
                maxLength={DECK_NOTES_MAX}
                rows={3}
                placeholder="When to bring it, what it loses to…"
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>

          <div className={styles.editorPicker}>
            <div className={styles.pickerHead}>
              <input
                className={styles.input}
                value={search}
                placeholder={`Search ${CARDS.length} cards`}
                aria-label="Search cards"
                onChange={(e) => setSearch(e.target.value)}
              />
              <Dropdown
                className={styles.pickerType}
                size="sm"
                value={type}
                onChange={(v) => setType(v)}
                options={TYPE_TABS.map((t) => ({ value: t.value, label: t.label }))}
                caption="Card type"
              />
            </div>
            <div className={styles.pickerGrid}>
              {shown.map((card) => (
                <CardTile
                  key={card.key}
                  card={card}
                  iconSrc={getCardIconUrl(card.key)}
                  state={inDeck.has(card.key) ? 'selected' : full ? 'inactive' : 'available'}
                  disabledReason={full && !inDeck.has(card.key) ? 'The deck already holds eight cards' : undefined}
                  onClick={() => toggleCard(card.key)}
                />
              ))}
            </div>
          </div>
        </div>

        {error && <p className={styles.formError}>{error}</p>}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryButton} disabled={busy || problem !== null}>
            {busy ? 'Saving…' : deck ? 'Save changes' : 'Add to arsenal'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
