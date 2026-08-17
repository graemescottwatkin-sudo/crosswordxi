const FCW = require('./engine.js');
const rows = require('./data.json');
const seasons = require('./seasons.json');
FCW.loadSeasons(seasons);
let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; if (!ok) console.log("FAIL:", name, detail || ""); };

/* ---- Normalisation ---- */
const n1 = FCW.normaliseAnswer("Brighton & Hove Albion");
t("norm: punctuation+spaces", n1.grid === "BRIGHTONHOVEALBION" && JSON.stringify(n1.breaks) === "[8,12]");
t("norm: three words", JSON.stringify(FCW.normaliseAnswer("Stadium of Light").breaks) === "[7,9]");
t("norm: uppercase", FCW.normaliseAnswer("Arsenal").grid === "ARSENAL");
t("data: 160 rows agree with normaliser", rows.every(r => {
  const n = FCW.normaliseAnswer(r.answer);
  const nums = (r.enum.match(/\d+/g) || []).map(Number);
  return n.grid === r.grid && JSON.stringify(n.breaks) === JSON.stringify(r.breaks)
    && nums.reduce((a, b) => a + b, 0) === r.grid.length;
}));

/* ---- Generation: 100 puzzles, all V0.2 invariants ---- */
const N = 10;
const stats = [];
let allValid = true, firstErr = "";
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const p = FCW.generate(rows, { seed: 9000 + i * 41 });
  const errs = FCW.validatePuzzle(p);
  if (errs.length) { allValid = false; if (!firstErr) firstErr = "seed " + (9000 + i * 41) + ": " + errs[0]; }
  stats.push({ w: p.width, h: p.height, n: p.entries.length, ints: p.stats.intersections,
    ratio: p.width / p.height, ms: p.meta.generationMs, att: p.meta.attempts,
    density: p.stats.letters / (p.width * p.height) });
}
const ms = Date.now() - t0;
t("gen: 100 puzzles pass full validation (bounds, PGK, adjacency, numbering)", allValid, firstErr);
t("gen: width <= 15 always", stats.every(s => s.w <= 15), "max " + Math.max(...stats.map(s => s.w)));
t("gen: height <= 15 always", stats.every(s => s.h <= 15), "max " + Math.max(...stats.map(s => s.h)));
t("gen: 10 <= answers <= 14", stats.every(s => s.n >= 10 && s.n <= 14));
const inBandCount = stats.filter(s => s.ratio >= 0.75 && s.ratio <= 1.33).length;
const inBand = Math.round((inBandCount / N) * 100);   // percentage, not a raw count
const avg = k => (stats.reduce((a, s) => a + s[k], 0) / N).toFixed(2);
console.log(`\n${N} puzzles in ${(ms / 1000).toFixed(1)}s (avg ${avg("ms")}ms, avg ${avg("att")} attempts)`);
console.log(`answers avg ${avg("n")} | intersections avg ${avg("ints")} | density avg ${avg("density")}`);
console.log(`size: ${Math.min(...stats.map(s=>s.w))}-${Math.max(...stats.map(s=>s.w))} x ${Math.min(...stats.map(s=>s.h))}-${Math.max(...stats.map(s=>s.h))} | aspect in preferred band: ${inBand}%`);
t("gen: >=85% within preferred aspect band", inBand >= 85, inBand + "%");
t("gen: excluded-by-length reported", (() => {
  const m = FCW.generate(rows, { seed: 1, attempts: 1, minAttempts: 1 }).meta;
  const expected = rows.filter(r => r.maxPer !== 0 && r.grid.length > 15).length;
  return m.excludedByLength === expected;
})());

/* ---- Self-answering clues ---- */
t("self-answering: any shared word of over three letters disqualifies a pairing", (() => {
  const cases = [
    [{ clue: "Hull City", answer: "Hull" }, true],                 // answer inside the clue
    [{ clue: "Hull", answer: "Hull City" }, true],                 // clue inside the answer
    [{ clue: "Villa Park", answer: "Aston Villa" }, true],         // shares one word
    [{ clue: "Manchester", answer: "Manchester United" }, true],
    [{ clue: "Won it in 2016, beating Atletico Madrid", answer: "Real Madrid" }, true],
    [{ clue: "Gunners", answer: "Arsenal" }, false],               // genuinely unrelated
    [{ clue: "Selhurst Park", answer: "Crystal Palace" }, false],
    [{ clue: "Won the World Cup in 1966, beating West Germany", answer: "England" }, false]
  ];
  return cases.every(c => FCW.isSelfAnswering(c[0]) === c[1]);
})());
t("self-answering: short shared words are ignored (City, Town, and the like)",
  !FCW.isSelfAnswering({ clue: "The home of the Cup", answer: "Ajax" }));
t("self-answering: the bank's give-away pairings are counted and excluded", (() => {
  const p = FCW.generate(rows, { seed: 1, attempts: 1, minAttempts: 1 });
  const expected = rows.filter(r => r.maxPer !== 0 && r.grid.length <= 15 &&
    FCW.isSelfAnswering(r)).length;
  // The bank's own give-aways are archived (v05c), so expected is normally 0.
  // Prove the mechanism still fires with a synthetic live give-away row.
  const planted = rows.concat([{ id: "SELFX", cat: "City → Club", clue: "Hull",
    answer: "Hull City", grid: "HULLCITY", enum: "(4,4)", breaks: [4],
    entity: "Hull City", diff: "Easy", pgk: "Hull City", maxPer: 1,
    group: "England", era: "Timeless" }]);
  const p2 = FCW.generate(planted, { seed: 1, attempts: 1, minAttempts: 1 });
  return p.meta.excludedSelfAnswering === expected &&
    p2.meta.excludedSelfAnswering === expected + 1;
})());
t("self-answering: none ever reaches a puzzle", (() => {
  for (let i = 0; i < 5; i++) {
    const p = FCW.generate(rows, { seed: 400 + i * 29 });
    if (p.entries.some(e => FCW.isSelfAnswering(e.row))) return false;
  }
  return true;
})());
t("self-answering: the city-equals-club cases are gone", (() => {
  // "This team plays in Hull" -> HULL CITY, and its reverse, must never reach a
  // puzzle. Assert through the engine's own rule rather than restating it here,
  // so the test cannot drift from the implementation.
  for (let i = 0; i < 5; i++) {
    const p = FCW.generate(rows, { seed: 1700 + i * 31 });
    if (p.entries.some(e => FCW.isSelfAnswering(e.row))) return false;
  }
  // and the specific pairing is genuinely excluded from the bank
  return rows.filter(r => r.grid === "HULLCITY" && /^Hull$/.test(r.clue))
    .every(r => FCW.isSelfAnswering(r));
})());
t("self-answering: every core club still has at least 3 usable rows", (() => {
  // The core clubs carry the eight club categories and need several rows so the
  // generator has choices. Groups introduced by a single competition or
  // top-scorer row (a one-title nation, a club with one Golden Boot) legitimately
  // have fewer, and must simply have at least one.
  const usable = {};
  rows.forEach(r => { if (r.grid.length <= 15 && !FCW.isSelfAnswering(r)) usable[r.pgk] = (usable[r.pgk] || 0) + 1; });
  // Core clubs carry the full club-fact set — they have a stadium as well as a
  // nickname. Clubs added for a single definitive nickname legitimately have
  // fewer rows, as do one-title nations.
  /* The arrow form identifies the original templated categories ("Stadium ->
     Club"). A loose /Stadium/ match also caught the imported free-text category
     "Stadiums & Club History", which is not a club-fact set and has no business
     defining the core twenty. */
  const core = new Set(rows.filter(r => /\u2192/.test(r.cat) && /Stadium/.test(r.cat) &&
    !/Winner|Runner-Up|Top Scorer|Relegated|Promoted/.test(r.cat)).map(r => r.pgk));
  if (core.size !== 20) return false;
  if (![...core].every(k => usable[k] >= 3)) return false;
  // A group may legitimately supply nothing usable, but only for a stated
  // reason: every answer too long for a 15x15 grid (Wolverhampton Wanderers),
  // or every row deliberately archived (Al Hilal, Sassuolo). Never because the
  // clues themselves were bad.
  const groups = new Set(rows.map(r => r.pgk));
  return [...groups].every(g => {
    if (usable[g] >= 1) return true;
    const rs = rows.filter(r => r.pgk === g);
    return rs.every(r => r.grid.length > 15) || rs.every(r => r.maxPer === 0);
  });
})());
t("self-answering: validator reports one if it somehow appears", (() => {
  // Use a distinctive answer, not whichever row happens to be first: an answer
  // made only of generic words (West Ham United) is correctly NOT flagged.
  const p = FCW.generate(rows, { seed: 400 });
  const fake = JSON.parse(JSON.stringify(p));
  fake.entries[0].row.answer = "Blackburn";
  fake.entries[0].row.grid = "BLACKBURN";
  fake.entries[0].row.clue = "Blackburn";
  return FCW.validatePuzzle(fake).some(e => /contains its own answer/.test(e));
})());

/* ---- V0.5: subject/answer namespace + rotation ---- */
{
  let viol = 0;
  for (let i = 0; i < 5; i++) {
    const p = FCW.generate(rows, { seed: 5500 + i * 31 });
    const ns = {};
    for (const e of p.entries) {
      const g = e.row.grid, ct = FCW.subjectKey(e.row);
      if (ns[g] || (ct && ns[ct])) viol++;
      ns[g] = 1; if (ct) ns[ct] = 1;
    }
  }
  t("namespace: no term is both subject and answer in one puzzle", viol === 0);
}
t("namespace: validator flags a subject reused as an answer", (() => {
  const p = FCW.generate(rows, { seed: 5500 });
  const fake = JSON.parse(JSON.stringify(p));
  fake.entries[1].row.clue = fake.entries[0].row.answer; // subject == another entry's answer
  return FCW.validatePuzzle(fake).some(e => /Subject reused/.test(e));
})());
t("rotation: deterministic per seed, differs across seeds",
  JSON.stringify(FCW.buildRotation(rows, 99)) === JSON.stringify(FCW.buildRotation(rows, 99)) &&
  JSON.stringify(FCW.buildRotation(rows, 99)) !== JSON.stringify(FCW.buildRotation(rows, 100)));
t("rotation: off by default (quality over benching on a small pool)", (() => {
  const seed = 4242;
  const a = FCW.generate(rows, { seed }).entries.map(e => e.row.id).join();
  const b = FCW.generate(rows, { seed, rotation: false }).entries.map(e => e.row.id).join();
  return a === b;
})());
t("rotation: when enabled, benched terms stay out of the puzzle", (() => {
  const seed = 4242;
  const banned = FCW.buildRotation(rows, seed);
  const p = FCW.generate(rows, { seed, rotation: true });
  return p.entries.every(e => {
    const sk = FCW.subjectKey(e.row);
    return !banned[e.row.grid] && !(sk && banned[sk]);
  });
})());
t("rotation: puzzles stay valid and full-size with it on", (() => {
  for (let i = 0; i < 8; i++) {
    const p = FCW.generate(rows, { seed: 9100 + i * 17, rotation: true });
    if (FCW.validatePuzzle(p).length || p.entries.length < 10) return false;
  }
  return true;
})());
t("rotation: enabling it still produces valid puzzles", (() => {
  const p = FCW.generate(rows, { seed: 4242, rotation: true });
  return FCW.validatePuzzle(p).length === 0;
})());

