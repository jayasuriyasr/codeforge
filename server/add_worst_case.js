const mongoose = require('mongoose');
const Problem = require('./src/models/Problem');

mongoose.connect('mongodb://localhost:27017/codeforge').then(async () => {
  const problem = await Problem.findOne({ slug: 'longest-substring-no-repeat' });
  
  // Create a worst-case string with 50,000 completely UNIQUE Unicode characters!
  // By using unique characters, an O(n^2) nested loop approach will not hit 
  // early 'break' conditions and will perform (50,000 * 50,000) / 2 = 1.25 BILLION operations,
  // causing a massive TLE.
  // The O(n) sliding window will solve it in exactly 50,000 operations (a few milliseconds).
  
  let worstCaseString = '';
  // Start from a safe Unicode offset (e.g., 2000) to avoid control characters
  for (let i = 0; i < 50000; i++) {
    worstCaseString += String.fromCodePoint(2000 + i);
  }

  const worstTestCase = {
    isSample: false,
    input: worstCaseString,
    expectedOutput: '50000'
  };

  await Problem.findOneAndUpdate(
    { slug: 'longest-substring-no-repeat' },
    { $push: { testCases: worstTestCase } }
  );

  console.log('Successfully added the Ultimate Worst-Case 50,000 UNIQUE character test case!');
  process.exit(0);
});
