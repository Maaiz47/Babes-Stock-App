/**
 * Who is allowed to reach the medicine reminder section.
 *
 * To hand access to a different (or an extra) account, add the username here —
 * usernames are always stored lowercase.
 */
export const MEDS_USERNAMES = ['amanii'];

export interface MedsAccessSubject {
  username?: string | null;
  isAdmin?: boolean | null;
}

export function canAccessMeds(user: MedsAccessSubject | null | undefined): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  return MEDS_USERNAMES.includes((user.username ?? '').toLowerCase());
}