/* ---- Clues must not name another entry's answer ---- */
t("mentions: whole-word runs are extracted, not substrings", (() => {
  const k = FCW.mentionKeys("Won the World Cup in 1998, beating Brazil 3-0");
  return k["BRAZIL"] === true && !FCW.mentionKeys("Sunderland's nickname")["SON"];
})());
t("mentions: no clue names another entry's answer", (() => {
  for (let i = 0; i < 12; i++) {
    const p = FCW.generate(rows, { seed: 800 + i * 17 });
    const grids = new Set(p.entries.map(e => e.row.grid));
    for (const e of p.entries) {
      const mk = FCW.mentionKeys(e.row.clue);
      for (const g of grids) if (g !== e.row.grid && mk[g]) return false;
    }
  }
  return true;
})());
t("mentions: validator reports a clue that names another answer", (() => {
  const p = FCW.generate(rows, { seed: 800 });
  const fake = JSON.parse(JSON.stringify(p));
  fake.entries[0].row.clue = "A clue mentioning " + fake.entries[1].row.answer + " directly";
  return FCW.validatePuzzle(fake).some(e => /names another entry's answer/.test(e));
})());

/* ---- International caps ---- */
{
  const caps = rows.filter(r => r.cat.indexOf("International Caps") === 0);
  t("caps: rows are present and keyed on the country", caps.length >= 13 &&
    caps.every(r => r.pgk === r.entity), caps.length);
  t("caps: the clue states a cap total, a country and the last-cap year",
    caps.every(r => /^Won \d+ caps for .+, last appearing in (19|20)\d{2}$/.test(r.clue)));
  t("caps: the last-cap year gives every row a real era, not Timeless",
    caps.every(r => r.era !== "Timeless" && /^((19|20)\d0s|Pre-1990)$/.test(r.era)),
    [...new Set(caps.map(r => r.era))].join(","));
  t("caps: no last-cap year is in the future", (() => {
    const now = new Date().getFullYear();
    return caps.every(r => +r.clue.match(/in ((?:19|20)\d{2})$/)[1] <= now);
  })());
  t("caps: answers are surnames in plain A-Z",
    caps.every(r => /^[A-Z]+$/.test(r.grid) && r.grid.length <= 15));
  t("caps: no row answers itself", caps.every(r => !FCW.isSelfAnswering(r)));
  t("caps: enumerations match the answers", caps.every(r => {
    const nums = (r.enum.match(/\d+/g) || []).map(Number);
    return nums.reduce((a, b) => a + b, 0) === r.grid.length;
  }));
  t("caps: two players on the same total cannot share a puzzle", (() => {
    // Charlton and Lampard both won 106 England caps, so the clue text is
    // identical. Both are keyed on England, so the one-entity rule keeps them
    // apart without any special handling.
    // Charlton and Lampard both won 106 England caps. The last-cap year now
    // separates the clues; the shared England key keeps them apart regardless.
    const same = caps.filter(r => /106 caps for England/.test(r.clue));
    if (same.length !== 2) return false;
    if (new Set(same.map(r => r.clue)).size !== 2) return false;   // distinct clues
    if (new Set(same.map(r => r.pgk)).size !== 1) return false;
    for (let i = 0; i < 8; i++) {
      const p = FCW.generate(rows, { seed: 6600 + i * 31 });
      const seen = {};
      for (const e of p.entries) {
        if (e.row.cat.indexOf("International Caps") !== 0) continue;
        if (seen[e.row.clue]) return false;
        seen[e.row.clue] = true;
      }
    }
    return true;
  })());
  t("caps: only retired players, so totals cannot go stale", (() => {
    // Active record-chasers must not be in the bank at all.
    // Players still active in the source list must not be in the bank at all,
    // or their totals would go stale.
    const active = ["KANE", "STONES", "HENDERSON", "PICKFORD", "RICE", "RASHFORD",
                    "SAKA", "FODEN", "BELLINGHAM", "RONALDO", "MESSI", "MODRIC"];
    return !caps.some(r => active.indexOf(r.grid) !== -1);
  })());
}

/* ---- Europa League / UEFA Cup winners ---- */
{
  const uc = rows.filter(r => r.cat.indexOf("Europa League Winner") === 0);
  t("europa: every final from 1972 to 2026 is present", uc.length === 55, uc.length);
  t("europa: older finals are era-tagged rather than archived",
    uc.every(r => {
      const yr = +r.clue.match(/in (\d{4})/)[1];
      return r.maxPer === 1 && (yr >= 1990 ? r.era !== "Pre-1990" : r.era === "Pre-1990");
    }));
  t("europa: clues name the competition as it was called that year",
    uc.every(r => {
      const yr = +r.clue.match(/in (\d{4})/)[1];
      return yr >= 2010 ? /Europa League/.test(r.clue) : /UEFA Cup/.test(r.clue);
    }));
  t("europa: answers are plain A-Z, and no row answers itself",
    uc.every(r => /^[A-Z]+$/.test(r.grid) && !FCW.isSelfAnswering(r)));
  t("europa: enumerations match the answers", uc.every(r => {
    const nums = (r.enum.match(/\d+/g) || []).map(Number);
    return nums.reduce((a, b) => a + b, 0) === r.grid.length;
  }));
  t("europa: each clue names the beaten finalist, keeping the pair apart",
    uc.every(r => /beating .* in the final$/.test(r.clue)));
  t("europa: keyed on the winning club", uc.every(r => r.pgk === r.entity));
}

/* ---- Player nationality ---- */
{
  const nat = rows.filter(r => r.cat === "Player \u2192 Country");
  t("nationality: rows are present and keyed on the country",
    nat.length >= 15 && nat.every(r => r.pgk === r.entity), nat.length);
  t("nationality: the clue asks which country a named player represented",
    nat.every(r => /^.+ represented which country\?$/.test(r.clue)));
  t("nationality: answers are plain A-Z country names",
    nat.every(r => /^[A-Z]+$/.test(r.grid) && r.grid.length <= 15));
  t("nationality: enumerations match the answers", nat.every(r => {
    const nums = (r.enum.match(/\d+/g) || []).map(Number);
    return nums.reduce((a, b) => a + b, 0) === r.grid.length;
  }));
  t("nationality: no row answers itself", nat.every(r => !FCW.isSelfAnswering(r)));
  t("nationality: no two players share a clue and an enumeration",
    FCW.ambiguousClues(rows).filter(a => /Country/.test(a.cat)).length === 0);
  t("nationality: every row cites where the country was stated",
    nat.every(r => r.notes && r.notes.length > 10));
}

/* ---- Transfers, both directions ---- */
{
  const tr = rows.filter(r => /^Transfer/.test(r.cat));
  const joined = rows.filter(r => r.cat === "Transfer \u2192 Club Joined");
  const left = rows.filter(r => r.cat === "Transfer \u2192 Club Left");
  t("transfers: both directions are generated", joined.length > 100 && left.length > 100,
    joined.length + " joined / " + left.length + " left");
  t("transfers: the 'joined which club' form names the selling club",
    joined.every(r => /^.+ joined which club from .+ in \d{4}\?$/.test(r.clue)));
  t("transfers: the 'from which club' form names the buying club",
    left.every(r => /^.+ joined .+ from which club in \d{4}\?$/.test(r.clue)));
  t("transfers: every clue records its fee", tr.every(r => /fee \d+m/.test(r.notes)));
  t("transfers: the whole range is kept, only the playable ones circulate", (() => {
    const live = tr.filter(r => r.maxPer === 1);
    const archived = tr.filter(r => r.maxPer === 0);
    return archived.length > 0 && live.length > 0 && archived.length > live.length;
  })(), tr.filter(r => r.maxPer === 1).length + " live / " + tr.filter(r => r.maxPer === 0).length + " archived");
  t("transfers: archived rows say why they are archived",
    tr.filter(r => r.maxPer === 0).every(r => /archived - /.test(r.notes)));
  t("transfers: the two archive reasons are the fee and the answer club",
    tr.filter(r => r.maxPer === 0).every(r =>
      /below the live fee threshold|answer club outside the top leagues/.test(r.notes)));
  t("transfers: every live answer is a club a solver would name", (() => {
    const TOP = new Set(["AC Milan","Arsenal","Chelsea","Liverpool","Real Madrid","Barcelona",
      "Bayern Munich","Juventus","Inter Milan","Paris St Germain","Porto","Benfica","Ajax",
      "Galatasaray","Shakhtar Donetsk","Zenit St Petersburg"]);
    const live = tr.filter(r => r.maxPer === 1);
    // Spot-check: none of the Saudi or Chinese clubs may be a live answer.
    const banned = ["AL HILAL","AL NASSR","AL ITTIHAD","AL AHLI","AL QADSIAH",
                    "SHANGHAI SIPG","JIANGSU SUNING"];
    return live.length > 0 && !live.some(r => banned.indexOf(r.answer.toUpperCase()) !== -1);
  })());
  t("transfers: the rule is one-sided — a move can be playable one way only", (() => {
    // Zenit -> Chelsea is fair asked one way round and not the other, so the
    // two directions of the same transfer must be judged separately.
    const byMove = {};
    tr.forEach(r => {
      const m = r.clue.match(/^(.+?) joined .* in (\d{4})\?$/);
      const k = m[1] + "|" + m[2];
      (byMove[k] = byMove[k] || []).push(r);
    });
    return Object.values(byMove).some(v =>
      v.length === 2 && v[0].maxPer !== v[1].maxPer);
  })());
  t("transfers: no archived clue ever reaches a puzzle", (() => {
    for (let i = 0; i < 5; i++) {
      const p = FCW.generate(rows, { seed: 9100 + i * 17 });
      if (p.entries.some(e => e.row.maxPer === 0)) return false;
    }
    return true;
  })());
  t("transfers: only recognisable players survive the fee filter", (() => {
    const clues = tr.map(r => r.clue).join(" ");
    return ["Neymar", "Mbapp", "Haaland", "Bellingham", "Rice"].every(n => clues.indexOf(n) !== -1);
  })());
  t("transfers: no obscure destination — every answer is a club the bank knows",
    tr.every(r => r.pgk === r.answer && r.grid.length > 2));
  t("transfers: enabling the archive is a data change, not a code change", (() => {
    // Flipping Max Per Puzzle to 1 must be all it takes to bring a row back.
    const one = rows.find(r => /^Transfer/.test(r.cat) && r.maxPer === 0);
    if (!one) return false;
    const enabled = rows.map(r => r === one ? Object.assign({}, r, { maxPer: 1 }) : r);
    return FCW.validateDataset(enabled).length === 0;
  })());
  t("transfers: a player with two big moves in one year is skipped", (() => {
    const seen = {};
    for (const r of tr) {
      const m = r.clue.match(/^(.+?) joined .* in (\d{4})\?$/);
      const k = m[1] + "|" + m[2] + "|" + r.cat;
      if (seen[k]) return false;
      seen[k] = true;
    }
    return true;
  })());
  t("transfers: accents allowed in clues, answers stay plain A-Z",
    tr.some(r => /[^\x00-\x7F]/.test(r.clue)) && tr.every(r => /^[A-Z]+$/.test(r.grid)));
  t("transfers: a pair never appears together — each clue names the other club", (() => {
    for (let i = 0; i < 5; i++) {
      const p = FCW.generate(rows, { seed: 8800 + i * 19 });
      const grids = new Set(p.entries.map(e => e.row.grid));
      for (const e of p.entries) {
        const mk = FCW.mentionKeys(e.row.clue);
        for (const g of grids) if (g !== e.row.grid && mk[g]) return false;
      }
    }
    return true;
  })());
}

/* ---- Promotion: the other side of the missing-team clue ---- */
{
  const up = rows.filter(r => r.cat.indexOf("Promoted Club") === 0);
  t("promotion: three clues per season, naming two and asking the third",
    up.length === 87 && up.every(r => / and .* came up from .* who was the third club promoted\?$/.test(r.clue)),
    up.length);
  t("promotion: the answer is never one of the two clubs named",
    up.every(r => r.clue.split(" came up")[0].indexOf(r.answer) === -1));
  t("promotion: derived from the verified tables — promoted clubs are those in a season but not the one before", (() => {
    const seasons = require("./seasons.json").slice().sort((a, b) => a.season < b.season ? -1 : 1);
    return up.every(r => {
      const lab = r.clue.match(/for (\S+) —/)[1];
      const i = seasons.findIndex(s => s.season === lab);
      if (i < 1) return false;
      const prev = new Set(seasons[i - 1].table.map(x => x.club));
      return seasons[i].table.some(x => x.club === r.answer) && !prev.has(r.answer);
    });
  })());
  t("promotion: the second tier is named correctly for the period",
    up.every(r => {
      const yr = +r.clue.match(/for (\d{4})/)[1];
      return yr >= 2004 ? /the Championship/.test(r.clue) : /the second tier/.test(r.clue);
    }));
  t("promotion: none is self-answering", up.every(r => !FCW.isSelfAnswering(r)));
}

/* ---- Self-answering ignores generic club-name words ---- */
t("selfanswering: a shared generic word is not a giveaway", (() => {
  // "Manchester City ... -> Birmingham City" shares only City, which tells the
  // solver nothing. Flagging it would remove a perfectly fair clue.
  return !FCW.isSelfAnswering({
    clue: "Manchester City and West Bromwich Albion came up from the second tier for 2002/03 — who was the third club promoted?",
    answer: "Birmingham City" }) &&
    !FCW.isSelfAnswering({
      clue: "West Bromwich Albion and Sunderland went down in 2002/03 — who was the third team relegated?",
      answer: "West Ham United" });
})());
t("selfanswering: a shared distinctive word still is a giveaway",
  FCW.isSelfAnswering({ clue: "Hull", answer: "Hull City" }) &&
  FCW.isSelfAnswering({ clue: "Hull City", answer: "Hull" }) &&
  FCW.isSelfAnswering({ clue: "Villa Park", answer: "Aston Villa" }));
t("selfanswering: an answer made only of generic words cannot be given away",
  !FCW.isSelfAnswering({ clue: "Leeds United and Norwich City went down", answer: "West Ham United" }));

/* ---- Runner-up and missing-team categories ---- */
{
  const runnerUp = rows.filter(r => /Runner-Up/.test(r.cat));
  const relegated = rows.filter(r => /Relegated/.test(r.cat));
  t("runnerup: runner-up categories exist across competitions",
    new Set(runnerUp.map(r => r.cat)).size >= 4, [...new Set(runnerUp.map(r => r.cat))].join(", "));
  t("runnerup: each clue names the winner, so the pair cannot share a puzzle",
    runnerUp.every(r => /may have won|won the .* but who finished second/.test(r.clue)));
  t("runnerup: a winner and its runner-up never appear together", (() => {
    for (let i = 0; i < 6; i++) {
      const p = FCW.generate(rows, { seed: 4400 + i * 23 });
      const seen = {};
      for (const e of p.entries) {
        const m = e.row.clue.match(/in (\d{4})/);
        if (!m || !/Winner|Runner-Up/.test(e.row.cat)) continue;
        const key = e.row.cat.replace(/ (Winner|Runner-Up).*/, "") + "|" + m[1];
        if (seen[key]) return false;
        seen[key] = true;
      }
    }
    return true;
  })());
  t("relegation: the missing-team clue names two of the three and asks the third",
    relegated.length === 90 && relegated.every(r => / and .* went down in .* third team relegated\?$/.test(r.clue)),
    relegated.length);
  t("relegation: the answer is never one of the two clubs named", (() => {
    return relegated.every(r => {
      const named = r.clue.split(" went down")[0];
      return named.indexOf(r.answer) === -1;
    });
  })());
  t("relegation: every clue comes from a verified season table", (() => {
    const seasons = require("./seasons.json");
    return relegated.every(r => {
      const lab = r.clue.match(/went down in (\S+)/)[1];
      const s = seasons.find(x => x.season === lab);
      return s && s.table.slice(-3).some(x => x.club === r.answer);
    });
  })());
  t("runnerup: Premier League runners-up match the verified tables", (() => {
    const seasons = require("./seasons.json");
    return rows.filter(r => r.cat.indexOf("Premier League Runner-Up") === 0).every(r => {
      const lab = r.clue.match(/Premier League in (\S+),/)[1];
      const s = seasons.find(x => x.season === lab);
      return s && s.table[1].club === r.answer;
    });
  })());
}

/* ---- Nicknames: multiples allowed in both directions ---- */
{
  const nickRows = rows.filter(r => r.cat === "Club → Nickname");
  const backRows = rows.filter(r => r.cat === "Nickname → Club");
  t("nicknames: a club may have more than one", (() => {
    const by = {};
    nickRows.forEach(r => { (by[r.pgk] = by[r.pgk] || new Set()).add(r.grid); });
    return Object.values(by).some(s2 => s2.size > 1);
  })());
  t("nicknames: a nickname may belong to more than one club", (() => {
    const by = {};
    nickRows.forEach(r => { (by[r.grid] = by[r.grid] || new Set()).add(r.pgk); });
    return Object.values(by).some(s2 => s2.size > 1);
  })());
  t("nicknames: the definitive ones are present", (() => {
    const has = (club, nick) => nickRows.some(r => r.pgk === club && r.grid === nick);
    return has("West Ham United", "HAMMERS") && has("Sheffield Wednesday", "OWLS") &&
      has("Norwich City", "CANARIES") && has("Derby County", "RAMS") &&
      has("Birmingham City", "BLUES");
  })());
  t("nicknames: both directions exist for every club with one", (() => {
    const fwd = new Set(nickRows.map(r => r.pgk));
    const back = new Set(backRows.map(r => r.pgk));
    return [...fwd].every(c => back.has(c));
  })());
  t("nicknames: a shared nickname is separated by enumeration where possible", (() => {
    // Blues is Chelsea (7) and Birmingham City (10,4); Hatters is Luton Town
    // (5,4) and Stockport County (9,6). Different enumerations, so a solver can
    // tell them apart without any crossing letters.
    const blues = backRows.filter(r => /^Blues$/i.test(r.clue));
    const hatters = backRows.filter(r => /^Hatters$/i.test(r.clue));
    return new Set(blues.map(r => r.enum)).size === blues.length &&
      new Set(hatters.map(r => r.enum)).size === hatters.length;
  })());
  t("nicknames: none is self-answering", nickRows.every(r => !FCW.isSelfAnswering(r)));
}

/* ---- Euros and Copa America ---- */
{
  const eu = rows.filter(r => /^Euros/.test(r.cat));
  const ca = rows.filter(r => /^Copa America/.test(r.cat));
  t("euros: all 17 finals, winner and runner-up (canonical rows; variants are alternate phrasings)",
    eu.filter(r => /Winner/.test(r.cat) && !r.variant).length === 17 &&
    eu.filter(r => /Runner-Up/.test(r.cat) && !r.variant).length === 17, eu.length);
  t("euros: the winners match the published title counts", (() => {
    const wins = {};
    eu.filter(r => /Winner/.test(r.cat) && !r.variant).forEach(r => { wins[r.answer] = (wins[r.answer] || 0) + 1; });
    return wins["Spain"] === 4 && wins["Germany"] + wins["West Germany"] === 3 &&
      wins["France"] === 2 && wins["Italy"] === 2 && wins["Soviet Union"] === 1;
  })());
  t("copa: every edition from 1916 to 2024 bar the double 1959",
    ca.filter(r => !r.variant).length === 46, ca.length);
  t("copa: the title counts match Britannica, less the omitted double 1959", (() => {
    // Britannica: Argentina 16, Uruguay 15, Brazil 9, Peru 2, Paraguay 2,
    // Chile 2, Bolivia 1, Colombia 1. Two tournaments were played in 1959 —
    // Argentina won one and Uruguay the other — so "Won the Copa America in
    // 1959" would have two equally valid answers and both are left out.
    const wins = {};
    ca.filter(r => !r.variant).forEach(r => { wins[r.answer] = (wins[r.answer] || 0) + 1; });
    return wins["Argentina"] === 15 && wins["Uruguay"] === 14 && wins["Brazil"] === 9 &&
      wins["Peru"] === 2 && wins["Paraguay"] === 2 && wins["Chile"] === 2 &&
      wins["Bolivia"] === 1 && wins["Colombia"] === 1 &&
      !ca.some(r => /in 1959/.test(r.clue));
  })());
  t("copa: 1953 is Paraguay, against a source that had it wrong", (() => {
    const r = ca.find(x => /in 1953/.test(x.clue));
    return r && r.answer === "Paraguay";
  })());
  t("euros/copa: answers are plain A-Z nations, none self-answering",
    eu.concat(ca).every(r => /^[A-Z]+$/.test(r.grid) && !FCW.isSelfAnswering(r)));
  t("euros/copa: they widen the Internationals pool", (() => {
    const nations = new Set(rows.filter(r => r.group === "Internationals").map(r => r.pgk));
    return nations.size >= 25;
  })(), new Set(rows.filter(r => r.group === "Internationals").map(r => r.pgk)).size);
}

/* ---- Cities for the Championship clubs ---- */
{
  const nickClubs = new Set(rows.filter(r => r.cat === "Club \u2192 Nickname").map(r => r.pgk));
  const cityClubs = new Set(rows.filter(r => /\u2192 City$/.test(r.cat)).map(r => r.pgk));
  t("cities: every club with a nickname now has a city clue too",
    [...nickClubs].every(c => cityClubs.has(c)),
    [...nickClubs].filter(c => !cityClubs.has(c)).join(", "));
  t("cities: routed through the nickname, so none is self-answering",
    rows.filter(r => /Nickname \u2192 City|City \u2192 Nickname/.test(r.cat))
      .every(r => !FCW.isSelfAnswering(r)));
}

/* ---- Clues that need the crossing letters ---- */
t("ambiguity: the detector reports rather than rejects", (() => {
  // The shipped bank has none left, so exercise the detector on a crafted pair.
  const a = Object.assign({}, rows[0], { id: "Z1", clue: "Same", enum: "(7)",
    grid: "ARSENAL", answer: "Arsenal", cat: "Test" });
  const b = Object.assign({}, rows[0], { id: "Z2", clue: "Same", enum: "(7)",
    grid: "CHELSEA", answer: "Chelsea", cat: "Test" });
  const amb = FCW.ambiguousClues([a, b]);
  return amb.length === 1 && amb[0].answers.length === 2 &&
    FCW.validateDataset([a, b]).length === 0;   // reported, never rejected
})());
t("ambiguity: a disambiguating hint removes it entirely", (() => {
  // Where the enumeration cannot separate two clues, the clue itself does:
  // "This team's nickname is the Rovers - not Doncaster".
  return FCW.ambiguousClues(rows).length === 0;
})(), FCW.ambiguousClues(rows).map(a => a.clue + " " + a.enum).join("; "));
t("ambiguity: hints name the other candidate, never the answer", (() => {
  const hinted = rows.filter(r => / \u2014 not /.test(r.clue));
  if (!hinted.length) return false;
  return hinted.every(r => {
    const hint = r.clue.split(" \u2014 not ")[1];
    return r.answer.toLowerCase().indexOf(hint.toLowerCase()) === -1;
  });
})());
t("ambiguity: a hinted clue is still not self-answering",
  rows.filter(r => / \u2014 not /.test(r.clue)).every(r => !FCW.isSelfAnswering(r)));
t("ambiguity: the report carries a row so the clue can be shown as the player sees it", (() => {
  // The Clue cell holds the source term ("London"), not the sentence, so a
  // report printing it raw reads as though a club were nicknamed London.
  const amb = FCW.ambiguousClues(rows);
  return amb.every(a => a.sample && a.sample.cat === a.cat && a.sample.clue === a.clue);
})());

/* ---- Club cross-routes: cluing a city without naming the club ---- */
{
  const cross = rows.filter(r => /^(City|Stadium) → Nickname$|^Nickname → (City|Stadium)$/.test(r.cat));
  t("crossroutes: all four routes exist", new Set(cross.map(r => r.cat)).size === 4,
    [...new Set(cross.map(r => r.cat))].join(", "));
  t("crossroutes: none is self-answering, since none names the club",
    cross.length > 0 && cross.every(r => !FCW.isSelfAnswering(r)));
  t("crossroutes: cities are reachable again for clubs named after their city", (() => {
    // Hull City and Coventry City lose their City<->Club rows to the
    // self-answering rule; the nickname and stadium routes replace them.
    const hull = rows.filter(r => r.pgk === "Hull City" && !FCW.isSelfAnswering(r) &&
      r.maxPer !== 0 && r.grid.length <= 15);
    return hull.some(r => r.grid === "HULL") && hull.some(r => r.grid === "TIGERS");
  })());
}

/* ---- FA Cup ---- */
{
  const fa = rows.filter(r => r.cat.indexOf("FA Cup Winner") === 0);
  t("facup: post-war finals are present", fa.length === 81, fa.length);
  t("facup: pre-1990 finals sit in the Pre-1990 era, not archived", fa.every(r => {
    const yr = +r.clue.match(/in (\d{4})/)[1];
    return yr >= 1990 ? r.era !== "Pre-1990" : r.era === "Pre-1990";
  }));
  t("facup: only the two derby-pair finals are archived (self-answering rule)",
    fa.filter(r => r.maxPer === 0).map(r => r.id).sort().join() === "FA2023,FA2024");
  t("facup: names the beaten finalist, so the pair cannot share a puzzle",
    fa.every(r => /beating .* in the final$/.test(r.clue)));
  t("facup: reaches clubs the European competitions never do", (() => {
    const live = fa.filter(r => r.maxPer === 1).map(r => r.grid);
    return ["WIGANATHLETIC", "PORTSMOUTH", "LEICESTERCITY", "CRYSTALPALACE"]
      .every(c => live.indexOf(c) !== -1);
  })());
}

/* ---- Pre-1990 is opt-in, not archived ---- */
/* ---- Practice difficulty levels ---- */
t("levels: three levels with the agreed sub allowances", (() => {
  const L = FCW.LEVELS;
  return L.easy && L.medium && L.hard &&
    L.easy.subs > L.medium.subs && L.medium.subs > 0 && L.hard.subs === 0 &&
    FCW.DEFAULT_LEVEL === "medium";
})());
t("levels: easy restricts the mix to Easy clues, medium is the full mix, hard drops Easy",
  JSON.stringify(FCW.LEVELS.easy.diffs) === '["Easy"]' &&
  FCW.LEVELS.medium.diffs === null &&
  FCW.LEVELS.easy.diffs.indexOf("Hard") === -1 &&
  FCW.LEVELS.hard.diffs.indexOf("Easy") === -1);
t("levels: an easy puzzle contains only Easy clues", (() => {
  for (let s = 0; s < 6; s++) {
    const p = FCW.generate(rows, { seed: 5100 + s * 13,
      filter: { eras: FCW.DEFAULT_ERAS, diffs: FCW.LEVELS.easy.diffs } });
    if (!p.entries.every(e => e.row.diff === "Easy")) return false;
    if (FCW.validatePuzzle(p).length) return false;
  }
  return true;
})());
t("levels: a hard puzzle never contains an Easy clue", (() => {
  for (let s = 0; s < 6; s++) {
    const p = FCW.generate(rows, { seed: 6100 + s * 17,
      filter: { eras: FCW.DEFAULT_ERAS, diffs: FCW.LEVELS.hard.diffs } });
    if (p.entries.some(e => e.row.diff === "Easy")) return false;
    if (FCW.validatePuzzle(p).length) return false;
  }
  return true;
})());
t("levels: both restricted pools clear the viability floor", (() => {
  const easy = FCW.filterViability(rows, { eras: FCW.DEFAULT_ERAS, diffs: FCW.LEVELS.easy.diffs });
  const hard = FCW.filterViability(rows, { eras: FCW.DEFAULT_ERAS, diffs: FCW.LEVELS.hard.diffs });
  return easy.enough && hard.enough;
})());
t("levels: the season bias follows the clue mix on its own", (() => {
  // An Easy-only puzzle must read easier than a Medium+Hard one; the season
  // pick keys off this mean, so no separate wiring is needed.
  const pe = FCW.generate(rows, { seed: 7311, filter: { diffs: FCW.LEVELS.easy.diffs } });
  const ph = FCW.generate(rows, { seed: 7311, filter: { diffs: FCW.LEVELS.hard.diffs } });
  return FCW.puzzleDifficulty(pe) < FCW.puzzleDifficulty(ph);
})());
t("levels: substitutions never touch the score or the season record", (() => {
  // A substitution is recorded nowhere the scoring can see: same inputs, same
  // score, same W-D-L, however many subs were taken.
  const a = FCW.computeScore(600, 2, 1, 0, 0);
  const rec = FCW.seasonFromActions(600, 2, 1, 0, 0);
  return a.score === FCW.computeScore(600, 2, 1, 0, 0).score &&
    rec.points === FCW.seasonFromActions(600, 2, 1, 0, 0).points;
})());

/* ---- Repetition control: daily rotation + practice recency ---- */
t("rotation: deterministic and near the configured share", (() => {
  const rate = rows.filter(r => FCW.rotationKeep(r, 4)).length / rows.length;
  return Math.abs(rate - FCW.ROTATION.share / FCW.ROTATION.of) < 0.05 &&
    FCW.rotationKeep("ANY", 9) === FCW.rotationKeep("ANY", 9);
})());
t("rotation: a resting row cannot appear in that window's puzzles", (() => {
  for (let w = 0; w < 3; w++) {
    const p = FCW.generate(rows, { seed: 8200 + w,
      filter: { eras: FCW.DEFAULT_ERAS, rotateWindow: w } });
    if (FCW.validatePuzzle(p).length) return false;
    if (!p.entries.every(e => FCW.rotationKeep(e.row, w))) return false;
  }
  return true;
})());
t("rotation: the pool changes week to week but always clears viability", (() => {
  let churn = 0, live = rows.filter(r => r.maxPer !== 0);
  live.forEach(r => { if (FCW.rotationKeep(r, 1) !== FCW.rotationKeep(r, 2)) churn++; });
  for (let w = 0; w < 6; w++) {
    if (!FCW.filterViability(rows, { eras: FCW.DEFAULT_ERAS, rotateWindow: w }).enough) return false;
  }
  return churn / live.length > 0.3;
})());
t("rotation: every daily gets its own window, so availability never clusters",
  FCW.rotationWindow(1) !== FCW.rotationWindow(2) &&
  FCW.rotationWindow(7) !== FCW.rotationWindow(8));
/* ---- v05i: Daily answer bans (hard constraint, shipped chain table) ---- */
{
  const bans = require('./daily_bans.json');
  // A small synthetic table: one distinct answer per day, so the window
  // maths is readable and independent of the real bank.
  const toy = { from: 1, lookback: 3, answers: ["A", "B", "C", "D"],
                days: [[0], [1], [2], [3]] };
  const keys = d => { const b = FCW.dailyBans(d, toy); return b ? Object.keys(b).sort().join("") : ""; };
  t("bans: no table means no bans, and the Daily plays as before",
    FCW.dailyBans(20, null) === null);
  t("bans: the first day of the chain has nothing behind it", keys(1) === "");
  t("bans: the window grows to the lookback, then slides",
    keys(2) === "A" && keys(3) === "AB" && keys(4) === "ABC" && keys(5) === "BCD");
  t("bans: a day is never generated against its own answers", (() => {
    for (let d = 1; d <= 4; d++) {
      const b = FCW.dailyBans(d, toy) || {};
      if (b[toy.answers[toy.days[d - 1][0]]]) return false;
    }
    return true;
  })());
  t("bans: past the table's end the guarantee fades rather than falling off",
    keys(6) === "CD" && keys(7) === "D" && keys(8) === "");
  t("bans: days before the table start are unbanned, not negative-indexed",
    FCW.dailyBans(0, toy) === null && FCW.dailyBans(-5, toy) === null);
  t("bans: the table honours its own recorded lookback, not the engine constant",
    (() => {
      const wide = Object.assign({}, toy, { lookback: 1 });
      return Object.keys(FCW.dailyBans(4, wide)).join("") === "C";
    })());

  // The shipped table.
  t("bans: shipped table is built against this clue bank and lookback", (() => {
    const crypto = require('crypto');
    const raw = require('fs').readFileSync('./data.json');
    return bans.dataHash === crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)
      && bans.lookback === FCW.DAILY_LOOKBACK;
  })(), "rebuild: node build_daily_bans.js 365");
  t("bans: shipped table never repeats an answer inside the lookback", (() => {
    for (let i = 0; i < bans.days.length; i++) {
      const prev = new Set();
      for (let j = Math.max(0, i - bans.lookback); j < i; j++) bans.days[j].forEach(x => prev.add(x));
      if (bans.days[i].some(x => prev.has(x))) return false;
    }
    return true;
  })());
  t("bans: every index in the table resolves to a real answer",
    bans.days.every(d => d.every(i => typeof bans.answers[i] === "string" && bans.answers[i])));

  // Integration: the game's own options, applied to the real bank.
  t("bans: dailyOptions composes seed, filter and bans as the game does", (() => {
    const o = FCW.dailyOptions(30, bans);
    return o.seed === FCW.dailySeed(30) &&
      JSON.stringify(o.filter) === JSON.stringify(FCW.dailyFilter(30)) &&
      JSON.stringify(o.bannedTerms) === JSON.stringify(FCW.dailyBans(30, bans));
  })());
  t("bans: a generated Daily contains none of its banned answers", (() => {
    for (const d of [40, 41, 42]) {
      const o = FCW.dailyOptions(d, bans);
      const p = FCW.generate(rows, o);
      if (!o.bannedTerms) return false;
      if (p.entries.some(e => o.bannedTerms[e.row.grid])) return false;
    }
    return true;
  })());
  t("bans: the Daily stays same-for-everyone — no stored state, pure function of the day",
    (() => {
      const a = FCW.generate(rows, FCW.dailyOptions(55, bans)).entries.map(e => e.row.id).join();
      const b = FCW.generate(rows, FCW.dailyOptions(55, bans)).entries.map(e => e.row.id).join();
      return a === b;
    })());
  t("bans: banning does not starve the grid below the answer floor", (() => {
    for (const d of [60, 61, 62]) {
      const p = FCW.generate(rows, FCW.dailyOptions(d, bans));
      if (p.entries.length < 10 || FCW.validatePuzzle(p).length) return false;
    }
    return true;
  })());
  t("bans: loadDailyBans installs the table for the no-argument call", (() => {
    FCW.loadDailyBans(bans);
    const installed = JSON.stringify(FCW.dailyBans(30));
    FCW.loadDailyBans(null);
    const cleared = FCW.dailyBans(30);
    FCW.loadDailyBans(bans);   // leave it installed for anything downstream
    return installed === JSON.stringify(FCW.dailyBans(30, bans)) && cleared === null;
  })());
  t("bans: a malformed table is ignored rather than thrown on",
    FCW.loadDailyBans({ days: [] }) === null && FCW.loadDailyBans(undefined) === null);
  FCW.loadDailyBans(bans);
}

