/* GET /crossword/club/<id>/ and /crossword/club/<id>/<no>
   A catch-all, because the tree is two levels deep and one file that owns both
   cannot disagree with itself about what a club id is. */
import { treeRoute } from "../../_lib/theme-pages.js";
export const onRequestGet = (ctx) => treeRoute(ctx, "club");
