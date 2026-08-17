/* tools/themes.js — what each theme is, and which clues belong to it.
 *
 * The bank has no club column. Membership is derived from the clue text, the
 * answer and the entity, which gets it roughly right and needs a human pass:
 * a first attempt counted every Queens Park Rangers clue as Rangers.
 *
 * Keys are matched as whole words against a normalised form (accents stripped,
 * punctuation to spaces, lower case, padded with spaces), so "leeds" cannot
 * match inside another word. `not` lists rule a clue out even when a key hits,
 * which is how Rangers and Queens Park Rangers are kept apart.
 */
const CLUB = "club", TOPIC = "topic";

/* `keys` decide what a clue is ABOUT. `self` lists the answers that ARE the
   theme, and those are struck out of the pool entirely.
 *
 * The distinction matters and is not the same list. A Manchester City board is
 * about Maine Road, Shaun Goater, its transfers and its managers — so Maine
 * Road is a perfectly good answer. "Manchester City" is not, and neither is
 * "Citizens": asking a City supporter to write in City is not a clue, it is a
 * label. Nicknames count as the club, grounds and stands do not.
 */
const THEMES = [
  { id: "man-united", name: "Manchester United", kind: CLUB,
    keys: ["manchester united", "man utd", "man united", "old trafford", "red devils"],
    self: ["manchester united", "man utd", "man united", "red devils"] },
  { id: "liverpool", name: "Liverpool", kind: CLUB,
    keys: ["liverpool", "anfield", "the kop"],
    self: ["liverpool", "reds"] },
  { id: "chelsea", name: "Chelsea", kind: CLUB,
    keys: ["chelsea", "stamford bridge"],
    self: ["chelsea", "blues", "pensioners"] },
  { id: "man-city", name: "Manchester City", kind: CLUB,
    keys: ["manchester city", "man city", "etihad", "maine road"],
    self: ["manchester city", "man city", "citizens", "cityzens", "sky blues"] },
  { id: "arsenal", name: "Arsenal", kind: CLUB,
    keys: ["arsenal", "gunners", "highbury", "emirates"],
    self: ["arsenal", "gunners"] },
  { id: "spurs", name: "Tottenham Hotspur", kind: CLUB,
    keys: ["tottenham", "spurs", "white hart lane"],
    self: ["tottenham hotspur", "tottenham", "spurs", "lilywhites"] },
  { id: "newcastle", name: "Newcastle United", kind: CLUB,
    keys: ["newcastle", "st james", "magpies"],
    self: ["newcastle united", "newcastle", "magpies", "toon", "toon army"] },
  { id: "everton", name: "Everton", kind: CLUB,
    keys: ["everton", "goodison", "toffees"],
    self: ["everton", "toffees"] },
  { id: "leeds", name: "Leeds United", kind: CLUB,
    keys: ["leeds", "elland road"],
    self: ["leeds united", "leeds", "whites", "peacocks"] },
  { id: "aston-villa", name: "Aston Villa", kind: CLUB,
    keys: ["aston villa", "villa park", "villans", "holte end"],
    self: ["aston villa", "villa", "villans"] },
  { id: "west-ham", name: "West Ham United", kind: CLUB,
    keys: ["west ham", "upton park", "hammers", "boleyn"],
    self: ["west ham united", "west ham", "hammers", "irons"] },
  /* Bolton's material is a purpose-built set rather than clues scraped out of
     the general bank, so it matches on the club and its grounds across four
     names — Burnden Park, the Reebok, the Macron and the University of Bolton
     are all the same place at different dates. */
  { id: "bolton", name: "Bolton Wanderers", kind: CLUB,
    /* Not "wanderers" on its own: it matches Wolverhampton Wanderers and drags
       in every clue about them. The club's own name and its grounds only. */
    keys: ["bolton", "bolton wanderers", "burnden park", "burnden", "reebok",
           "macron", "university of bolton", "toughsheet", "trotters"],
    self: ["bolton wanderers", "bolton", "trotters", "wanderers"],
    /* Three of a family rather than two. The cap exists to stop the general
       bank putting the same construction on a board three times — "Won the FA
       Cup in ____" asked thrice. It does not apply the same way here: this
       material was written as a set, the clues are all different shapes, and
       the categories are derived by keyword rather than carried in the data.
       At two, Managers and Famous Goals ran out after four boards and the
       fifth could not be built from material that was plainly there. */
    familyCap: 3,
    /* Its remaining boards take the earliest Fridays that still keep four
       weeks between them, rather than waiting for their turn in the round.
       The general ordering — every theme's second board before any theme's
       third — is right for a programme meant to last a year, and wrong for a
       four-board set written for one supporter: it put #3 in January and #4 in
       April. */
    priority: true },

  { id: "leicester", name: "Leicester City", kind: CLUB,
    keys: ["leicester", "king power", "filbert street", "foxes"],
    self: ["leicester city", "leicester", "foxes"] },

  { id: "grounds", name: "Grounds", kind: TOPIC,
    cats: ["City → Stadium", "Nickname → Stadium", "Stadium → City", "Club → Stadium",
           "Stadium → Club", "Stadium → Nickname", "Stadiums & Club History"] },
  { id: "nicknames", name: "Nicknames", kind: TOPIC,
    cats: ["Nickname → Club", "City → Nickname", "Nickname → City", "Club → Nickname",
           "Nicknames & Identities", "Player Identity / Who Am I"] },
  { id: "derbies", name: "Derbies", kind: TOPIC,
    cats: ["Derbies & Rivalries"] },
  { id: "premier-league", name: "Premier League", kind: TOPIC,
    cats: ["Relegated Club → Season", "Promoted Club → Season",
           "Premier League Top Scorer → Season", "Premier League Runner-Up → Season"] },
  { id: "managers", name: "Managers", kind: TOPIC, cats: ["Managers"] },
  { id: "european-nights", name: "European nights", kind: TOPIC,
    cats: ["European Cup Winner → Year", "European Cup Runner-Up → Year",
           "Europa League Winner → Year", "Conference League Winner → Year",
           "Conference League Runner-Up → Year"] },
  { id: "international", name: "International", kind: TOPIC,
    cats: ["World Cup Winner → Year", "World Cup Runner-Up → Year", "Euros Winner → Year",
           "Euros Runner-Up → Year", "Copa America Winner → Year", "International Tournaments",
           "International Caps → Player", "Nations League Winner → Year",
           "Nations League Runner-Up → Year", "Player → Country"] },
  { id: "moments", name: "Moments & records", kind: TOPIC,
    cats: ["Famous Goals & Moments", "Records & Milestones", "Awards & Individual Honours"] },
  { id: "fa-cup", name: "FA Cup", kind: TOPIC, cats: ["FA Cup Winner → Year"] },
];