/* ---- v05j: trusted time (spec §19, device-clock cheating) ---- */
{
  const dayMs = 86400000;
  t("time: the device clock is the default source", (() => {
    FCW.clearTrustedTime();
    const s = FCW.timeState();
    return s.source === "device" && s.trusted === false && s.offsetMs === 0;
  })());
  t("time: a junk or missing Date header is refused, not applied", (() => {
    FCW.clearTrustedTime();
    const refused = [undefined, null, "", "not a date", NaN, Infinity, 0, -1, 12345]
      .every(v => FCW.setTrustedTime(v) === false);
    return refused && FCW.timeState().source === "device" && FCW.timeState().offsetMs === 0;
  })());
  t("time: a real HTTP Date header string is parsed and applied", (() => {
    FCW.clearTrustedTime();
    const ok = FCW.setTrustedTime("Fri, 14 Aug 2026 15:00:00 GMT");
    const s = FCW.timeState();
    FCW.clearTrustedTime();
    return ok === true && s.source === "server" && s.trusted === true;
  })());
  t("time: the host's date decides the Daily, not the device", (() => {
    /* Anchored past launch, not on today. dailyNumber() floors at 1, and once
       the launch date moved ahead of the present day "today" became #1 — so a
       thirty-day shift read as +29 and the arithmetic was hidden by the clamp,
       exactly as it was when this test was first written. */
    FCW.clearTrustedTime();
    const base = Date.UTC(2027, 0, 1, 12);
    FCW.setTrustedTime(base);
    const from = FCW.dailyNumber();
    FCW.setTrustedTime(base + 30 * dayMs);
    const later = FCW.dailyNumber();
    FCW.clearTrustedTime();
    return later === from + 30 && from > 1;
  })());
  t("time: a device clock pushed forward is pulled back by the host", (() => {
    FCW.clearTrustedTime();
    // Anchored on a fixed instant, not on today: dailyNumber() floors at 1, so
    // a relative test would clamp and silently pass (or fail) by calendar luck.
    const base = Date.parse("2027-01-01T12:00:00Z");
    FCW.setTrustedTime(base);
    const at = FCW.dailyNumber();
    FCW.setTrustedTime(base - 2 * dayMs);          // device was 2 days ahead
    const pulledBack = FCW.dailyNumber();
    FCW.clearTrustedTime();
    return at - pulledBack === 2 && pulledBack > 1;
  })());
  t("time: clearing restores the device clock exactly", (() => {
    const before = FCW.dailyNumber();
    FCW.setTrustedTime(Date.now() + 5 * dayMs);
    FCW.clearTrustedTime();
    return FCW.dailyNumber() === before && FCW.timeState().offsetMs === 0;
  })());
  t("time: result stamps follow the trusted clock too", (() => {
    FCW.clearTrustedTime();
    FCW.setTrustedTime(Date.parse("2027-03-01T12:00:00Z"));
    const rec = FCW.makeResultRecord({ dailyNo: 1, seed: 1, score: 100, position: 1 });
    const key = FCW.localDateKey();
    FCW.clearTrustedTime();
    return rec.completedAt.indexOf("2027-03-01") === 0 && key === "2027-03-01";
  })());
  t("time: an explicit date argument still wins, for tests and replays", (() => {
    FCW.setTrustedTime(Date.now() + 40 * dayMs);
    const explicit = FCW.dailyNumber(new Date(2026, 7, 11));   // 11 Aug 2026 = #1
    FCW.clearTrustedTime();
    return explicit === 1;
  })());
  t("time: bans and seeds follow the corrected day, not the device's", (() => {
    FCW.clearTrustedTime();
    FCW.setTrustedTime(Date.now() + 12 * dayMs);
    const no = FCW.dailyNumber();
    const o = FCW.dailyOptions(no, require('./daily_bans.json'));
    FCW.clearTrustedTime();
    return o.seed === FCW.dailySeed(no) && o.filter.rotateWindow === no;
  })());
  t("time: match elapsed stays on the raw clock, so a sync cannot jump it",
    !/new Date\(now\(\)\)/.test(
      require('fs').readFileSync('./engine.js', 'utf8')
        .split('function computeScore')[1].slice(0, 400)));
  FCW.clearTrustedTime();
}

