const mongoose = require('mongoose');
const Problem = require('./src/models/Problem');

mongoose.connect('mongodb://localhost:27017/codeforge').then(async () => {
  const problem = await Problem.findOne({ slug: 'longest-substring-no-repeat' });
  
  const testCases = [];
  
  // 1. All same character (length 50,000)
  testCases.push({
    isSample: false,
    input: 'a'.repeat(50000),
    expectedOutput: '1'
  });

  // 2. Alternating alphabet (length 50,000)
  testCases.push({
    isSample: false,
    input: 'abcdefghijklmnopqrstuvwxyz'.repeat(Math.ceil(50000 / 26)).substring(0, 50000),
    expectedOutput: '26'
  });

  // 3. All same character except last (length 50,000)
  testCases.push({
    isSample: false,
    input: 'a'.repeat(49999) + 'b',
    expectedOutput: '2'
  });

  // 4. Maximum printable ASCII string repeated (length 50,000)
  // There are 95 printable ASCII characters (from space to tilde)
  let asciiPattern = '';
  for (let i = 32; i <= 126; i++) {
    asciiPattern += String.fromCharCode(i);
  }
  
  testCases.push({
    isSample: false,
    input: asciiPattern.repeat(Math.ceil(50000 / asciiPattern.length)).substring(0, 50000),
    expectedOutput: '95'
  });

  await Problem.findOneAndUpdate(
    { slug: 'longest-substring-no-repeat' },
    { $push: { testCases: { $each: testCases } } }
  );

  console.log('Successfully added four 50,000-character test cases!');
  process.exit(0);
});