function norm(s) {
  return " " + String(s == null ? "" : s)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
}

/* A clue belongs to a club theme if the club is named in the clue, is the
   answer, or is the row's entity. Topic themes go by category, which is
   already a curated field and needs no guessing. */
/* Named only to be ruled out. The city clues disambiguate with "— not X",
   so "London — not Chelsea, Tottenham or Queens" mentions two big themes and
   belongs to neither: the answer is West Ham, and Chelsea is there precisely
   because it is the wrong answer. Naming a theme in order to exclude it is the
   opposite of belonging to it, and putting that clue on the Chelsea board asks
   a Chelsea supporter to not write Chelsea. */
function namedOnlyToExclude(row, theme) {
  const m = /[\u2014-]\s*not\s/i.exec(String(row.clue || ""));
  if (!m) return false;
  const before = norm(row.clue.slice(0, m.index));
  const after = norm(row.clue.slice(m.index));
  const hitsAfter = theme.keys.some((k) => after.indexOf(" " + k + " ") !== -1);
  const hitsBefore = theme.keys.some((k) => before.indexOf(" " + k + " ") !== -1);
  const isAnswer = theme.keys.some((k) => norm(row.answer).indexOf(" " + k + " ") !== -1);
  return hitsAfter && !hitsBefore && !isAnswer;
}

function belongs(row, theme) {
  if (theme.cats) return theme.cats.indexOf(row.cat) !== -1;
  const hay = norm(row.clue) + "|" + norm(row.answer) + "|" + norm(row.entity);
  if (theme.not && theme.not.some((n) => hay.indexOf(" " + n + " ") !== -1)) return false;
  if (namedOnlyToExclude(row, theme)) return false;
  return theme.keys.some((k) => hay.indexOf(" " + k + " ") !== -1);
}

/* Is this row's answer the theme itself? Compared on the grid form, so
   punctuation and spacing cannot smuggle one past: "Man Utd" and "manutd" are
   the same answer wearing different clothes. */
function isSelfAnswer(row, theme) {
  if (!theme.self) return false;
  const g = String(row.grid || "").toUpperCase();
  return theme.self.some((n) => n.replace(/[^a-z0-9]/g, "").toUpperCase() === g);
}

function poolFor(rows, theme) {
  return rows.filter((r) => String(r.maxPer).trim() !== "0" &&
                            belongs(r, theme) && !isSelfAnswer(r, theme));
}

module.exports = { THEMES, belongs, poolFor, isSelfAnswer, namedOnlyToExclude, norm };
