const mongoose = require('mongoose');
const Problem = require('./src/models/Problem');

mongoose.connect('mongodb://localhost:27017/codeforge').then(async () => {
  const problem = await Problem.findOne({ slug: 'longest-substring-no-repeat' });
  const testCase = problem.testCases.find(tc => tc.expectedOutput === '76');
  if (testCase) {
    testCase.expectedOutput = '74';
    await problem.save();
    console.log('Fixed faulty test case! 76 -> 74');
  } else {
    console.log('Test case not found');
  }
  process.exit(0);
});
