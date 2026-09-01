/* GET /wordsearch/themes/ — the index the "Clubs and themes" card opens.
   The one page in this set worth ranking: people search for a final or an
   era, not for a word search. */
import { indexPage } from "../../_lib/ws-theme-pages.js";
export const onRequestGet = indexPage;
