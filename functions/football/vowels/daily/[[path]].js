/* /football/vowels/daily and /football/vowels/daily/<key> — see functions/_lib/permalink.js, which
   holds the URL shape, the key rules and the page for every game. This file
   is the route and nothing else, so five games cannot grow five schemes. */
import { permalinkRoute } from "../../../_lib/permalink.js";

export const onRequestGet = (ctx) => permalinkRoute(ctx, "vowels");
export const onRequestHead = onRequestGet;
