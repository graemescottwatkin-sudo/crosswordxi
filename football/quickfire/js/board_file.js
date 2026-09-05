/* board_file.js — turns the generated export from D1 into the shape the game
   already reads, so nothing downstream cares where the content came from.

   Offline build:  data-bundle.js sets window.QFX_DATA directly.
   On the site:    window.QFX_DATA_URL points at data/board.json and this file
                   converts it.

   Both paths end at the same object, which is the point. The game has one idea
   of what content looks like, not two.
*/
(function (root) {
  'use strict';

  function entryFor(item, prefix) {
    var clueId = prefix + '-' + item.id;
    return {
      id: 'q' + item.id,
      answer: item.answer,
      answerType: item.answerType || 'unknown',
      aliases: item.aliases || [],
      clues: [{
        id: clueId,
        text: item.clue,
        difficulty: item.difficulty || 'medium',
        usableIn: [prefix === 'wk' ? 'quickfire-xi-weekly' : 'quickfire-xi'],
      }],
    };
  }

  function fromExport(payload) {
    var entries = [];
    var weeklyEntries = [];
    var seen = {};

    function collect(item, prefix, into) {
      var clueId = prefix + '-' + item.id;
      if (!seen[clueId]) {
        seen[clueId] = true;
        into.push(entryFor(item, prefix));
      }
      return clueId;
    }

    var dailies = (payload.dailies || []).map(function (board) {
      return {
        date: board.date,
        clueIds: (board.questions || []).map(function (q) {
          return collect(q, 'qf', entries);
        }),
        benchClueIds: (board.bench || []).map(function (q) {
          return collect(q, 'qf', entries);
        }),
      };
    });

    var weeks = (payload.weeks || []).map(function (board) {
      return {
        weekEnding: board.weekEnding,
        label: board.label || 'The Last 7 Days',
        placeholder: false,
        clueIds: (board.questions || []).map(function (q) {
          return collect(q, 'wk', weeklyEntries);
        }),
        benchClueIds: (board.bench || []).map(function (q) {
          return collect(q, 'wk', weeklyEntries);
        }),
      };
    });

    return {
      bank: { schemaVersion: 1, entries: entries },
      daily: {
        schemaVersion: 1,
        game: 'quickfire-xi',
        questionsPerDaily: 11,
        benchPerDaily: 3,
        dailies: dailies,
      },
      weekly: {
        schemaVersion: 1,
        game: 'quickfire-xi-weekly',
        questionsPerWeek: 11,
        benchPerWeek: 3,
        themes: [],
        anchorThemes: [],
        entries: weeklyEntries,
        weeks: weeks,
      },
      generatedAt: payload.generatedAt || null,
    };
  }

  /* The live endpoint answers with one board, not a file of them. */
  function fromApi(payload) {
    return fromExport({
      generatedAt: payload.generatedAt || null,
      dailies: payload.daily ? [payload.daily] : [],
      weeks: payload.week ? [payload.week] : [],
    });
  }

  var api = { fromExport: fromExport, fromApi: fromApi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QFXBoardFile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
