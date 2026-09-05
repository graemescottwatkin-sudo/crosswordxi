/* season.js — the season rule, as the server sees it.
 *
 * THE RULE ITSELF IS shared/xi-season.js, imported here rather than restated.
 * It has to be a served file because the hub computes the same season for a
 * player with no account, out of that device's own record; and there must be
 * exactly one copy of it, because two would be two answers about what a
 * Tuesday was. This is the same arrangement the games' scoring.js files
 * already have with the Workers that verify them: the page's own file is the
 * rule, and the server imports it.
 *
 * Read the header of shared/xi-season.js for the rule in the owner's words.
 * This file adds nothing to it — it exists so that the Functions can import
 * named bindings from a UMD file, and so an import of "./season.js" keeps
 * working for every caller that already has one.
 */
import XI_SEASON from "../../shared/xi-season.js";

export const RESULTS = XI_SEASON.RESULTS;
export const NO_SEASON_YET = XI_SEASON.NO_SEASON_YET;
export const dayResult = XI_SEASON.dayResult;
export const daySettled = XI_SEASON.daySettled;
export const pointsFor = XI_SEASON.pointsFor;
export const season = XI_SEASON.season;
