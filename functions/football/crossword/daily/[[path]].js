/* /football/crossword/daily and /football/crossword/daily/<key> — see functions/_lib/permalink.js, which
   holds the URL shape, the key rules and the page for every game. This file
   is the route and nothing else, so four games cannot grow four schemes. */
import { permalinkRoute } from "../../../_lib/permalink.js";

export const onRequestGet = (ctx) => permalinkRoute(ctx, "crossword");
export const onRequestHead = onRequestGet;
