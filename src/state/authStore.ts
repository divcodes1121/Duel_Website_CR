import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import usersRaw from '../data/users.json';

interface TestUser {
  username: string;
  hash: string;
}

const USERS = usersRaw as TestUser[];

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface AuthState {
  /** Username of the signed-in tester, or null when logged out. */
  user: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

/**
 * Test-gate auth: credentials are checked against bundled sha256 hashes
 * (salted with the username). This keeps plaintext passwords out of the
 * bundle but is NOT real security — there is no backend.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,

      login: async (username, password) => {
        const normalized = username.trim().toLowerCase();
        const entry = USERS.find((u) => u.username === normalized);
        if (!entry) return false;
        const hash = await sha256Hex(`${normalized}:${password.trim()}`);
        if (hash !== entry.hash) return false;
        set({ user: normalized });
        return true;
      },

      logout: () => set({ user: null }),
    }),
    { name: 'royal-duels-auth', version: 1 },
  ),
);
