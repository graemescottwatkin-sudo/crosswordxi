/* preview_test.js — boots preview/quickfire-preview.html and plays a question.
 *
 *   python3 tools/football/quickfire/build_preview.py
 *   node tools/football/quickfire/preview_test.js          (needs jsdom)
 *
 * It caught two faults in the preview builder that reading the file would not
 * have: the stub was being written after the game scripts, so game.js fetched
 * the real endpoint before the stub existed; and the stub used `new Response`,
 * which is not present everywhere fetch is.
 */
'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require('path').join(__dirname, '../../preview/quickfire-preview.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://preview.test/' });
const { window } = dom, doc = window.document, $ = id => doc.getElementById(id);
const cells = () => Array.from($('answer').children)
  .map(c => c.className.includes('gap') ? ' ' : c.textContent).join('');
let bad = 0;
const ok = (n, c, d) => { console.log((c ? '  ok  ' : 'FAIL  ') + n + (d ? '  — ' + d : '')); if (!c) bad++; };

setTimeout(() => {
  ok('start screen appears after the stubbed fetch', !$('screenStart').hidden);
  ok('a date is shown', $('startDate').textContent.length > 4, $('startDate').textContent);
  ok('the weekly round is offered', !$('playWeekly').hidden, $('weeklyLabel').textContent);
  $('kickOff').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  ok('the game screen opens', !$('screenGame').hidden);
  ok('a clue is shown', $('clue').textContent.length > 5, $('clue').textContent);
  ok('the enumeration is shown', /^\(\d/.test($('enumeration').textContent), $('enumeration').textContent);
  ok('the board is drawn as gaps', /_/.test(cells()), cells());
  /* Asserted only after the game screen opens — the markup ships with 1 / 11 in
     it, so checking earlier passes without the game having loaded at all. */
  ok('progress reads 1 / 11', !$('screenGame').hidden &&
     $('progress').textContent.trim() === '1 / 11', $('progress').textContent);
  ok('subs are offered', /\d/.test($('subCost').textContent), $('subCost').textContent);
  const input = $('keyInput');
  input.value = '\u200bMANCHESTER';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  ok('typing lands on the board', /MANCHESTER/.test(cells()), cells());
  input.value = '\u200bUNITED';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  ok('a correct answer scores', /GOAL/.test($('feedback').textContent), $('feedback').textContent);
  ok('the preview banner is present', /Preview build/.test(doc.body.textContent));
  console.log('\n' + (bad ? bad + ' FAILURE(S)' : 'Preview works') + '\n');
  process.exit(bad ? 1 : 0);
}, 400);
