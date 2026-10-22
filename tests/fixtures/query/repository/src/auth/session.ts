import { validSignature } from './signature';
export interface Session { token: string; expiresAt: number; }
export function verifySession(session: Session, now: number): boolean {
  if (session.expiresAt <= now) return false;
  return validSignature(session.token);
}
