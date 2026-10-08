const proficiencyLevels = [
  { min: 80, level: 'L1', name: 'Highly Proficient / Advanced', remark: 'Excellent performance. Keep it up. Shows high understanding.' },
  { min: 65, level: 'L2', name: 'Proficient', remark: 'Very good performance. Could achieve more with little effort.' },
  { min: 50, level: 'L3', name: 'Approaching Proficiency', remark: 'Good effort shown. Needs improvement.' },
  { min: 35, level: 'L4', name: 'Developing', remark: 'Developing interest. Requires intensive support.' },
  { min: 0, level: 'L5-L6', name: 'Below Standard / Beginning', remark: 'Developing interest. Requires intensive support.' },
];

function proficiencyForScore(rawScore) {
  const score = Number(rawScore);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError('Final score must be between 0 and 100.');
  }
  return proficiencyLevels.find(({ min }) => score >= min);
}

module.exports = { proficiencyLevels, proficiencyForScore };
