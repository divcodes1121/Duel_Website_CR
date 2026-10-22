/* Coach Duel's two modes on one route: `#/coach-duel` is you against the AI
 * coach, `#/coach-duel/room[/<id>]` two coaches online (2026-10-22). The
 * Dashboard draws this for the whole `#/coach-duel` prefix; it follows the
 * hash itself, since both modes are one view to the shell. */
import { useEffect, useState } from 'react';
import { CoachDuel } from './CoachDuel';
import { CoachRoom } from './CoachRoom';
import { ROOM_ROUTE } from '../../../utils/coachRoom';

export function CoachDuelPage() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const path = hash.split('?')[0];
  return path === ROOM_ROUTE || path.startsWith(`${ROOM_ROUTE}/`) ? <CoachRoom hash={hash} /> : <CoachDuel />;
}
