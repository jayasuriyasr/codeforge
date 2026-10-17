const mongoose = require('mongoose');
const Problem = require('./src/models/Problem');

const problemsData = {
  'two-sum': {
    statement: `### Problem Description

Given an array of integers \`nums\` and an integer \`target\`, return indices of the two numbers such that they add up to \`target\`.

You may assume that each input would have exactly one solution, and you may not use the same element twice. You can return the answer in any order.

### Input Format

- The first line contains two integers \`N\` (number of elements) and \`target\`.
- The second line contains \`N\` space-separated integers representing the array.

### Expected Output

- Two space-separated integers representing the indices (0-indexed) of the two numbers.

### Constraints

- \`2 <= N <= 10^4\`
- \`-10^9 <= nums[i] <= 10^9\`
- \`-10^9 <= target <= 10^9\`
`,
    testCases: [
      { isSample: true, input: '4 9\n2 7 11 15', expectedOutput: '0 1' },
      { isSample: true, input: '3 6\n3 2 4', expectedOutput: '1 2' },
      { isSample: false, input: '2 6\n3 3', expectedOutput: '0 1' },
      { isSample: false, input: '5 10\n1 2 3 4 6', expectedOutput: '3 4' }
    ]
  },

  'longest-substring-no-repeat': {
    statement: `### Problem Description

Given a string \`s\`, find the length of the longest substring without repeating characters.

### Input Format

- A single string on one line.

### Expected Output

- A single integer representing the length of the longest substring.

### Constraints

- \`0 <= s.length <= 5 * 10^4\`
- \`s\` consists of English letters, digits, symbols and spaces.
`,
    testCases: [
      { isSample: true, input: 'abcabcbb', expectedOutput: '3' },
      { isSample: true, input: 'bbbbb', expectedOutput: '1' },
      { isSample: false, input: 'pwwkew', expectedOutput: '3' },
      { isSample: false, input: 'a', expectedOutput: '1' }
    ]
  },

  'median-two-sorted-arrays': {
    statement: `### Problem Description

Given two sorted arrays \`nums1\` and \`nums2\` of size \`m\` and \`n\` respectively, return the median of the two sorted arrays.

### Input Format

- The first line contains \`M\` and \`N\`.
- The second line contains \`M\` space-separated integers for \`nums1\`.
- The third line contains \`N\` space-separated integers for \`nums2\`.

### Expected Output

- A single floating point number representing the median. Output exactly to 5 decimal places (e.g., \`2.50000\`).

### Constraints

- \`0 <= m, n <= 1000\`
- \`1 <= m + n <= 2000\`
`,
    testCases: [
      { isSample: true, input: '2 1\n1 3\n2', expectedOutput: '2.00000' },
      { isSample: true, input: '2 2\n1 2\n3 4', expectedOutput: '2.50000' },
      { isSample: false, input: '0 1\n\n1', expectedOutput: '1.00000' },
      { isSample: false, input: '1 1\n2\n3', expectedOutput: '2.50000' }
    ]
  },

  'valid-parentheses': {
    statement: `### Problem Description

Given a string \`s\` containing just the characters \`(\`, \`)\`, \`{\`, \`}\`, \`[\` and \`]\`, determine if the input string is valid.

### Input Format

- A single string on one line.

### Expected Output

- Print \`true\` if valid, else \`false\`.

### Constraints

- \`1 <= s.length <= 10^4\`
`,
    testCases: [
      { isSample: true, input: '()', expectedOutput: 'true' },
      { isSample: true, input: '()[]{}', expectedOutput: 'true' },
      { isSample: false, input: '(]', expectedOutput: 'false' },
      { isSample: false, input: '([)]', expectedOutput: 'false' }
    ]
  },

  'binary-search': {
    statement: `### Problem Description

Given an array of integers \`nums\` which is sorted in ascending order, and an integer \`target\`, write a function to search \`target\` in \`nums\`. If \`target\` exists, then return its index. Otherwise, return \`-1\`.

### Input Format

- The first line contains \`N\` and \`target\`.
- The second line contains \`N\` space-separated integers.

### Expected Output

- A single integer (the index or \`-1\`).

### Constraints

- \`1 <= nums.length <= 10^4\`
- \`-10^4 < nums[i], target < 10^4\`
`,
    testCases: [
      { isSample: true, input: '6 9\n-1 0 3 5 9 12', expectedOutput: '4' },
      { isSample: true, input: '6 2\n-1 0 3 5 9 12', expectedOutput: '-1' },
      { isSample: false, input: '1 5\n5', expectedOutput: '0' },
      { isSample: false, input: '2 3\n1 3', expectedOutput: '1' }
    ]
  },

  'trapping-rain-water': {
    statement: `### Problem Description

Given \`n\` non-negative integers representing an elevation map where the width of each bar is \`1\`, compute how much water it can trap after raining.

### Input Format

- First line contains \`N\`.
- Second line contains \`N\` space-separated integers.

### Expected Output

- A single integer representing the trapped water.

### Constraints

- \`n == height.length\`
- \`1 <= n <= 2 * 10^4\`
- \`0 <= height[i] <= 10^5\`
`,
    testCases: [
      { isSample: true, input: '12\n0 1 0 2 1 0 1 3 2 1 2 1', expectedOutput: '6' },
      { isSample: true, input: '6\n4 2 0 3 2 5', expectedOutput: '9' },
      { isSample: false, input: '3\n2 0 2', expectedOutput: '2' },
      { isSample: false, input: '1\n100', expectedOutput: '0' }
    ]
  },

  'climbing-stairs': {
    statement: `### Problem Description

You are climbing a staircase. It takes \`n\` steps to reach the top.
Each time you can either climb \`1\` or \`2\` steps. In how many distinct ways can you climb to the top?

### Input Format

- A single integer \`n\`.

### Expected Output

- A single integer representing the number of ways.

### Constraints

- \`1 <= n <= 45\`
`,
    testCases: [
      { isSample: true, input: '2', expectedOutput: '2' },
      { isSample: true, input: '3', expectedOutput: '3' },
      { isSample: false, input: '4', expectedOutput: '5' },
      { isSample: false, input: '1', expectedOutput: '1' }
    ]
  }
};

mongoose.connect('mongodb://localhost:27017/codeforge').then(async () => {
  for (const [slug, data] of Object.entries(problemsData)) {
    await Problem.findOneAndUpdate(
      { slug },
      { $set: { statement: data.statement, testCases: data.testCases } }
    );
    console.log('Updated', slug);
  }
  console.log('Finished updating problems.');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
