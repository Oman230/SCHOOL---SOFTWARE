const test = require('node:test');
const assert = require('node:assert/strict');
const { proficiencyForScore } = require('../controllers/proficiency');

test('proficiency levels follow the supplied score bands', () => {
  const cases = [
    [100, 'L1'],
    [80, 'L1'],
    [79.99, 'L2'],
    [65, 'L2'],
    [64.99, 'L3'],
    [50, 'L3'],
    [49.99, 'L4'],
    [35, 'L4'],
    [34.99, 'L5-L6'],
    [0, 'L5-L6'],
  ];

  for (const [score, level] of cases) {
    assert.equal(proficiencyForScore(score).level, level, `score ${score}`);
  }
});

test('proficiency scoring rejects values outside the final-score range', () => {
  for (const score of [-0.01, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => proficiencyForScore(score), RangeError);
  }
});