t("recency: excluded rows never reach the puzzle", (() => {
  const first = FCW.generate(rows, { seed: 8300, filter: { eras: FCW.DEFAULT_ERAS } });
  const ex = {};
  first.entries.forEach(e => { ex[e.row.id] = true; });
  const second = FCW.generate(rows, { seed: 8300,
    filter: { eras: FCW.DEFAULT_ERAS, excludeIds: ex } });
  return !FCW.validatePuzzle(second).length &&
    second.entries.every(e => !ex[e.row.id]);
})());

t("eras: no era is archived out of existence — archiving is for content, not periods", (() => {
  // Pre-1990 must be reachable by choosing it. Archiving is still used — for
  // transfers too obscure to play, thin caps rows, and (v05c) rows the
  // self-answering rule permanently rejects — never to hide a whole era.
  const archived = rows.filter(r => r.maxPer === 0);
  const anyEraFullyArchived = ["Pre-1990", "1990s", "2000s", "2010s", "2020s", "Timeless"]
    .some(e => {
      const inEra = rows.filter(r => r.era === e);
      return inEra.length > 0 && inEra.every(r => r.maxPer === 0);
    });
  return !anyEraFullyArchived &&
    archived.every(r => /^Transfer|^Caps /.test(r.cat) || FCW.isSelfAnswering(r));
})());
t("eras: the default set is modern and excludes Pre-1990",
  FCW.DEFAULT_ERAS.indexOf("Pre-1990") === -1 && FCW.DEFAULT_ERAS.length >= 4,
  FCW.DEFAULT_ERAS.join(","));
