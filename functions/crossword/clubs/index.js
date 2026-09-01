/* GET /crossword/clubs/ — the index the "Clubs and themes" button now opens.
   It is the one page in this set that is worth ranking: people search for a
   club, not for a crossword clue. */
import { indexPage } from "../../_lib/theme-pages.js";
export const onRequestGet = indexPage;
