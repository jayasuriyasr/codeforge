require('mongoose').connect('mongodb://localhost:27017/codeforge').then(async () => {
  const Problem = require('./src/models/Problem');
  
  const newTestCases = [
    { isSample: false, input: ' ', expectedOutput: '1' },
    { isSample: false, input: 'au', expectedOutput: '2' },
    { isSample: false, input: 'dvdf', expectedOutput: '3' },
    { isSample: false, input: 'anviaj', expectedOutput: '5' },
    { isSample: false, input: 'abba', expectedOutput: '2' },
    { isSample: false, input: 'tmmzuxt', expectedOutput: '5' },
    { isSample: false, input: 'abcdefghijklmnopqrstuvwxyz', expectedOutput: '26' },
    // Adding a very long string to test performance
    { 
      isSample: false, 
      input: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+'.repeat(500), 
      expectedOutput: '76' 
    }
  ];

  await Problem.findOneAndUpdate(
    { slug: 'longest-substring-no-repeat' },
    { $push: { testCases: { $each: newTestCases } } }
  );

  console.log('Successfully added 8 new rigorous test cases!');
  process.exit(0);
}).catch(console.error);