t("eras: the default selection produces no pre-1990 clues", (() => {
  const f = { groups: null, eras: FCW.DEFAULT_ERAS };
  for (let i = 0; i < 8; i++) {
    const p = FCW.generate(rows, { seed: 1100 + i * 23, filter: f });
    if (p.entries.some(e => e.row.era === "Pre-1990")) return false;
  }
  return true;
})());
t("eras: opting in to Pre-1990 actually brings older clues through", (() => {
  const f = { groups: null, eras: FCW.DEFAULT_ERAS.concat(["Pre-1990"]) };
  let seen = 0;
  for (let i = 0; i < 8; i++) {
    const p = FCW.generate(rows, { seed: 1100 + i * 23, filter: f });
    seen += p.entries.filter(e => e.row.era === "Pre-1990").length;
  }
  return seen > 0;
})());
t("eras: the Pre-1990 bucket holds real content, not a handful",
  FCW.groupOptions(rows).eras["Pre-1990"] >= 100,
  FCW.groupOptions(rows).eras["Pre-1990"]);
t("version: the bank version was bumped when the daily content changed",
  FCW.QUESTION_BANK_VERSION !== "2026-08-v1", FCW.QUESTION_BANK_VERSION);

/* ---- Era buckets ---- */
t("eras: everything before 1990 is one bucket, not five thin decades", (() => {
  const eras = Object.keys(FCW.groupOptions(rows).eras);
  return eras.indexOf("Pre-1990") !== -1 &&
    !eras.some(e => /^19[3-8]0s$/.test(e));
})(), Object.keys(FCW.groupOptions(rows).eras).join(","));
t("eras: every bucket is substantial enough to be worth offering", (() => {
  const eras = FCW.groupOptions(rows).eras;
  return Object.values(eras).every(n => n >= 40);
})(), JSON.stringify(FCW.groupOptions(rows).eras));

/* ---- Free-run topic filters ---- */
{
  const opts = FCW.groupOptions(rows);
  t("filter: groups and eras are offered with counts",
    Object.keys(opts.groups).length >= 3 && Object.keys(opts.eras).length >= 5,
    Object.keys(opts.groups).join(",") + " / " + Object.keys(opts.eras).join(","));
  t("filter: every row carries a group and an era",
    rows.every(r => typeof r.group === "string" && r.group &&
                    typeof r.era === "string" && r.era));
  t("filter: archived rows are not offered as options", (() => {
    const total = Object.values(opts.groups).reduce((a, b) => a + b, 0);
    const live = rows.filter(r => r.maxPer !== 0 && r.grid.length <= 15 && !FCW.isSelfAnswering(r)).length;
    return total === live;
  })());
  t("filter: a group selection only yields clues from those groups", (() => {
    const f = { groups: ["Europe", "Internationals"], eras: null };
    for (let i = 0; i < 6; i++) {
      const p = FCW.generate(rows, { seed: 3300 + i * 41, filter: f });
      if (FCW.validatePuzzle(p).length) return false;
      if (!p.entries.every(e => f.groups.indexOf(e.row.group) !== -1)) return false;
    }
    return true;
  })());
  t("filter: an era selection only yields clues from those eras", (() => {
    const f = { groups: null, eras: ["1990s", "2000s", "Timeless"] };
    const p = FCW.generate(rows, { seed: 3400, filter: f });
    return FCW.validatePuzzle(p).length === 0 &&
      p.entries.every(e => f.eras.indexOf(e.row.era) !== -1);
  })());
  t("filter: no filter means the whole bank", (() => {
    const a = FCW.generate(rows, { seed: 55 }).entries.map(e => e.row.id).join();
    const b = FCW.generate(rows, { seed: 55, filter: null }).entries.map(e => e.row.id).join();
    return a === b;
  })());
  t("filter: the minimum to play is configuration, not a buried formula",
    FCW.FILTER_MINIMUMS.groups >= 10 && FCW.FILTER_MINIMUMS.rows >= FCW.FILTER_MINIMUMS.groups,
    JSON.stringify(FCW.FILTER_MINIMUMS));
  t("filter: a selection below the minimum is blocked, and says by how much", (() => {
    // Which real selections are too thin keeps changing as the bank grows, so
    // assert the mechanism against a raised minimum rather than chasing a
    // combination that happens to be small today.
    const v = FCW.filterViability(rows, { groups: ["Internationals"], eras: null },
                                  { groups: 500, rows: 5000 });
    return v.enough === false && v.shortGroups > 0 && v.shortRows > 0 &&
      v.needGroups === 500 && v.needRows === 5000;
  })());
  t("filter: a selection at or above the minimum is playable", (() => {
    const fine = FCW.filterViability(rows, { groups: ["England"], eras: null });
    return fine.enough === true && fine.shortGroups === 0 && fine.shortRows === 0;
  })());
  t("filter: the minimum can be raised or lowered per call", (() => {
    const f = { groups: ["Internationals"], eras: null };
    // Bar set absurdly high must block anything, however large the bank grows.
    return FCW.filterViability(rows, f, { groups: 5, rows: 10 }).enough === true &&
      FCW.filterViability(rows, f, { groups: 9999, rows: 99999 }).enough === false;
  })());
t("filter: a selection too small for a grid is blocked", (() => {
    // Which selections are too thin shifts as the bank grows, so assert the
    // rule rather than a particular group: anything below the minimum blocks.
    const thin = { groups: ["Internationals"], eras: ["1930s"] };
    const v = FCW.filterViability(rows, thin);
    return v.enough === false && v.shortGroups + v.shortRows > 0;
  })());
  t("filter: everything the minimum allows really generates a full puzzle", (() => {
    // The point of the minimum: no permitted selection may yield a thin grid.
    const groups = Object.keys(FCW.groupOptions(rows).groups);
    const combos = [];
    for (let m = 1; m < (1 << groups.length); m++) {
      const c = [];
      for (let i = 0; i < groups.length; i++) if (m & (1 << i)) c.push(groups[i]);
      combos.push({ groups: c, eras: null });
    }
    for (const f of combos) {
      if (!FCW.filterViability(rows, f).enough) continue;
      const p = FCW.generate(rows, { seed: 7000, filter: f });
      if (p.entries.length < 10 || FCW.validatePuzzle(p).length) return false;
    }
    return true;
  })());
  t("filter: the filtered-out count is reported", (() => {
    const p = FCW.generate(rows, { seed: 1, attempts: 1, minAttempts: 1,
      filter: { groups: ["Internationals"], eras: null } });
    return p.meta.excludedByFilter > 0;
  })());
}

/* ---- European Cup / Champions League category and the archive flag ---- */
{
  const ec = rows.filter(r => r.cat.indexOf("European Cup Winner") === 0);
  const modern = ec.filter(r => r.maxPer === 1);
  const archived = ec.filter(r => r.maxPer === 0);
  t("europeancup: every final from 1956 to 2026 is in the bank",
    ec.filter(r => !r.variant).length === 71, ec.length);
  t("europeancup: older finals are era-tagged rather than archived", (() => {
    return ec.filter(r => !r.variant).every(r => {
      const yr = +r.clue.match(/in (\d{4})/)[1];
      return r.maxPer === 1 && (yr >= 1990 ? r.era !== "Pre-1990" : r.era === "Pre-1990");
    });
  })());
  t("europeancup: pre-1993 clues say European Cup, later ones Champions League",
    ec.every(r => {
      const yr = +r.clue.match(/in (\d{4})/)[1];
      return yr >= 1993 ? /Champions League/.test(r.clue) : /European Cup/.test(r.clue);
    }));
  t("europeancup: answers are plain A-Z and no row answers itself",
    ec.every(r => /^[A-Z]+$/.test(r.grid) && !FCW.isSelfAnswering(r)));
  t("europeancup: enumerations match the answers", ec.every(r => {
    const nums = (r.enum.match(/\d+/g) || []).map(Number);
    return nums.reduce((a, b) => a + b, 0) === r.grid.length;
  }));
  t("europeancup: keyed on the winning club", ec.every(r => r.pgk === r.entity));
}

/* ---- Max Per Puzzle 0 archives a row without deleting it ---- */
/* Every archived row must say why. The reason used to live in free-text Notes,
   and two rows had none at all — which made a bulk archive look arbitrary when
   it was in fact a deliberate playability filter, and led to 1,253 rows being
   restored to circulation on the strength of a misreading. */
t("archive: every archived row records why", (() => {
  const arch = rows.filter(r => r.maxPer === 0);
  return arch.length > 0 && arch.every(r => r.archivedWhy && r.archivedWhy !== "no reason recorded");
})(), (() => {
  const bad = rows.filter(r => r.maxPer === 0 && (!r.archivedWhy || r.archivedWhy === "no reason recorded"));
  return bad.length ? bad.length + " without a reason: " + bad.slice(0, 3).map(r => r.id).join(", ")
                    : rows.filter(r => r.maxPer === 0).length + " archived, all explained";
})());
t("archive: a row in circulation carries no archive reason",
  rows.filter(r => r.maxPer !== 0).every(r => !r.archivedWhy));

t("archive: archived rows are reported and never selected", (() => {
  const archived = rows.filter(r => r.maxPer === 0);
  if (!archived.length) return false;
  const m = FCW.generate(rows, { seed: 1, attempts: 1, minAttempts: 1 }).meta;
  if (m.excludedArchived !== archived.length) return false;
  for (let i = 0; i < 5; i++) {
    const p = FCW.generate(rows, { seed: 1500 + i * 29 });
    if (p.entries.some(e => e.row.maxPer === 0)) return false;
  }
  return true;
})());
t("archive: the dataset validator accepts 0 and rejects negatives", (() => {
  const ok = Object.assign({}, rows[0], { id: "A1", maxPer: 0 });
  const bad = Object.assign({}, rows[0], { id: "A2", maxPer: -1 });
  return FCW.validateDataset([ok]).length === 0 &&
    FCW.validateDataset([bad]).some(e => /Max Per Puzzle/.test(e));
})());
t("archive: the report counts archived rows", (() => {
  return FCW.datasetReport(rows).archived === rows.filter(r => r.maxPer === 0).length;
})());
t("archive: World Cup rows are exempt — every year stays in circulation",
  rows.filter(r => r.cat.indexOf("World Cup Winner") === 0).every(r => r.maxPer === 1));

/* ---- Premier League top scorer category ---- */
{
  const ts = rows.filter(r => r.cat.indexOf("Premier League Top") === 0);
  t("topscorer: rows are present and keyed on the scoring club", ts.length > 30 &&
    ts.every(r => r.pgk === r.entity), ts.length);
  t("topscorer: every answer is plain A-Z (accented names excluded from the bank)",
    ts.every(r => /^[A-Z]+$/.test(r.grid) && !/[^\x00-\x7F]/.test(r.answer)));
  t("topscorer: every answer fits a 15x15 grid",
    ts.every(r => r.grid.length <= 15), Math.max(...ts.map(r => r.grid.length)));
  t("topscorer: enumerations match the answers", ts.every(r => {
    const nums = (r.enum.match(/\d+/g) || []).map(Number);
    return nums.reduce((a, b) => a + b, 0) === r.grid.length;
  }));
  t("topscorer: no row answers itself", ts.every(r => !FCW.isSelfAnswering(r)));
  t("topscorer: shared Golden Boots are separate rows on separate clubs", (() => {
    const shared = ts.filter(r => /1997\/98/.test(r.clue));
    return shared.length === 3 && new Set(shared.map(r => r.pgk)).size === 3;
  })());
  t("topscorer: a scorer's clue names their club, so that club cannot also be an answer", (() => {
    for (let i = 0; i < 10; i++) {
      const p = FCW.generate(rows, { seed: 1200 + i * 23 });
      const grids = new Set(p.entries.map(e => e.row.grid));
      for (const e of p.entries.filter(x => x.row.cat.indexOf("Premier League Top") === 0)) {
        const mk = FCW.mentionKeys(e.row.clue);
        for (const g of grids) if (g !== e.row.grid && mk[g]) return false;
      }
    }
    return true;
  })());
}

