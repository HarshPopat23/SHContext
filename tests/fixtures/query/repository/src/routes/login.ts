import { verifySession, type Session } from '../auth/session';
import adapter from './not-configured';
export function loginRoute(session: Session, now: number) {
  return verifySession(session, now) ? 'accepted' : 'rejected';
}
