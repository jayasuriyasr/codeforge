require('mongoose').connect('mongodb://localhost:27017/codeforge').then(async () => {
  const Problem = require('./src/models/Problem');
  const problem = await Problem.findOne({ slug: 'longest-substring-no-repeat' });
  console.log('timeLimitSec:', problem.timeLimitSec);
  process.exit(0);
});