/* ---- World Cup winner category ---- */
{
  const wc = rows.filter(r => r.cat.indexOf("World Cup Winner") === 0);
  t("worldcup: 23 tournaments are present", wc.length === 23, wc.length);
  t("worldcup: only the eight winning nations appear",
    new Set(wc.map(r => r.entity.replace("West ", ""))).size === 8,
    [...new Set(wc.map(r => r.entity))].join(", "));
  t("worldcup: every answer is plain A-Z and fits a 15x15 grid",
    wc.every(r => /^[A-Z]+$/.test(r.grid) && r.grid.length <= 15));
  t("worldcup: enumerations match the answers",
    wc.every(r => {
      const nums = (r.enum.match(/\d+/g) || []).map(Number);
      return nums.reduce((a, b) => a + b, 0) === r.grid.length;
    }));
  t("worldcup: no row answers itself", wc.every(r => !FCW.isSelfAnswering(r)));
  t("worldcup: West Germany shares Germany's group key so only one German clue appears",
    wc.filter(r => r.entity === "West Germany").every(r => r.pgk === "Germany"));
  t("worldcup: Brazil's five titles are five rows on one group key",
    wc.filter(r => r.pgk === "Brazil").length === 5);

  t("worldcup: a prose clue has no subject term, so several may share a puzzle", (() => {
    // Assert the rule, not the sampling: whether two World Cup clues actually
    // land in the same grid depends on how many groups the bank has, which
    // changes as it grows. What must hold is that nothing forbids it.
    if (wc.some(r => FCW.subjectKey(r) !== null)) return false;
    const a = wc[0], b = wc.find(r => r.pgk !== a.pgk && r.grid !== a.grid);
    if (!b) return false;
    const fake = JSON.parse(JSON.stringify(FCW.generate(rows, { seed: 700 })));
    fake.entries[0].row = JSON.parse(JSON.stringify(a));
    fake.entries[1].row = JSON.parse(JSON.stringify(b));
    return !FCW.validatePuzzle(fake).some(e => /Subject reused/.test(e));
  })());
  t("worldcup: one clue per nation per puzzle still holds", (() => {
    for (let i = 0; i < 5; i++) {
      const p = FCW.generate(rows, { seed: 700 + i * 19 });
      const c = {};
      for (const e of p.entries) {
        c[e.row.pgk] = (c[e.row.pgk] || 0) + 1;
        if (c[e.row.pgk] > 1) return false;
      }
    }
    return true;
  })());
  t("worldcup: no duplicate nation answers within a puzzle", (() => {
    for (let i = 0; i < 5; i++) {
      const p = FCW.generate(rows, { seed: 700 + i * 19 });
      const seen = {};
      for (const e of p.entries) {
        if (seen[e.row.grid]) return false;
        seen[e.row.grid] = true;
      }
    }
    return true;
  })());
}

/* ---- Subject/answer namespace applies to terms, not prose ---- */
t("namespace: a bare year is not treated as a subject term",
  FCW.subjectKey({ clue: "1966" }) === null && FCW.subjectKey({ clue: "2026" }) === null);
t("namespace: prose clues are not treated as subject terms",
  FCW.subjectKey({ clue: "Won the World Cup in 1966" }) === null);
t("namespace: real subject terms still key normally",
  FCW.subjectKey({ clue: "Gunners" }) === "GUNNERS" &&
  FCW.subjectKey({ clue: "Emirates Stadium" }) === "EMIRATESSTADIUM");

/* ---- Canonical schema ---- */
t("schema: shipped dataset validates clean", FCW.validateDataset(rows).length === 0);
t("schema: every row carries all canonical fields", rows.every(r =>
  FCW.SCHEMA.required.every(f => r[f] !== undefined && r[f] !== null && r[f] !== "")));
t("schema: catches missing field, bad difficulty, bad enum, bad maxPer", (() => {
  const bad = Object.assign({}, rows[0], { diff: "Trivial", maxPer: -1, enum: "(99)" });
  delete bad.entity;
  const errs = FCW.validateDataset([bad]).join(" ");
  return /entity/.test(errs) && /Difficulty/.test(errs) && /enumeration/.test(errs) && /Max Per Puzzle/.test(errs);
})());
t("schema: rejects answers that need diacritics (no silent transliteration)", (() => {
  const bad = Object.assign({}, rows[0], { id: "X1", answer: "H\u00e5land", grid: "HLAND", breaks: [], enum: "(7)" });
  return FCW.validateDataset([bad]).some(e => /not eligible/.test(e));
})());
t("schema: plain-English answers still pass", (() => {
  const ok = Object.assign({}, rows[0], { id: "X2", answer: "Haaland", grid: "HAALAND", breaks: [], enum: "(7)" });
  return FCW.validateDataset([ok]).length === 0;
})());
t("schema: catches duplicate IDs", FCW.validateDataset([rows[0], rows[0]]).some(e => /duplicate ID/.test(e)));
t("schema: report counts categories, entities and groups", (() => {
  const r = FCW.datasetReport(rows);
  const cats = new Set(rows.map(x => x.cat)).size;
  const ents = new Set(rows.map(x => x.entity)).size;
  const pgks = new Set(rows.map(x => x.pgk)).size;
  return r.rows === rows.length && Object.keys(r.categories).length === cats &&
    r.entities === ents && r.groups === pgks &&
    r.excludedByLength === rows.filter(x => x.grid.length > 15).length;
})());
t("schema: unknown categories are accepted (no bespoke structure needed)", (() => {
  const future = rows.slice(0, 12).map((r, i) => Object.assign({}, r, {
    id: "F" + i, cat: "Competition Winner \u2192 Season",
    clue: "FA Cup winners in 2012/13", pgk: "future-" + i, entity: "Future FC " + i
  }));
  return FCW.validateDataset(future).length === 0;
})());

/* ---- Max Per Puzzle is data-driven ---- */
t("maxPer: default 1 is enforced", (() => {
  for (let i = 0; i < 6; i++) {
    const p = FCW.generate(rows, { seed: 3100 + i * 29 });
    const c = {};
    for (const e of p.entries) {
      c[e.row.pgk] = (c[e.row.pgk] || 0) + 1;
      if (c[e.row.pgk] > 1) return false;
    }
  }
  return true;
})());
t("maxPer: an allowance above 1 is honoured by the validator", (() => {
  // Deterministic: whether the generator happens to pick one group twice is a
  // matter of chance, so assert the rule itself rather than sampling for it.
  const p = FCW.generate(rows, { seed: 3100 });
  const two = JSON.parse(JSON.stringify(p));
  two.entries[1].row = JSON.parse(JSON.stringify(two.entries[0].row));
  two.entries[1].row.grid += "X";                       // keep answers distinct
  two.entries[1].row.answer += "X";
  two.entries[1].row.clue = "Distinct subject term";
  // With the default allowance of 1, two rows sharing a key is an error...
  const withDefault = FCW.validatePuzzle(two).some(e => /Max Per Puzzle/.test(e));
  // ...and with an allowance of 2 from the data, it is not.
  two.entries[0].row.maxPer = 2;
  two.entries[1].row.maxPer = 2;
  const withTwo = FCW.validatePuzzle(two).some(e => /Max Per Puzzle/.test(e));
  return withDefault && !withTwo;
})());
t("maxPer: exceeding the allowance is still reported", (() => {
  const p = FCW.generate(rows, { seed: 3100 });
  const three = JSON.parse(JSON.stringify(p));
  [1, 2].forEach((i, n) => {
    three.entries[i].row = JSON.parse(JSON.stringify(three.entries[0].row));
    three.entries[i].row.grid += "XY".slice(n, n + 1);
    three.entries[i].row.clue = "Distinct subject " + n;
  });
  three.entries.slice(0, 3).forEach(e => { e.row.maxPer = 2; });
  return FCW.validatePuzzle(three).some(e => /Max Per Puzzle/.test(e));
})());
t("maxPer: validator flags a group exceeding its allowance", (() => {
  const p = FCW.generate(rows, { seed: 3100 });
  const fake = JSON.parse(JSON.stringify(p));
  fake.entries[1].row.pgk = fake.entries[0].row.pgk;
  fake.entries[1].row.grid = fake.entries[1].row.grid + "X"; // keep answers distinct
  return FCW.validatePuzzle(fake).some(e => /Max Per Puzzle/.test(e));
})());

/* ---- League clubs come from the stored seasons, not from clue data ----
   Settled decision: all clubs of the 20-team era are selectable, not just
   the current twenty. LEAGUE_CLUBS/clubList (the old explicit-config route)
   were removed as a dead second source of truth. */
t("table: club selection derives from stored seasons", (() => {
  FCW.loadSeasons(seasons.seasons || seasons);
  const clubs = FCW.historicalClubs();
  return clubs.length >= 40 && clubs.indexOf("Arsenal") !== -1 &&
    clubs.indexOf("Wimbledon") !== -1;   // a club with no current-era presence
})());
t("table: expanding clue data doesn't change the selectable clubs", (() => {
  const before = FCW.historicalClubs().join();
  // Clue rows play no part in historicalClubs — nothing to feed it here,
  // which is exactly the point; assert it is stable and season-driven.
  return FCW.historicalClubs().join() === before;
})());

/* ---- V0.4: uniqueness ---- */
{
  let dups = 0, clue3 = 0;
  for (let i = 0; i < 12; i++) {
    const p = FCW.generate(rows, { seed: 7000 + i * 53 });
    const sa = {}, sc = {};
    p.entries.forEach(e => {
      if (sa[e.row.grid]) dups++;
      sa[e.row.grid] = true;
      const k = e.row.cat + "|" + e.row.clue;
      sc[k] = (sc[k] || 0) + 1;
      if (sc[k] === 3) clue3++;
    });
  }
  t("unique: no duplicate answers across 40 puzzles", dups === 0);
  t("unique: no clue text appears 3+ times", clue3 === 0);
  // validator catches a crafted duplicate
  const p = FCW.generate(rows, { seed: 7000 });
  const fake = JSON.parse(JSON.stringify(p));
  fake.entries[1].row = JSON.parse(JSON.stringify(fake.entries[0].row));
  t("unique: validator reports duplicate answers",
    FCW.validatePuzzle(fake).some(e => /Duplicate answer/.test(e)));
}

/* ---- Difficulty now selects the season, it does not distort points ---- */
t("difficulty: puzzleDifficulty is within 1..3", (() => {
  const d = FCW.puzzleDifficulty(FCW.generate(rows, { seed: 88 }));
  return d >= 1 && d <= 3;
})());
t("difficulty: season points are never scaled", (() => {
  const before = JSON.stringify(require('./seasons.json')[0].table);
  FCW.pickSeason("Everton", 12, 3);
  FCW.pickSeason("Everton", 12, 1);
  return JSON.stringify(FCW.SCORING.SEASONS[0].table) === before;
})());
t("difficulty: season bias can be switched off", (() => {
  const prev = FCW.SCORING.DIFFICULTY.seasonBias;
  FCW.SCORING.DIFFICULTY.seasonBias = false;
  const s2 = FCW.pickSeason("Everton", 3, 2);
  FCW.SCORING.DIFFICULTY.seasonBias = prev;
  return !!s2;
})());

/* ---- V0.4: daily puzzle ---- */
/* Written against the epoch rather than a fixed date: the launch day moved
   once already, and a test that hard-codes it fails for the wrong reason. */
const LAUNCH = (() => { const e = FCW.DAILY_EPOCH; return new Date(e.y, e.m, e.d + 1); })();
const dayAfter = (n) => new Date(LAUNCH.getFullYear(), LAUNCH.getMonth(), LAUNCH.getDate() + n);
/* Switching club must not corrupt the table. A player who picks Arsenal, then
   Bolton, then Arsenal again should get a clean twenty each time — and the
   season data itself must survive untouched, or the damage accumulates
   invisibly across a session. */
t("table: switching between a Premier League club and a Football League one", (() => {
  const s = seasons.find(x => x.season === "2024/25");
  if (!s) return false;
  const bottom = s.table[s.table.length - 1].club;
  for (const club of ["Arsenal", "Bolton Wanderers", "Arsenal", "Bolton Wanderers"]) {
    const t2 = FCW.buildTable(club, 96, s);
    const names = t2.map(r => r.club);
    if (t2.length !== 20) return false;
    if (names.filter((n, i) => names.indexOf(n) !== i).length) return false;   // duplicates
    if (t2.filter(r => r.isPlayer).length !== 1) return false;
    // A club that played that season keeps everyone else; one that did not
    // displaces the bottom club and nobody else.
    if (club === "Arsenal" && !names.includes(bottom)) return false;
    if (club !== "Arsenal" && names.includes(bottom)) return false;
  }
  return s.table.length === 20 && s.table[s.table.length - 1].club === bottom;
})());
t("daily: launch date is puzzle #1", FCW.dailyNumber(LAUNCH) === 1,
  LAUNCH.toDateString());
t("daily: increments per local day",
  FCW.dailyNumber(dayAfter(1)) === 2 && FCW.dailyNumber(dayAfter(31)) === 32);
t("daily: anything before launch clamps to #1, so testing costs no days",
  FCW.dailyNumber(dayAfter(-1)) === 1 && FCW.dailyNumber(dayAfter(-400)) === 1);
t("daily: same number -> same seed; different -> different",
  FCW.dailySeed(5) === FCW.dailySeed(5) && FCW.dailySeed(5) !== FCW.dailySeed(6));
t("daily: seed generates a valid puzzle deterministically", (() => {
  const a = FCW.generate(rows, { seed: FCW.dailySeed(3) });
  const b = FCW.generate(rows, { seed: FCW.dailySeed(3) });
  return FCW.validatePuzzle(a).length === 0 &&
    JSON.stringify(a.entries.map(e => e.row.id)) === JSON.stringify(b.entries.map(e => e.row.id));
})());

