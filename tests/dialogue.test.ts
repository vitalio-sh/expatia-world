import test from 'node:test';
import assert from 'node:assert/strict';
import { actionCandidates, answerCall, createGame, npcContext, recordSpeech } from '../src/server/game';
import { dialogueMessages, speechIsGrounded } from '../src/server/dialogue';

test('opening speech guard withholds sign, invented visual details and the hidden entrance', () => {
  const game = createGame(); answerCall(game);
  const context = npcContext(game), action = actionCandidates(game, 'opening')[0];
  assert.equal(speechIsGrounded('I have your parcel and I am near a bar. Which way should I go?', context, action), true);
  assert.equal(speechIsGrounded('I am beside Bar Llevant.', context, action), false);
  assert.equal(speechIsGrounded('The bar has a red awning.', context, action), false);
  assert.equal(speechIsGrounded('People are having vermouth in the sunshine.', context, action), false);
  assert.equal(speechIsGrounded('Your entrance is on the south side.', context, action), false);
});

test('a selected visible sign is allowed while invented bars and completed movements are blocked', () => {
  const game = createGame(); answerCall(game); recordSpeech(game, 'I am near a bar. Which way should I go?');
  const context = npcContext(game), action = actionCandidates(game, 'directions').find(candidate => candidate.type === 'reveal')!;
  assert.ok(action);
  const sign = action.label.match(/visible (.+?) sign/)![1];
  assert.equal(speechIsGrounded(`The sign reads ${sign}. Which way from here?`, context, action), true);
  assert.equal(speechIsGrounded('The sign reads Bar Invented.', context, action), false);
  assert.equal(speechIsGrounded('I am walking north now.', context, action), false);
});

test('speech cannot claim receipt or completed collection before physical world outcome', () => {
  const context = { parcel: 'courier', factsLearned: { firstClueSpoken: true }, weather: { description: 'Overcast', isRain: false } };
  const drop = { type: 'drop', label: 'Leave for collection at Bar Llevant', reason: 'Observed eligible shop' };
  assert.equal(speechIsGrounded('I have left the parcel at the collection point.', context, drop), false);
  assert.equal(speechIsGrounded('Your parcel is safely with you.', context, drop), false);
  assert.equal(speechIsGrounded('I am taking it to the collection point. You will still need to collect it.', context, drop), true);
  assert.equal(speechIsGrounded('Your parcel is safely with you.', { ...context, parcel: 'resident' }, drop), true);
  assert.equal(speechIsGrounded('I have left the parcel at the collection point.', { ...context, parcel: 'drop' }, drop), true);
});

test('dialogue receives the selected action projection without route candidates or judge probabilities', () => {
  const messages = dialogueMessages({ history: [{ role: 'player', text: 'Which bar?' }] }, {
    selected: 'reveal', trigger: 'directions', action: { type: 'reveal', label: 'Read the visible Bar Llevant sign', reason: 'Sign is visible', target: { x: 123, y: 456 } },
    candidates: [{ label: 'Unselected route' }], probabilities: { reveal: .9, route: .1 },
  });
  const projection = JSON.parse(messages[1].content).selectedDecision;
  assert.equal(projection.action.type, 'reveal');
  assert.equal(projection.action.target, undefined);
  assert.equal(projection.candidates, undefined);
  assert.equal(projection.probabilities, undefined);
  assert.equal(dialogueMessages({}, { type: 'wait', label: 'Wait for handoff', reason: 'Arrived' })[1].content.includes('Wait for handoff'), true);
});
