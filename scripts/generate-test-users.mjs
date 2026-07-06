// One-off generator for the 20 test accounts.
// Writes src/data/users.json (sha256 hashes only — safe to bundle) and
// TEST_ACCOUNTS.md (plaintext — for the site owner to distribute privately).
import { createHash, randomInt } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const WORDS = [
  'knight', 'archer', 'goblin', 'dragon', 'sparky', 'miner', 'royal', 'golem',
  'bandit', 'hunter', 'wizard', 'prince', 'barrel', 'cannon', 'phoenix', 'valkyrie',
  'hound', 'titan', 'mortar', 'crown',
];

const users = [];
const lines = [
  '# Royal Arena — Test Accounts',
  '',
  '> Private list for the site owner. Hand these out individually to testers.',
  '> Do NOT publish this file on the deployed site or a public repo.',
  '',
  '| # | Username | Password |',
  '|---|----------|----------|',
];

for (let i = 1; i <= 20; i++) {
  const username = `royal${String(i).padStart(2, '0')}`;
  const password = `${WORDS[i - 1]}-${randomInt(1000, 9999)}`;
  const hash = createHash('sha256').update(`${username}:${password}`).digest('hex');
  users.push({ username, hash });
  lines.push(`| ${i} | \`${username}\` | \`${password}\` |`);
}

const root = new URL('..', import.meta.url);
await writeFile(fileURLToPath(new URL('src/data/users.json', root)), JSON.stringify(users, null, 2) + '\n');
await writeFile(fileURLToPath(new URL('TEST_ACCOUNTS.md', root)), lines.join('\n') + '\n');
console.log('Wrote src/data/users.json (hashes) and TEST_ACCOUNTS.md (plaintext) — 20 accounts.');
