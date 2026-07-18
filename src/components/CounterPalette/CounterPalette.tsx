import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { DuelDeckSet } from '../../types/deck';
import { useBuilderStore } from '../../state/store';
import { useThemeStore } from '../../state/themeStore';
import { DeckPanel } from '../DuelDeckBuilder/DeckPanel';
import { CardPickerDrawer } from '../CardPicker/CardPickerDrawer';
import { FlightLayer } from '../FlightLayer/FlightLayer';
import { ProfileMenu } from '../Profile/ProfileMenu';
import { WinConFilter, deckMatchesFilter, filterCardName } from '../WinConFilter/WinConFilter';
import libStyles from '../Library/Library.module.css';
import homeStyles from '../DecksHome/DecksHome.module.css';
import styles from './CounterPalette.module.css';

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
    <section className={homeStyles.deckList}>
      <h2 className={homeStyles.galleryTitle}>
        Archetype Folders
        <span className={homeStyles.galleryCount}>{folders.length}</span>
      </h2>

      {folders.length === 0 && (
        <p className={styles.emptyHint}>
          Segregate your decks by archetype — Beatdown, Cycle, Bait, Siege — or by what they
          counter. Create a folder and fill it with as many decks as you like.
        </p>
      )}

      <div className={styles.folderGrid}>
        {folders.map((folder, i) => (
          <motion.div
            key={folder.id}
            className={styles.folderCard}
            initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ type: 'spring', stiffness: 240, damping: 26, delay: Math.min(i, 6) * 0.04 }}
          >
            <button
              type="button"
              className={styles.folderBody}
              onClick={() => openPaletteFolder(folder.id)}
              title={`Open "${folder.name}"`}
            >
              <span className={styles.folderIcon}>
                <PaletteIcon size={22} />
              </span>
              {renamingId === folder.id ? (
                <input
                  className={styles.renameInput}
                  value={renameDraft}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(folder.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(folder.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <span className={styles.folderName}>{folder.name}</span>
              )}
              <span className={styles.folderMeta}>
                {folder.decks.length} deck{folder.decks.length === 1 ? '' : 's'}
              </span>
            </button>
            <div className={styles.folderActions}>
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
            </div>
          </motion.div>
        ))}

        <motion.button
          type="button"
          className={styles.addFolder}
          onClick={addPaletteFolder}
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          <span className={homeStyles.addDeckPlus}>+</span>
          New folder
        </motion.button>
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

  return (
    <section className={homeStyles.deckList}>
      <div className={styles.folderViewHeader}>
        <button type="button" className={libStyles.ghostButton} onClick={closePaletteFolder}>
          ← All folders
        </button>
      </div>

      <h2 className={homeStyles.galleryTitle}>
        {editingName ? (
          <input
            className={styles.titleInput}
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
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
          {winFilter.length > 0 ? `${visibleDecks.length} / ${folder.decks.length}` : folder.decks.length}
        </span>
      </h2>

      <WinConFilter selected={winFilter} onToggle={toggleWinCon} onClear={() => setWinFilter([])} />

      {visibleDecks.map(({ deck, index }, i) => (
        <motion.div
          key={deck.id}
          initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ type: 'spring', stiffness: 240, damping: 26, delay: Math.min(i, 4) * 0.05 }}
        >
          <DeckPanel
            owner="palette"
            deckIndex={index}
            deck={deck}
            onDelete={() => handleDeleteDeck(index)}
          />
        </motion.div>
      ))}

      {winFilter.length > 0 && visibleDecks.length === 0 && (
        <motion.p
          className={homeStyles.noMatches}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          No decks with {winFilter.map(filterCardName).join(' + ')} yet.
        </motion.p>
      )}

      {winFilter.length === 0 && (
        <motion.button
          type="button"
          className={homeStyles.addDeck}
          onClick={addPaletteDeck}
          whileHover={{ scale: 1.01, y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          <span className={homeStyles.addDeckPlus}>+</span>
          Add deck
        </motion.button>
      )}
    </section>
  );
}

export function CounterPalette() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
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
          <button
            type="button"
            className={homeStyles.themeButton}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          <ProfileMenu triggerClassName={homeStyles.themeButton} />
        </div>
      </header>

      <div className={homeStyles.scrollArea}>
        {activeFolder ? <FolderView key={activeFolder.id} folder={activeFolder} /> : <FolderGallery />}
      </div>

      {/* The gallery has no deck to add cards to — the picker only makes sense inside a folder. */}
      {activeFolder && (
        <>
          <CardPickerDrawer />
          <FlightLayer />
        </>
      )}
    </div>
  );
}
