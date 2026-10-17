require('mongoose').connect('mongodb://localhost:27017/codeforge').then(async () => {
  const User = require('./src/models/User');
  await User.updateMany({}, { role: 'admin' });
  console.log('Successfully upgraded all existing users to admin!');
  process.exit(0);
}).catch(console.error);
