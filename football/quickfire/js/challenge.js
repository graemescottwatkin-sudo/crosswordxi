/* challenge.js — turn an exact board into a link and back.

   A challenge code is base64url of {v, q, b}: the eleven clue ids and the three
   bench ids, in order. Nothing else travels — no answers, no scores, no dates.
   Whoever opens the link plays precisely the same XI, with the same bench, in
   the same order, and the reveal pattern matches too because reveal order is
   seeded from the clue id.

   Ids rather than indices, deliberately: a code stays valid when the bank grows
   or is reordered. A shorter index-based code is possible once the bank is
   stable, at the cost of breaking every link already sent.
*/
(function (root) {
  'use strict';

  var VERSION = 1;

  function toBase64Url(text) {
    var b64 = (typeof btoa === 'function')
      ? btoa(unescape(encodeURIComponent(text)))
      : Buffer.from(text, 'utf8').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(code) {
    var b64 = String(code).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return (typeof atob === 'function')
      ? decodeURIComponent(escape(atob(b64)))
      : Buffer.from(b64, 'base64').toString('utf8');
  }

  function encode(clueIds, benchIds) {
    return toBase64Url(JSON.stringify({
      v: VERSION,
      q: clueIds,
      b: benchIds || []
    }));
  }

  function decode(code) {
    var payload;
    try {
      payload = JSON.parse(fromBase64Url(code));
    } catch (err) {
      throw new Error('That challenge link is damaged.');
    }
    if (!payload || payload.v !== VERSION || !Array.isArray(payload.q)) {
      throw new Error('That challenge link is from a different version of the game.');
    }
    return { clueIds: payload.q, benchClueIds: payload.b || [] };
  }

  /* Short, stable id for a code — used to keep challenge progress in its own
     slot so it never overwrites the player's Daily. */
  function fingerprint(code) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < code.length; i++) {
      h ^= code.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36);
  }

  var api = { encode: encode, decode: decode, fingerprint: fingerprint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QFXChallenge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
