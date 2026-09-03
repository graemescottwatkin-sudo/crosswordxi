/* GET /api/hilo/board?id=398 — one board by id, as free play.

   A club board any time; a daily board only once its day has come. Unknown,
   unreleased and malformed ids get one identical refusal that names nothing —
   a refusal that said "that is Tuesday's" would already have leaked. */
import { json, bad } from "../../_lib/puzzle.js";
import { loadBank, boardById, released, publicBoard, boardToken } from "../../_lib/hl-board.js";

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return bad("No such board.", 404);
  const bank = await loadBank(env);
  const board = boardById(bank, id);
  if (!released(bank, board)) return bad("No such board.", 404);
  return json({ board: publicBoard(board, boardToken(board.id)), source: bank.source });
}
