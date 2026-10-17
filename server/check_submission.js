require('mongoose').connect('mongodb://localhost:27017/codeforge').then(async () => {
  const Submission = require('./src/models/Submission');
  const sub = await Submission.findOne().sort({ createdAt: -1 });
  console.log(JSON.stringify(sub, null, 2));
  process.exit(0);
});
