# Field book plate art

**This directory is BUILT. Do not hand-edit it.**

Put the master PNG in `assets/guide/` and run:

```
python scripts/build-guide-art.py
```

which re-encodes to WebP here. The masters are 3.2-3.9 MB each; the served
files are ~420 kB, and the four together went 13.5 MB -> 1.7 MB. Dropping a raw
PNG straight in here would work and would make this page the heaviest thing the
site serves by an order of magnitude.

**The filename is the whole wiring** — no manifest to update, no import to add.
`ArtSlot` asks for `<file>.webp`; until it exists the plate draws a ruled frame
carrying its own brief, so the book is complete, turnable and readable before
any of these arrive.

## The six slots — all supplied

Every slot is filled. The two late ones were re-briefed to the pictures that
actually arrived rather than the other way round: `the-workshop` was specified
as a bench and came back as a book of recipes, which is the better idea, and
`the-gate` was specified as a two-arched gatehouse and came back as the arena
under mountains of gold — so the slot was **renamed `the-treasury`**. A caption
claiming a gate nobody painted would have been the one dishonest thing in a book
whose last plate is about not printing claims you cannot stand behind.


| file | plate | subject | state |
|---|---|---|---|
| `cover-arena` | I — Cover | King, knight and archer on a headland over the river, ships below, the far keep | **supplied** |
| `the-village` | II — What it is | Pagodas on separate cliffs joined by rope bridges, at sunset | **supplied** |
| `the-workshop` | III — The three tools | An open spellbook among candles, phials and a bubbling pot — recipe pages | **supplied** |
| `the-duel` | IV — How a duel works | A duel in a bamboo grove over a lily pond, one fighter launched through the air | **supplied** |
| `the-treasury` | VII — Member and Pro | The arena from above, towers and troops mid-battle, ringed by heaped gold and gems | **supplied** |
| `the-archive` | VIII — Where the numbers come from | A shrine over a still pond, stone stair behind the gate, lanterns and crystals | **supplied** |

Plates V (the nine areas), VI (the access table) and IX (refusals) take **no art
on purpose** — a list, a table and an argument, each wanting the whole spread. A
picture there would compete with the thing the reader came to read.

## What the drawings need to be

Splashed **full-colour watercolour on white paper**, matching the four already
supplied: saturated pigment, wet blooms, spatter running off the edges, a bright
sky. Not sepia and not line art.

- **On white or cream paper, never transparent.** The slot composites with
  `mix-blend-mode: multiply`, so the sheet's own tone comes up through the white
  of the paper and the spatter edges melt into the page instead of sitting on it
  as a rectangle. Multiply over transparency does nothing, and a cut-out floats.
- **Landscape, roughly 3:2.** The cover wants nearer 2:1 — it crosses the gutter.
- **About 2000px on the long edge.** The magnifier shows the page at 2.25×, and
  that is the one place on this page a reader is deliberately looking closely.
- **Plain sRGB, no ICC profile.** Same rule as the card art: an embedded lcms
  profile made colours wash out on wide-gamut phones.
- **Keep the subject off the centre line on the cover.** The fold's shadow falls
  down the middle of a spread plate, and a face or a tower centred there gets
  swallowed by it.
