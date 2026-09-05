/* adapters.js — the only place where shared content becomes game content.

   football-knowledge.json knows nothing about clocks, grids or points.
   Each game asks this module for the view it needs:

     toQuickfireQuestion(entry, clue)  -> clue text, enumeration, reveal order, accepted answers
     toPitchwordEntry(entry, clue)     -> grid answer (A-Z), clue text, enumeration, tags

   Adding a third game means adding a third function here, not a third database.
*/
(function (root) {
  'use strict';

  var Enum = root.QFXEnumeration || (typeof require === 'function' ? require('./enumeration.js') : null);
  var Reveal = root.QFXReveal || (typeof require === 'function' ? require('./reveal.js') : null);

  function indexBank(bank) {
    var byClueId = {};
    bank.entries.forEach(function (entry) {
      (entry.clues || []).forEach(function (clue) {
        byClueId[clue.id] = { entry: entry, clue: clue };
      });
    });
    return byClueId;
  }

  function usableIn(clue, game) {
    return (clue.usableIn || []).indexOf(game) !== -1;
  }

  function toQuickfireQuestion(entry, clue) {
    var answer = entry.answer;
    var order = clue.revealOrder && clue.revealOrder.length
      ? clue.revealOrder.slice()
      : Reveal.buildRevealOrder(answer, clue.id);
    return {
      questionId: clue.id,
      entryId: entry.id,
      clue: clue.text,
      answer: answer,
      aliases: (entry.aliases || []).slice(),
      enumeration: Enum.enumerate(answer),
      answerType: entry.answerType,
      difficulty: clue.difficulty || 'medium',
      tags: (clue.tags || []).slice(),
      revealOrder: order,
      revealable: Reveal.revealableIndices(answer).length
    };
  }

  function toPitchwordEntry(entry, clue) {
    var grid = String(entry.answer)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    return {
      entryId: entry.id,
      clueId: clue.id,
      gridAnswer: grid,
      length: grid.length,
      clue: clue.text,
      enumeration: Enum.enumerate(entry.answer),
      difficulty: clue.difficulty || 'medium',
      tags: (clue.tags || []).slice()
    };
  }

  function buildQuestions(bank, clueIds, game) {
    var index = indexBank(bank);
    return clueIds.map(function (clueId) {
      var found = index[clueId];
      if (!found) throw new Error('Unknown clue id: ' + clueId);
      if (!usableIn(found.clue, game)) throw new Error('Clue not usable in ' + game + ': ' + clueId);
      return toQuickfireQuestion(found.entry, found.clue);
    });
  }

  function buildDaily(bank, dailyDefinition, game) {
    return buildQuestions(bank, dailyDefinition.clueIds, game);
  }

  function buildBench(bank, dailyDefinition, game) {
    return buildQuestions(bank, dailyDefinition.benchClueIds || [], game);
  }

  var api = {
    indexBank: indexBank,
    usableIn: usableIn,
    toQuickfireQuestion: toQuickfireQuestion,
    toPitchwordEntry: toPitchwordEntry,
    buildDaily: buildDaily,
    buildBench: buildBench
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QFXAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
