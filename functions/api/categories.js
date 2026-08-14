/* GET /api/categories — the topic filters practice mode may ask for.
   Published deliberately: these are labels, not clue content, and the client
   needs them to build the filter list without knowing the bank. */
import { json } from "../_lib/puzzle.js";
import { listCategories } from "../_lib/db.js";

export async function onRequestGet({ env }) {
  return json({ categories: (await listCategories(env)).sort() });
}
