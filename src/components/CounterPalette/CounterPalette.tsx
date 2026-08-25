import { useEffect, useState } from 'react';
import type { DuelDeckSet } from '../../types/deck';
import { useBuilderStore } from '../../state/store';
import { DeckPanel } from '../DuelDeckBuilder/DeckPanel';
import { DeckWorkspace } from '../DeckWorkspace/DeckWorkspace';
import { ProfileMenu } from '../Profile/ProfileMenu';
import { WinConFilter, deckMatchesFilter, filterCardName } from '../WinConFilter/WinConFilter';
import { DeckOrbit } from '../../three/DeckOrbit';
import libStyles from '../Library/Library.module.css';
import homeStyles from '../DecksHome/DecksHome.module.css';
import styles from './CounterPalette.module.css';
import { ThemeToggle } from '../Theme/ThemeToggle';
import { Filmstrip } from '../Filmstrip/Filmstrip';
import { previewIconFor } from '../../utils/deckPreview';

function PaletteIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  );
}

function folderHasCards(folder: DuelDeckSet): boolean {
  return folder.decks.some((d) => d.slots.some((k) => k !== null));
}

/** Folder gallery: one card per archetype folder, click to open. */
function FolderGallery() {
  const folders = useBuilderStore((s) => s.paletteFolders);
  const addPaletteFolder = useBuilderStore((s) => s.addPaletteFolder);
  const openPaletteFolder = useBuilderStore((s) => s.openPaletteFolder);
  const renamePaletteFolder = useBuilderStore((s) => s.renamePaletteFolder);
  const deletePaletteFolder = useBuilderStore((s) => s.deletePaletteFolder);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  function commitRename(id: string) {
    renamePaletteFolder(id, renameDraft);
    setRenamingId(null);
  }

  function handleDelete(folder: DuelDeckSet) {
    const filled = folder.decks.length;
    if (
      folderHasCards(folder) &&
      !window.confirm(`Delete "${folder.name}" and its ${filled} deck${filled === 1 ? '' : 's'}?`)
    ) {
      return;
    }
    deletePaletteFolder(folder.id);
  }

  return (
    <section className={styles.galleryList}>
      <h2 className={homeStyles.galleryTitle}>
        Archetype Folders
        <span className={homeStyles.galleryCount}>{folders.length}</span>
      </h2>

      {folders.length === 0 && (
        /* The one genuinely blank screen in the app: no folders, one paragraph,
           and nothing else. The ring gives the invitation a subject. Blue is
           Counter Hub's own identity hue, the same one its tool panel and its
           top-nav entry wear. Five cards rather than eight — this is inviting a
           FOLDER, not a deck, so a full eight-card deck would be the wrong
           promise. */
        <div className={styles.emptyState}>
          <DeckOrbit hue="blue" count={5} />
          <p className={styles.emptyHint}>
            Segregate your decks by archetype — Beatdown, Cycle, Bait, Siege — or by what they
            counter. Create a folder and fill it with as many decks as you like.
          </p>
        </div>
      )}

      <div className={styles.folderGrid}>
      {/* THE FOLDER GALLERY IS A FILMSTRIP.
          Each folder is a card showing the first four decks it holds, so the
          thing you are choosing between is visible rather than a name and a
          count. Rename and Delete moved to the strip's `actions` slot, which
          renders them under the CENTRED folder only — they cannot live inside
          the card, because the card is a button and a button may not contain
          buttons. */}
      <Filmstrip
        label="Counter folders"
        hue="blue"
        items={folders.map((folder, i) => ({
          key: folder.id,
          index: i + 1,
          title: folder.name,
          subtitle: `${folder.decks.length} deck${folder.decks.length === 1 ? '' : 's'}`,
          media: <FolderPreview folder={folder} />,
          onOpen: () => openPaletteFolder(folder.id),
          actions:
            renamingId === folder.id ? (
              <input
                className={styles.renameInput}
                value={renameDraft}
                autoFocus
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => commitRename(folder.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(folder.id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  className={styles.folderAction}
                  onClick={() => {
                    setRenameDraft(folder.name);
                    setRenamingId(folder.id);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className={`${styles.folderAction} ${styles.folderActionDanger}`}
                  onClick={() => handleDelete(folder)}
                >
                  Delete
                </button>
              </>
            ),
        }))}
      />

        <button type="button" className={styles.addFolder} onClick={addPaletteFolder}>
          <span className={homeStyles.addDeckPlus}>+</span>
          New folder
        </button>
      </div>
    </section>
  );
}

/** Inside a folder: editable title + an open-ended deck list, like Deck's Home. */
function FolderView({ folder }: { folder: DuelDeckSet }) {
  const closePaletteFolder = useBuilderStore((s) => s.closePaletteFolder);
  const renamePaletteFolder = useBuilderStore((s) => s.renamePaletteFolder);
  const addPaletteDeck = useBuilderStore((s) => s.addPaletteDeck);
  const removePaletteDeck = useBuilderStore((s) => s.removePaletteDeck);
  const [winFilter, setWinFilter] = useState<string[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);

  function commitRename() {
    renamePaletteFolder(folder.id, draftName);
    setEditingName(false);
  }

  function toggleWinCon(key: string) {
    setWinFilter((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  // Multi-select is an AND: a deck must hold every selected card.
  const visibleDecks = folder.decks
    .map((deck, index) => ({ deck, index }))
    .filter(({ deck }) => deckMatchesFilter(deck.slots, winFilter));

  function handleDeleteDeck(deckIndex: number) {
    const deck = folder.decks[deckIndex];
    const hasCards = deck.slots.some((k) => k !== null);
    if (hasCards && !window.confirm(`Delete "${deck.name}"? Its cards will be lost.`)) {
      return;
    }
    removePaletteDeck(deckIndex);
  }

  const toolbar = (
    <>
      <button type="button" className={libStyles.ghostButton} onClick={closePaletteFolder}>
        ← All folders
      </button>

      <h2 className={homeStyles.galleryTitle}>
        {editingName ? (
          <input
            className={styles.titleInput}
            value={draftName}
            autoFocus
            aria-label="Folder name"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDraftName(folder.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={styles.titleButton}
            title="Rename folder"
            onClick={() => {
              setDraftName(folder.name);
              setEditingName(true);
            }}
          >
            {folder.name}
            <span className={styles.editHint}>
              <PencilIcon />
            </span>
          </button>
        )}
        <span className={homeStyles.galleryCount}>
          {winFilter.length > 0
            ? `${visibleDecks.length} / ${folder.decks.length}`
            : folder.decks.length}
        </span>
      </h2>

      <div className={homeStyles.filterSlot}>
        <WinConFilter selected={winFilter} onToggle={toggleWinCon} onClear={() => setWinFilter([])} />
      </div>
    </>
  );

  return (
    <DeckWorkspace toolbar={toolbar}>
      <div className={homeStyles.deckGrid}>
        {visibleDecks.map(({ deck, index }) => (
          <DeckPanel
            key={deck.id}
            owner="palette"
            deckIndex={index}
            deck={deck}
            onDelete={() => handleDeleteDeck(index)}
          />
        ))}

        {winFilter.length === 0 && (
          <button type="button" className={homeStyles.addDeck} onClick={addPaletteDeck}>
            <span className={homeStyles.addDeckPlus}>+</span>
            Add deck
          </button>
        )}
      </div>

      {winFilter.length > 0 && visibleDecks.length === 0 && (
        <p className={homeStyles.noMatches}>
          No decks with {winFilter.map(filterCardName).join(' + ')} yet.
        </p>
      )}
    </DeckWorkspace>
  );
}

/** `embedded` renders without the page nav — the dashboard shell provides it. */
/** A folder's face in the filmstrip: one icon per deck it holds, up to four.
 *
 *  It uses the SAME art selection the live slots use, through the deck's own
 *  first filled slot, so a folder's face matches what is inside it rather than
 *  being a generic glyph. An empty folder keeps the palette mark. */
function FolderPreview({ folder }: { folder: DuelDeckSet }) {
  /* THE FIRST FILLED SLOT OF EACH DECK, WITH ITS REAL ART.
     This asked `getCardIconUrl` directly at first, which draws the BASE card —
     so a folder holding an evolution or a hero deck showed the plain version,
     which is the one thing a preview must not do. `previewIconFor` makes the
     same choice the live slots make. */
  const faces = folder.decks
    .map((deck) => {
      const i = deck.slots.findIndex((k) => k !== null);
      const key = i >= 0 ? deck.slots[i] : null;
      return key ? { key: `${key}-${i}`, src: previewIconFor(deck, i, key) } : null;
    })
    .filter((f): f is { key: string; src: string } => f !== null)
    .slice(0, 4);

  if (faces.length === 0) {
    return (
      <span className={styles.folderEmptyFace}>
        <PaletteIcon size={26} />
      </span>
    );
  }
  return (
    <>
      {faces.map((f) => (
        <img key={f.key} src={f.src} alt="" draggable={false} />
      ))}
    </>
  );
}

export function CounterPalette({ embedded = false }: { embedded?: boolean } = {}) {
  const folders = useBuilderStore((s) => s.paletteFolders);
  const activeId = useBuilderStore((s) => s.activePaletteFolderId);
  const clearSelection = useBuilderStore((s) => s.clearSelection);
  const activeFolder = activeId ? folders.find((f) => f.id === activeId) ?? null : null;

  // Selections made on other pages must not leak into this picker context.
  useEffect(() => {
    clearSelection();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') clearSelection();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection]);

  return (
    <div className={homeStyles.page}>
      {!embedded && (
      <header className={homeStyles.nav}>
        <button
          type="button"
          className={homeStyles.brand}
          onClick={() => {
            window.location.hash = '';
          }}
          title="Back to Royal Arena"
        >
          <span className={homeStyles.logoMark}>
            <PaletteIcon />
          </span>
          <div className={homeStyles.brandText}>
            <h1 className={homeStyles.title}>Counter Palette</h1>
            <span className={homeStyles.subtitle}>Archetype Deck Folders</span>
          </div>
        </button>
        <div className={homeStyles.navActions}>
          <span className={homeStyles.autoSaveHint}>Folders save automatically</span>
          <button
            type="button"
            className={libStyles.ghostButton}
            onClick={() => {
              window.location.hash = '#/builder';
            }}
          >
            Royal Duels →
          </button>
          <button
            type="button"
            className={libStyles.ghostButton}
            onClick={() => {
              window.location.hash = '#/decks';
            }}
          >
            Deck&apos;s Home →
          </button>
          <ThemeToggle size="1.8rem" />
          <ProfileMenu triggerClassName={homeStyles.themeButton} />
        </div>
      </header>
      )}

      {/* A folder is a deck screen, so it gets the shared workspace and the card
          library beside it. The gallery is not — there is no deck open to put a
          card into — so it stays a single scrolling column. */}
      {activeFolder ? (
        <FolderView key={activeFolder.id} folder={activeFolder} />
      ) : (
        <div className={styles.galleryScroll}>
          <FolderGallery />
        </div>
      )}
    </div>
  );
}
