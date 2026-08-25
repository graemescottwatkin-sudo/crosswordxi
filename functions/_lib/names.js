/* Display names, which are published.
 *
 * Whatever somebody types appears on a page they can forward anywhere, so this
 * is the one place in the project where user text reaches other people. It is
 * cleaned rather than trusted, and the owner can still hide a row afterwards —
 * a filter catches the careless, not the determined.
 */
const BANNED = [
  /* Deliberately short and blunt. A long list invites the arms race and catches
     innocent words; the remove button in owner tools is the real answer. */
  "fuck", "shit", "cunt", "bitch", "wank", "nonce", "paedo", "rape",
  "nigger", "nigga", "faggot", "spastic", "retard", "tranny", "kike", "chink",
];

export function cleanName(raw) {
  let s = String(raw == null ? "" : raw)
    .replace(/[\u0000-\u001f\u007f]/g, " ")   // control characters
    .replace(/[\u200b-\u200f\u2028-\u202e\ufeff]/g, "")  // zero-width and direction marks
    /* No markup characters. Rendering escapes them, but that is a promise every
       future render site would have to keep, and a name has no use for them. */
    .replace(/[<>&"'`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  if (s.length < 2) return null;

  /* Letters flattened before matching, so "f u c k" and "ƒuck" do not sail past
     a list of plain words. */
  const flat = s.toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  for (const word of BANNED) if (flat.includes(word)) return null;

  return s;
}

/* Not a name: an identifier for "the same person, one entry". The account id
   where there is one, otherwise a random key the device keeps. It says nothing
   about who anybody is and is never displayed. */
export function validEntrantKey(k) {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(k || "")) ? String(k) : null;
}

export function shortId() {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";   // no 0/O/1/l/i
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/* The name a signed-in player goes by. currentUser returns the database row, so
   the field is display_name — user.name is always undefined, and asking for it
   quietly turned every signed-in player into a guest whose name came from the
   request body. Written once here so the next endpoint to need it cannot ask
   for the wrong field.
   Falls back to the part of the email before the @: an account with no display
   name still belongs to somebody. */
export function accountDisplayName(user) {
  if (!user) return null;
  const n = cleanName(user.display_name);
  if (n) return n;
  const email = String(user.email || "");
  const at = email.indexOf("@");
  return at > 1 ? cleanName(email.slice(0, at)) : null;
}

/* The one place that decides who an entrant is.
 *
 * A signed-in player is their account; a guest is a key their device keeps. It
 * was worked out separately at every call site, and the read used the device
 * key while the write had used the account — so a signed-in creator asking to
 * see their own standings matched nothing and was told they had not played.
 * Written once so the two cannot disagree again.
 */
export function entrantKeyFor(user, bodyKey) {
  if (user && user.id) return "u:" + user.id;
  return validEntrantKey(bodyKey);
}
