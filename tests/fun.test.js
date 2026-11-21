import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rpsOutcome, RPS_CHOICES, getTicTacToeResult, hashString, shipPercent, shipVerdict, progressBar, blendNames,
  ratingFor, pickRandom, shuffled, parseChoices, renderAction, ACTIONS, EIGHT_BALL_ANSWERS,
} from '../src/services/fun/gameLogic.js';
import { TRIVIA_QUESTIONS } from '../src/config/fun/triviaQuestions.js';
import { WOULD_YOU_RATHER } from '../src/config/fun/wouldYouRather.js';
import { JOKES } from '../src/config/fun/jokes.js';

test('rock paper scissors covers all nine pairings', () => {
  const expected = {
    'rock,rock': 'tie', 'rock,paper': 'lose', 'rock,scissors': 'win',
    'paper,rock': 'win', 'paper,paper': 'tie', 'paper,scissors': 'lose',
    'scissors,rock': 'lose', 'scissors,paper': 'win', 'scissors,scissors': 'tie',
  };
  for (const a of RPS_CHOICES) for (const b of RPS_CHOICES) assert.equal(rpsOutcome(a, b), expected[`${a},${b}`], `${a} vs ${b}`);
});

test('tic-tac-toe detects every winning line, draws and ongoing games', () => {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const line of lines) {
    const board = Array(9).fill(null);
    line.forEach((i) => { board[i] = 'O'; });
    const result = getTicTacToeResult(board);
    assert.equal(result.winner, 'O');
    assert.deepEqual(result.line, line);
  }
  assert.deepEqual(getTicTacToeResult(Array(9).fill(null)), { winner: null, line: null, draw: false });
  const draw = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  assert.deepEqual(getTicTacToeResult(draw), { winner: null, line: null, draw: true });
  assert.equal(getTicTacToeResult(['X', 'X', 'X', 'O', 'O', null, null, null, null]).winner, 'X');
});

test('hashing, ship and rating are deterministic and in range', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
  assert.equal(shipPercent('111', '222'), shipPercent('222', '111'), 'order must not matter');
  for (let i = 0; i < 500; i += 1) {
    const percent = shipPercent(`u${i}`, `v${i * 7}`);
    assert.ok(Number.isInteger(percent) && percent >= 0 && percent <= 100);
    const rating = ratingFor(`thing ${i}`);
    assert.ok(Number.isInteger(rating) && rating >= 0 && rating <= 10);
  }
  assert.equal(ratingFor('Pizza'), ratingFor('  pizza  '));
  for (const p of [0, 24, 25, 49, 50, 74, 75, 89, 90, 100]) assert.ok(shipVerdict(p).length > 0);
});

test('progress bar and name blending', () => {
  assert.equal(progressBar(0.5, 10), '█████░░░░░');
  assert.equal(progressBar(2, 4), '████');
  assert.equal(progressBar(-1, 4), '░░░░');
  assert.equal(progressBar(NaN, 4), '░░░░');
  assert.equal(blendNames('Alice', 'Robert'), 'Aliert');
  assert.equal(blendNames('Jo', ''), 'Jo');
  assert.equal(blendNames('', ''), '');
});

test('pickRandom and shuffled behave', () => {
  assert.equal(pickRandom([], Math.random), undefined);
  assert.equal(pickRandom(['a', 'b', 'c'], () => 0), 'a');
  assert.equal(pickRandom(['a', 'b', 'c'], () => 0.9999999), 'c');
  assert.equal(pickRandom(['a', 'b', 'c'], () => 1), 'c', 'rng returning exactly 1 must not go out of range');
  const input = [1, 2, 3, 4, 5, 6];
  const out = shuffled(input);
  assert.deepEqual([...out].sort(), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6], 'input untouched');
});

test('parseChoices splits, trims, dedupes and caps', () => {
  assert.deepEqual(parseChoices('pizza, tacos | sushi; ramen or burgers'), ['pizza', 'tacos', 'sushi', 'ramen', 'burgers']);
  assert.deepEqual(parseChoices('a, A, b, , b'), ['a', 'b']);
  assert.deepEqual(parseChoices('Doctor Who, Rock or Roll'), ['Doctor Who', 'Rock', 'Roll']);
  assert.equal(parseChoices(Array.from({ length: 50 }, (_, i) => `o${i}`).join(',')).length, 20);
  assert.equal(parseChoices('x'.repeat(300))[0].length, 100);
  assert.deepEqual(parseChoices(''), []);
});

test('actions render for others and for yourself', () => {
  for (const type of Object.keys(ACTIONS)) {
    const text = renderAction(type, 'Alex', 'Sam', false, () => 0);
    assert.ok(text.includes('Alex') && text.includes('Sam'), type);
    assert.ok(!text.includes('{'), `${type} left a placeholder`);
    const self = renderAction(type, 'Alex', 'Alex', true);
    assert.ok(self.includes('Alex') && !self.includes('{'), `${type} self`);
  }
  assert.equal(renderAction('nope', 'a', 'b', false), null);
});

test('content banks are well formed', () => {
  assert.equal(EIGHT_BALL_ANSWERS.length, 20);
  assert.equal(new Set(EIGHT_BALL_ANSWERS).size, 20);

  assert.ok(TRIVIA_QUESTIONS.length >= 25);
  const seenQuestions = new Set();
  for (const q of TRIVIA_QUESTIONS) {
    assert.equal(q.wrong.length, 3, q.q);
    const all = [q.a, ...q.wrong];
    assert.equal(new Set(all).size, 4, `duplicate answers in: ${q.q}`);
    assert.ok(all.every((x) => x.length > 0 && `A. ${x}`.length <= 80), `button label too long in: ${q.q}`);
    assert.ok(!seenQuestions.has(q.q), `duplicate question: ${q.q}`);
    seenQuestions.add(q.q);
  }

  assert.ok(WOULD_YOU_RATHER.length >= 20);
  for (const [a, b] of WOULD_YOU_RATHER) assert.ok(a && b && a !== b);

  assert.ok(JOKES.length >= 20);
  assert.equal(new Set(JOKES.map(([setup]) => setup)).size, JOKES.length, 'duplicate joke setup');
  assert.equal(new Set(JOKES.map(([, punchline]) => punchline)).size, JOKES.length, 'duplicate punchline');
});