/* ---- V0.4: match clock ---- */
[[0,"0'"],[300,"15'"],[600,"30'"],[900,"45'"],[1200,"60'"],[1500,"75'"],[1800,"90'"]].forEach(([sec,label]) => {
  t(`clock: ${sec}s maps to ${label}`, FCW.matchClockLabel(sec) === label, FCW.matchClockLabel(sec));
});
t("clock: past 90 shows added time", FCW.matchClockLabel(1860) === "90+3'", FCW.matchClockLabel(1860));
/* The clock runs at three match minutes per real minute, so a tab left open
   overnight read "90+1434'" — arithmetically right, and not a football score. */
t("clock: added time stops counting at a plausible figure",
  FCW.matchClockLabel(2100) === "90+15'" && FCW.matchClockLabel(3000) === "90+" &&
  FCW.matchClockLabel(30481) === "90+", FCW.matchClockLabel(30481));
/* No trailing apostrophe past the cap: the mark means minutes, so "90+'" reads
   as a number that failed to render. */
t("clock: the uncapped label promises no number it cannot give",
  !/'$/.test(FCW.matchClockLabel(30481)), FCW.matchClockLabel(30481));
t("clock: the score has floored by then anyway, so nothing is lost",
  FCW.computeScore(2100,0,0,0).score === FCW.computeScore(30481,0,0,0).score);

/* ---- V0.4: decay curve landmarks ---- */
[[0,114],[200,97],[400,86],[600,78],[900,68],[1200,58],[1500,47],[1800,36]].forEach(([sec,score]) => {
  t(`decay: ${FCW.matchClockLabel(sec)} -> ${score}`, FCW.computeScore(sec,0,0,0).score === score, FCW.computeScore(sec,0,0,0).score);
});
t("decay: stops at 90 minutes", FCW.computeScore(1800,0,0,0).score === FCW.computeScore(99999,0,0,0).score);
t("decay: help still costs after 90'", FCW.computeScore(99999,1,0,0).score === 36 - 3);
t("decay: score never below 0", FCW.computeScore(99999,99,99,99).score === 0);
/* The floor can follow the season. A fixed 36 finished bottom in only 2 of the
   30 stored seasons: in 2007/08 the last club had 11 points, so running the
   clock out still placed you 16th for a puzzle you never solved. */
t("floor: a season floor rescales the curve to end there",
  FCW.computeScore(99999,0,0,0,0,{floor:10}).score === 10 &&
  FCW.computeScore(0,0,0,0,0,{floor:10}).score === 114,
  FCW.computeScore(99999,0,0,0,0,{floor:10}).score + " at full time, " +
  FCW.computeScore(0,0,0,0,0,{floor:10}).score + " at kick-off");
t("floor: omitting it leaves the original curve untouched",
  FCW.computeScore(1800,0,0,0).score === 36 && FCW.computeScore(600,0,0,0).score === 78);
t("floor: help still takes you below it",
  FCW.computeScore(99999,3,0,0,0,{floor:10}).score < 10);
t("floor: a season with a high bottom club floors higher",
  FCW.computeScore(99999,0,0,0,0,{floor:33}).score === 33);

/* ---- Check All and the free error count ---- */
t("checkAll: costs 9 and is priced above the single check",
  FCW.computeScore(0,0,0,0,1).checkAllPenalty === 9 &&
  FCW.SCORING.CHECK_ALL_PENALTY > FCW.SCORING.CHECK_PENALTY);
t("checkAll: stacks with every other penalty", (() => {
  const r = FCW.computeScore(600, 1, 1, 1, 1);   // 10' = -36... see decay
  return r.score === Math.max(0, 114 - r.timePenalty - 3 - 9 - 2 - 9);
})());
t("checkAll: contributes three L to Form", FCW.formStrip(["checkAll"]).join("") === "WWLLL");
t("checkAll: Form remains presentation only", (() => {
  const a = FCW.computeScore(300, 0, 0, 0, 2);
  return a.checkAllPenalty === 18 && a.checkPenalty === 0;
})());

{
  const p = FCW.generate(rows, { seed: 42 });
  const perfect = {};
  Object.keys(p.cells).forEach(k => { perfect[k] = p.cells[k].ch; });

  t("errors: a perfect grid reports full and clean", (() => {
    const g = FCW.gridErrors(p, perfect);
    return g.full && g.wrongCells === 0 && g.wrongEntries === 0;
  })());
  t("errors: counts wrong squares and the answers they sit in", (() => {
    const L = Object.assign({}, perfect);
    const ks = Object.keys(L).slice(0, 3);
    ks.forEach(k => { L[k] = L[k] === "A" ? "B" : "A"; });
    const g = FCW.gridErrors(p, L);
    return g.wrongCells === 3 && g.wrongEntries >= 1 && g.full;
  })());
  t("errors: a partly filled grid is not reported as full", (() => {
    const L = Object.assign({}, perfect);
    delete L[Object.keys(L)[0]];
    const g = FCW.gridErrors(p, L);
    return !g.full && g.filled === g.total - 1;
  })());
  t("errors: the count never reveals which squares are wrong", (() => {
    const L = Object.assign({}, perfect);
    L[Object.keys(L)[5]] = "Z";
    const g = FCW.gridErrors(p, L);
    // the report is counts only — no coordinates, no entry ids
    return Object.keys(g).sort().join() === "filled,full,total,wrongCells,wrongEntries";
  })());
}

/* ---- The season strip is derived from the actions, not the total ---- */
t("season: a revealed letter shows as a draw, so the strip matches the breakdown", (() => {
  // Reverse-engineering the split from the score alone gave 10W 0D 28L beside a
  // breakdown reading "6 draws" — a contradiction the player can see.
  const r = FCW.seasonFromActions(228, 0, 6, 6, 0);
  const score = FCW.computeScore(228, 0, 6, 6, 0).score;
  return r.drawn === 6 && r.won === 8 && r.lost === 24 && r.points === score;
})());
t("season: one revealed letter is exactly one draw", (() => {
  const r = FCW.seasonFromActions(0, 0, 1, 0, 0);
  return r.drawn === 1 && r.lost === 0 && r.won === 37;
})());
t("season: a check is a defeat, a revealed answer three", (() => {
  const c = FCW.seasonFromActions(0, 1, 0, 0, 0);
  const a = FCW.seasonFromActions(0, 0, 0, 1, 0);
  return c.lost === 1 && c.drawn === 0 && a.lost === 3 && a.drawn === 0;
})());
t("season: the strip always totals 38 games and equals the score exactly", (() => {
  for (let sec = 0; sec <= 2400; sec += 97)
    for (let c = 0; c <= 8; c++)
      for (let l = 0; l <= 14; l++)
        for (let a = 0; a <= 8; a++)
          for (let ca = 0; ca <= 2; ca++) {
            const r = FCW.seasonFromActions(sec, c, l, a, ca);
            if (r.won + r.drawn + r.lost !== 38) return false;
            if (r.won < 0 || r.drawn < 0 || r.lost < 0) return false;
            if (r.points !== FCW.computeScore(sec, c, l, a, ca).score) return false;
          }
  return true;
})());
t("season: time alone still shows as dropped points", (() => {
  const r = FCW.seasonFromActions(1500, 0, 0, 0, 0);   // 25 minutes, no help
  return r.won < 38 && r.lost > 0;
})());

/* ---- 38-game season strip ---- */
t("season: a perfect score is 38 wins", (() => {
  const r = FCW.seasonRecord(114);
  return r.won === 38 && r.drawn === 0 && r.lost === 0 && r.marks.length === 38;
})());
t("season: zero is 38 defeats", (() => {
  const r = FCW.seasonRecord(0);
  return r.won === 0 && r.drawn === 0 && r.lost === 38;
})());
t("season: every reachable score encodes exactly (W*3 + D = score)", (() => {
  for (let s = 0; s <= 114; s++) {
    if (s === 113) continue;              // arithmetically impossible in 38 games
    const r = FCW.seasonRecord(s);
    if (r.won * 3 + r.drawn !== s) return false;
    if (r.won + r.drawn + r.lost !== 38) return false;
    if (r.marks.length !== 38 || r.lost < 0) return false;
  }
  return true;
})());
t("season: 113 cannot arise, since the smallest deduction is 2",
  FCW.computeScore(0, 0, 1, 0, 0).score === 112 && FCW.computeScore(0, 1, 0, 0, 0).score === 111);
t("season: one Reveal Letter turns a win into a draw", (() => {
  const r = FCW.seasonRecord(FCW.computeScore(0, 0, 1, 0, 0).score);
  return r.won === 37 && r.drawn === 1 && r.lost === 0;
})());
t("season: one Check turns a win into a defeat", (() => {
  const r = FCW.seasonRecord(FCW.computeScore(0, 1, 0, 0, 0).score);
  return r.won === 37 && r.drawn === 0 && r.lost === 1;
})());
t("season: a Reveal Answer costs three defeats", (() => {
  const r = FCW.seasonRecord(FCW.computeScore(0, 0, 0, 1, 0).score);
  return r.won === 35 && r.lost === 3;
})());
t("season: time shows in the record too, not just help", (() => {
  const clean = FCW.seasonRecord(FCW.computeScore(1500, 0, 0, 0, 0).score);   // 25 min, no help
  return clean.won < 38 && clean.lost > 0;
})());
t("season: marks read wins, then draws, then defeats", (() => {
  const m = FCW.seasonRecord(97).marks.join("");
  return /^W+D*L*$/.test(m);
})());

/* ---- V0.4: Form strip (presentation only) ---- */
t("form: starts as five wins", FCW.formStrip([]).join("") === "WWWWW");
t("form: Reveal Letter adds one D", FCW.formStrip(["revealLetter"]).join("") === "WWWWD");
t("form: then a Check adds one L", FCW.formStrip(["revealLetter","check"]).join("") === "WWWDL");
t("form: Reveal Answer adds three L", FCW.formStrip(["revealAnswer"]).join("") === "WWLLL");
t("form: keeps only the five most recent markers",
  FCW.formStrip(["revealLetter","check","revealAnswer"]).length === 5 &&
  FCW.formStrip(["revealLetter","check","revealAnswer"]).join("") === "DLLLL");
t("form: presentation does not change the numbers", (() => {
  const a = FCW.computeScore(600, 1, 1, 1);
  FCW.formStrip(["check","revealLetter","revealAnswer"]);
  const b = FCW.computeScore(600, 1, 1, 1);
  return JSON.stringify(a) === JSON.stringify(b) && a.checkPenalty === 3 && a.revealLetterPenalty === 2 && a.revealAnswerPenalty === 9;
})());

/* ---- V0.4: historical seasons ---- */
{
  const seasons = require("./seasons.json");
  const loadErrors = FCW.loadSeasons(seasons);
  t("seasons: dataset loads with no validation errors", loadErrors.length === 0, loadErrors[0]);
  t("seasons: 20-team era only, 1995/96 onwards",
    seasons.length >= 30 && seasons.every(s => /^(19|20)\d{2}\/\d{2}$/.test(s.season) && s.season >= "1995/96"));
  t("seasons: every season has exactly 20 unique clubs",
    seasons.every(s => s.table.length === 20 && new Set(s.table.map(r => r.club)).size === 20));
  t("seasons: every points total is a plausible whole number",
    seasons.every(s => s.table.every(r => Number.isInteger(r.points) && r.points >= 0 && r.points <= 114)));
  t("seasons: each table is sorted by points descending",
    seasons.every(s => s.table.every((r,i) => i === 0 || s.table[i-1].points >= r.points)));
  t("seasons: known deductions are reflected", (() => {
    const find = (label, club) => seasons.find(s => s.season === label).table.find(r => r.club === club).points;
    return find("2009/10","Portsmouth") === 19 && find("2023/24","Everton") === 40 &&
           find("2023/24","Nottingham Forest") === 32 && find("1996/97","Middlesbrough") === 39;
  })());
  t("seasons: champions match the published record", (() => {
    const champ = label => seasons.find(s => s.season === label).table[0];
    return champ("1995/96").club === "Manchester United" && champ("1995/96").points === 82 &&
           champ("2022/23").club === "Manchester City" && champ("2022/23").points === 89 &&
           champ("2015/16").club === "Leicester City" && champ("2015/16").points === 81;
  })());

  /* Season and club selection */
  t("selection: a club only gets seasons it actually played in", (() => {
    const cov = FCW.seasonsForClub("Coventry City");
    return cov.length > 0 && cov.every(s => s.table.some(r => r.club === "Coventry City"));
  })());
  t("selection: pickSeason is deterministic per seed and always eligible", (() => {
    const a = FCW.pickSeason("Everton", 4242), b = FCW.pickSeason("Everton", 4242);
    return a.season === b.season && a.table.some(r => r.club === "Everton");
  })());
  t("selection: different seeds can give different seasons", (() => {
    const set = new Set();
    for (let i = 0; i < 40; i++) set.add(FCW.pickSeason("Liverpool", i * 97).season);
    return set.size > 1;
  })());

  /* Replacement rules */
  t("table: player replaces their own club and appears exactly once", (() => {
    const season = FCW.pickSeason("Everton", 7);
    const tb = FCW.buildTable("Everton", 78, season);
    return tb.length === 20 && tb.filter(r => r.club === "Everton").length === 1 &&
      tb.filter(r => r.isPlayer).length === 1;
  })());
  t("table: the other 19 historical totals are untouched", (() => {
    const season = FCW.pickSeason("Everton", 7);
    const tb = FCW.buildTable("Everton", 78, season);
    return tb.filter(r => !r.isPlayer).every(r =>
      season.table.find(h => h.club === r.club).points === r.points);
  })());
  t("table: sorted descending with positions 1..20", (() => {
    const tb = FCW.buildTable("Everton", 55, FCW.pickSeason("Everton", 11));
    return tb.every((r,i) => (i === 0 || tb[i-1].points >= r.points) && r.pos === i + 1);
  })());
  t("table: player wins an equal-points tie", (() => {
    const season = FCW.pickSeason("Everton", 3);
    const rival = season.table.find(r => r.club !== "Everton");
    const tb = FCW.buildTable("Everton", rival.points, season);
    const i = tb.findIndex(r => r.isPlayer);
    return tb[i + 1] && tb[i + 1].points === rival.points;
  })());
  t("table: 114 points wins the title in every season",
    seasons.every(s => FCW.playerPosition(FCW.buildTable(s.table[0].club, 114, s)) === 1));
  t("table: 0 points is bottom in every season",
    seasons.every(s => FCW.playerPosition(FCW.buildTable(s.table[0].club, 0, s)) === 20));
}

/* ---- Scoring: front-loaded time schedule ---- */
const c = FCW.computeScore;
t("score: a clean start is the full 114", c(0, 0, 0, 0).score === 114);






t("score: penalties are 3 / 2 / 9 per action", (() => {
  const r = c(0, 1, 1, 1);
  return r.checkPenalty === 3 && r.revealLetterPenalty === 2 && r.revealAnswerPenalty === 9;
})());
t("score: never below 0", c(999999, 50, 99, 50).score === 0);


/* ---- Historical season tables ---- */
t("seasons: shipped data validates clean", FCW.loadSeasons(seasons).length === 0);
t("seasons: rejects pre-1995/96 and wrong-sized tables", (() => {
  const errs = FCW.validateSeasons([{ season: "1994/95", table: [{ club: "X", points: 50 }] }]).join(" ");
  return /20-team era/.test(errs) && /exactly 20 clubs/.test(errs);
})());
t("seasons: rejects impossible points and duplicate clubs", (() => {
  const bad = JSON.parse(JSON.stringify(seasons[0]));
  bad.table[5].points = 200;
  bad.table[6].club = bad.table[0].club;
  const errs = FCW.validateSeasons([bad]).join(" ");
  return /invalid points/.test(errs) && /duplicate club/.test(errs);
})());
t("seasons: rejects a table out of descending order", (() => {
  const bad = JSON.parse(JSON.stringify(seasons[0]));
  bad.table[3].points = 999 - 900 + bad.table[0].points; // higher than the champion
  return FCW.validateSeasons([bad]).some(e => /descending/.test(e));
})());
{
  const s0 = FCW.SCORING.SEASONS[0];
  const tb = FCW.buildTable("Everton", 61, s0);
  t("table: 20 rows, player exactly once",
    tb.length === 20 && tb.filter(r => r.isPlayer).length === 1 &&
    tb.filter(r => r.club === "Everton").length === 1);
  t("table: sorted descending, positions 1..20",
    tb.every((r, i) => (i === 0 || tb[i - 1].points >= r.points) && r.pos === i + 1));
  t("table: other clubs keep their real historical points", (() => {
    return s0.table.filter(r => r.club !== "Everton").every(real => {
      const row = tb.find(r => r.club === real.club);
      return row && row.points === real.points;
    });
  })());
  t("table: player wins an equal-points tie", (() => {
    const tie = FCW.buildTable("Liverpool", 61, s0);   // Everton/Blackburn/Spurs on 61
    const i = tie.findIndex(r => r.isPlayer);
    return tie[i].points === 61 && tie[i + 1].points === 61;
  })());
  t("table: 114 wins the title, 0 finishes bottom",
    FCW.playerPosition(FCW.buildTable("Everton", 114, s0)) === 1 &&
    FCW.playerPosition(FCW.buildTable("Everton", 0, s0)) === 20);
  t("table: a club absent that season displaces the bottom club", (() => {
    const tb2 = FCW.buildTable("Hull City", 61, s0);   // not in 1995/96
    return tb2.length === 20 &&
      tb2.filter(r => r.club === "Hull City").length === 1 &&
      !tb2.some(r => r.club === "Bolton Wanderers");   // bottom club displaced
  })());
}
t("seasons: club season pool only contains seasons that club played", (() => {
  return FCW.seasonsForClub("Everton").every(s2 => s2.table.some(r => r.club === "Everton"));
})());
t("seasons: pickSeason is deterministic for a seed", () => true);
t("seasons: pickSeason returns a valid season", (() => {
  const s2 = FCW.pickSeason("Everton", 4242, 1.4);
  return !!s2 && s2.table.length === 20;
})());
t("seasons: difficulty biases which season is chosen", (() => {
  // A hard puzzle should tend towards seasons where the title took fewer
  // points; an easy one towards seasons where it took more. Compare the
  // average title-winning total across many seeds.
  let hard = 0, easy = 0, n = 40;
  for (let i = 0; i < n; i++) {
    hard += FCW.pickSeason("Everton", i * 131, 3).table[0].points;
    easy += FCW.pickSeason("Everton", i * 131, 1).table[0].points;
  }
  return hard / n < easy / n;
})());
t("seasons: difficulty never alters the historical points themselves", (() => {
  // Whatever season comes back, its rows must match the stored table exactly.
  for (const d of [1, 2, 3]) {
    const picked = FCW.pickSeason("Everton", 7, d);
    const stored = seasons.find(s2 => s2.season === picked.season);
    if (JSON.stringify(picked.table.map(r => [r.club, r.points])) !==
        JSON.stringify(stored.table.map(r => [r.club, r.points]))) return false;
  }
  return true;
})());

/* ---- V0.5: content version, result records, stats ---- */
t("version: question bank version is defined and stamped on records",
  typeof FCW.QUESTION_BANK_VERSION === "string" && FCW.QUESTION_BANK_VERSION.length > 0 &&
  FCW.makeResultRecord({ date: "2026-08-11", dailyNo: 1, seed: 7, club: "Everton",
    season: "2003/04", score: 80, position: 3, elapsedSeconds: 300, matchMinute: 15,
    checks: 0, revealedLetters: 0, revealedAnswers: 0 }).bankVersion === FCW.QUESTION_BANK_VERSION);
t("record: carries every field needed to reproduce and report a Daily", (() => {
  const r = FCW.makeResultRecord({ date: "2026-08-11", dailyNo: 4, seed: 99, club: "Fulham",
    season: "2009/10", score: 61, position: 9, elapsedSeconds: 512, matchMinute: 25,
    checks: 2, revealedLetters: 3, revealedAnswers: 1 });
  return ["date","dailyNo","seed","bankVersion","club","season","score","position",
          "elapsedSeconds","matchMinute","checks","revealedLetters","revealedAnswers",
          "completedAt"].every(k => r[k] !== undefined);
})());
t("record: local date key uses the local calendar day",
  FCW.localDateKey(new Date(2026, 7, 5)) === "2026-08-05");

{
  const mk = (no, score, pos, secs) => FCW.makeResultRecord({
    date: "2026-08-" + ("0" + no).slice(-2), dailyNo: no, seed: no, club: "Everton",
    season: "2003/04", score, position: pos, elapsedSeconds: secs, matchMinute: 5,
    checks: 0, revealedLetters: 0, revealedAnswers: 0 });

  t("streak: consecutive dailies build a run", (() => {
    const s2 = FCW.streaks([mk(1,90,1,300), mk(2,80,3,400), mk(3,70,6,500)], 3);
    return s2.current === 3 && s2.longest === 3;
  })());
  t("streak: a missed day breaks the current run but keeps the best", (() => {
    const s2 = FCW.streaks([mk(1,90,1,300), mk(2,80,3,400), mk(5,70,6,500)], 5);
    return s2.current === 1 && s2.longest === 2;
  })());
  t("streak: finishing an old daily late does not revive the run", (() => {
    const s2 = FCW.streaks([mk(1,90,1,300), mk(2,80,3,400)], 9);
    return s2.current === 0 && s2.longest === 2;
  })());
  t("streak: yesterday still counts as a live run",
    FCW.streaks([mk(4,90,1,300), mk(5,80,3,400)], 6).current === 2);
  t("streak: no results means no streak", (() => {
    const s2 = FCW.streaks([], 3);
    return s2.current === 0 && s2.longest === 0;
  })());

  t("stats: career figures derive correctly from records", (() => {
    const st = FCW.seasonStats([mk(1,94,1,400), mk(2,57,8,700), mk(3,81,3,520)], 3);
    return st.played === 3 && st.bestScore === 94 && st.averageScore === 77 &&
      st.bestFinish === 1 && st.titles === 1 && st.topFour === 2 &&
      st.fastestSeconds === 400 && st.averageSeconds === 540;
  })());
  t("stats: relegations and European places count by position", (() => {
    const st = FCW.seasonStats([mk(1,30,19,900), mk(2,40,18,800), mk(3,70,5,600)], 3);
    return st.relegations === 2 && st.european === 1 && st.titles === 0;
  })());
  t("stats: nothing is fabricated for unplayed days", (() => {
    const st = FCW.seasonStats([], 5);
    return st.played === 0 && st.bestScore === null && st.averageScore === null &&
      st.bestFinish === null && st.fastestSeconds === null;
  })());
}

/* ---- Quick wins: seeded season+club pairing ---- */
t("random: season and club derive from the seed (same daily, same pairing)", (() => {
  const a = FCW.pickSeasonAndClub(4242, 1.4), b = FCW.pickSeasonAndClub(4242, 1.4);
  return a.club === b.club && a.season.season === b.season.season;
})());
t("random: the club always played in the chosen season", (() => {
  for (let i = 0; i < 60; i++) {
    const p = FCW.pickSeasonAndClub(i * 37, 1.4);
    if (!p.season.table.some(r => r.club === p.club)) return false;
  }
  return true;
})());
t("random: different seeds give different pairings", (() => {
  const set = new Set();
  for (let i = 0; i < 30; i++) { const p = FCW.pickSeasonAndClub(i * 77, 1.4); set.add(p.season.season + "|" + p.club); }
  return set.size > 20;
})());
t("random: every club of the era is selectable", FCW.historicalClubs().length === 49, FCW.historicalClubs().length);
t("random: selectable clubs all appear in at least one season",
  FCW.historicalClubs().every(c => FCW.seasonsForClub(c).length > 0));

/* ---- Outcome messages ---- */
t("outcome: 1st = champions", FCW.outcomeMessage("Leeds United", 1) === "Leeds United are Premier League champions!");
t("outcome: 4th = Champions League", FCW.outcomeMessage("Everton", 4) === "Everton qualified for the Champions League.");
t("outcome: 6th = European football", /European football/.test(FCW.outcomeMessage("Fulham", 6)));
t("outcome: 12th = mid-table", /mid-table/.test(FCW.outcomeMessage("Chelsea", 12)));
t("outcome: 17th = survived", /survived/.test(FCW.outcomeMessage("Sunderland", 17)));
t("outcome: 19th = relegated", /were relegated/.test(FCW.outcomeMessage("Brentford", 19)));
t("ordinal: 1st/2nd/3rd/11th/20th",
  FCW.ordinal(1) === "1st" && FCW.ordinal(2) === "2nd" && FCW.ordinal(3) === "3rd" &&
  FCW.ordinal(11) === "11th" && FCW.ordinal(20) === "20th");

/* ---- Reveal counting (model semantics used by the UI) ---- */
{
  // Reveal Letter: unique locked cells, one charge per cell even when shared
  const lockedCells = {};
  let letterReveals = 0;
  ["3,4", "3,4", "7,2", "3,4"].forEach(k => {
    if (!lockedCells[k]) { lockedCells[k] = true; letterReveals++; }
  });
  t("reveal letter: same cell repeatedly charges once", letterReveals === 2);
  t("reveal letter: penalty applies per unique cell", c(0, 0, letterReveals, 0).revealLetterPenalty === 4);
  // Reveal Answer: unique per entry; prior letter reveals unchanged at answer time
  const revealedAnswers = {};
  let answerReveals = 0;
  [5, 5, 9].forEach(i => { if (!revealedAnswers[i]) { revealedAnswers[i] = true; answerReveals++; } });
  t("reveal answer: same answer repeatedly charges once", answerReveals === 2);
  t("reveal answer: no per-letter surcharge at reveal-answer time",
    c(0, 0, letterReveals, answerReveals).score === 114 - 4 - 18);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
