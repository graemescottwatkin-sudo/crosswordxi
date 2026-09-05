/* GET /football/wordsearch/theme/<category>/ and /football/wordsearch/theme/<category>/<n>
   A catch-all, because the tree is two levels deep and one file that owns
   both cannot disagree with itself about what a category slug is. */
import { treeRoute } from "../../../_lib/ws-theme-pages.js";
export const onRequestGet = treeRoute;
