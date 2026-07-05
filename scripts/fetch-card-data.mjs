// Dev-time convenience script to refresh the vendored card data snapshot.
// The shipped app never calls this — it only reads src/data/cards.json at build time.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCE_URL = 'https://royaleapi.github.io/cr-api-data/json/cards.json';
const OUT_PATH = fileURLToPath(new URL('../src/data/cards.json', import.meta.url));

const res = await fetch(SOURCE_URL);
if (!res.ok) {
  throw new Error(`Failed to fetch card data: ${res.status} ${res.statusText}`);
}
const cards = await res.json();

await writeFile(OUT_PATH, JSON.stringify(cards, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${cards.length} cards to ${path.relative(process.cwd(), OUT_PATH)}`);
