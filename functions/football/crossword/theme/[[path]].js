/* GET /football/crossword/theme/<id>/ and /football/crossword/theme/<id>/<no>
   The same renderer as the club tree, with "topic" as the kind it will serve —
   so Grounds has one address and it is not under /club/. */
import { treeRoute } from "../../../_lib/theme-pages.js";
export const onRequestGet = (ctx) => treeRoute(ctx, "topic");
