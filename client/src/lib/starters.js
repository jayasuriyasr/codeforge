// lib/starters.js — per-language boilerplate that reads all of stdin.

export const LANGUAGES = [
  { id: 'python', label: 'Python 3' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'cpp', label: 'C++17' },
  { id: 'c', label: 'C11' },
  { id: 'java', label: 'Java' },
];

export const MONACO_LANG = { python: 'python', javascript: 'javascript', cpp: 'cpp', c: 'c', java: 'java' };

export const STARTERS = {
  python: `import sys

def solve(data: str):
    # data is the whole of stdin
    print(...)

solve(sys.stdin.read())
`,
  javascript: `const data = require('fs').readFileSync(0, 'utf8');

function solve(input) {
  // input is the whole of stdin
  console.log(...);
}

solve(data);
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

// In-browser note: stdin is delivered one byte per syscall, so slurp it all
// once and parse from memory — don't loop cin >> / scanf on huge inputs.
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    string in((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());
    istringstream is(in);

    // read from \`is\`, write to cout

    return 0;
}
`,
  c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// In-browser note: stdin is delivered one byte per syscall. Read it all once
// into \`buf\`, then parse with sscanf / strtol — don't loop scanf on huge inputs.
int main(void) {
    static char buf[1 << 20];
    size_t n = fread(buf, 1, sizeof(buf) - 1, stdin);
    buf[n] = 0;

    // parse buf, write with printf

    return 0;
}
`,
  java: `import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringBuilder sb = new StringBuilder();
        // read lines from br, append to sb, then:
        System.out.print(sb);
    }
}
`,
};
