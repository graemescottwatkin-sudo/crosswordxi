/* GET /hilo/club/<club>/ and /hilo/club/<club>/<n>
   A catch-all, because the tree is two levels deep and one file that owns
   both cannot disagree with itself about what a club slug is. */
import { treeRoute } from "../../_lib/hl-pages.js";
export const onRequestGet = treeRoute;
