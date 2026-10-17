const mongoose = require('mongoose');
const { spawn } = require('child_process');
const Problem = require('./src/models/Problem');

mongoose.connect('mongodb://localhost:27017/codeforge').then(async () => {
  const problem = await Problem.findOne({ slug: 'longest-substring-no-repeat' });
  const testCases = problem.testCases;

  const code = `
import sys

def solve():
    s = sys.stdin.read().rstrip('\\n')
    char_index_map = {}
    max_length = 0
    left = 0
    
    for right in range(len(s)):
        current_char = s[right]
        if current_char in char_index_map and char_index_map[current_char] >= left:
            left = char_index_map[current_char] + 1
        char_index_map[current_char] = right
        max_length = max(max_length, right - left + 1)
        
    print(max_length)
solve()
`;

  const b64Code = Buffer.from(code).toString('base64');
  let runScript = `echo "${b64Code}" | base64 -d > /workspace/solution.py\n`;

  const DELIMITER = '---DELIM---';
  for (const tc of testCases) {
    const b64Input = Buffer.from(tc.input || '').toString('base64');
    runScript += `echo "${b64Input}" | base64 -d | python3 /workspace/solution.py\n`;
    runScript += `echo -n "\\n${DELIMITER}\\n"\n`;
  }

  const child = spawn('docker', [
    'exec', '-i', '-u', '1000', '-e', 'HOME=/workspace', '-e', 'TMPDIR=/workspace',
    'judge-worker-c4f8d9c7-bfdd-4cdf-8c0e-eb4bc6e271fb', 'bash'
  ]);
  
  let stdout = '';
  child.stdout.on('data', d => stdout += d.toString());
  
  child.on('close', () => {
    const outputs = stdout.split('\\n' + DELIMITER).map(s => s.trim());
    for (let i=0; i<testCases.length; i++) {
       console.log(`TC ${i+1}: expected '${testCases[i].expectedOutput}', got '${outputs[i]}'`);
       if (testCases[i].expectedOutput !== outputs[i]) {
         console.log('FAIL!');
       }
    }
    process.exit(0);
  });
  
  child.stdin.write(runScript);
  child.stdin.end();

});
