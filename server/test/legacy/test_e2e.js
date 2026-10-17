'use strict';
const assert = require('assert').strict;
const { spawn, execSync } = require('child_process');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('── Starting API Server ───────────────────────────────────────────');
  const server = spawn('node', ['src/index.js'], { stdio: 'inherit' });
  
  // Wait for health endpoint to be up
  let up = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://localhost:5000/health');
      if (res.ok) { up = true; break; }
    } catch (e) {}
    await sleep(1000);
  }
  if (!up) { console.error('Server failed to start'); server.kill(); process.exit(1); }

  console.log('\n── Register Admin User ───────────────────────────────────────────');
  const regRes = await fetch('http://localhost:5000/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.com', password: 'password123', displayName: 'Admin' })
  });
  // Ignore 409 if already exists
  if (!regRes.ok && regRes.status !== 409) throw new Error('Registration failed');
  
  // Login to get fresh token
  let loginRes = await fetch('http://localhost:5000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.com', password: 'password123' })
  });
  if (!loginRes.ok) throw new Error('Login failed');
  const { token, user } = await loginRes.json();
  // Manually make user an admin via mongo so they can create problems
  execSync(`docker exec codeforge_mongo mongosh codeforge --eval "db.users.updateOne({_id: ObjectId('${user._id}')}, {$set: {role: 'admin'}})"`);
  
  // Re-login to get admin token
  loginRes = await fetch('http://localhost:5000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.com', password: 'password123' })
  });
  const { token: adminToken } = await loginRes.json();
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` };

  const uniqueSuffix = Date.now().toString();
  console.log('\n── 1. Create Problem (Invalid Limits API block) ──────────────────');
  let pRes = await fetch('http://localhost:5000/api/v1/problems', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Too Long',
      slug: 'too-long-' + uniqueSuffix,
      statement: '...',
      description: '...',
      timeLimitSec: 15,
      memoryLimitMB: 512,
      checkerType: 'exact',
      testCases: [{ input: 'a', expectedOutput: 'b' }]
    })
  });
  assert.equal(pRes.status, 400);
  let resJson = await pRes.json();
  assert.match(resJson.error, /exceeds queue ceiling/);
  console.log('  ✅  assertProblemLimits blocks invalid problem at API');

  console.log('\n── 2. Create Problem (Valid) ─────────────────────────────────────');
  pRes = await fetch('http://localhost:5000/api/v1/problems', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Hello World E2E',
      slug: 'hello-world-e2e-' + uniqueSuffix,
      statement: 'Print hello',
      description: 'Print "hello"',
      timeLimitSec: 2,
      memoryLimitMB: 256,
      checkerType: 'exact',
      testCases: [{ input: 'ignore', expectedOutput: 'hello' }]
    })
  });
  const pJson = await pRes.json();
  if (pRes.status !== 201) {
    console.error('Failed to create valid problem:', pJson);
  }
  assert.equal(pRes.status, 201);
  const problem = pJson.problem;
  const pid = problem._id;
  console.log('  ✅  Problem created: ' + pid);

  console.log('\n── 3. Check /dev/shm mount on worker containers ──────────────────');
  // Find a worker container without using head
  const psOut = execSync(`docker ps --filter "name=judge-worker-" --format "{{.ID}}"`).toString().trim();
  const cID = psOut.split('\n')[0].trim();
  assert.ok(cID, 'Could not find a worker container');
  const dfOut = execSync(`docker exec ${cID} df -h /dev/shm`).toString();
  assert.match(dfOut, /[14]\.0K/, 'tmpfs size mismatch (expected 1.0K or 4.0K)');
  console.log('  ✅  pool shows 1.0K /dev/shm mount');

  const submit = async (lang, code) => {
    // Generate unique idempotency key
    const idempotencyKey = 'req_' + Date.now() + Math.random();
    const res = await fetch('http://localhost:5000/api/v1/submissions', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ problemId: pid, language: lang, code })
    });
    if (!res.ok) throw new Error('Submission failed: ' + (await res.text()));
    const sub = await res.json();
    return sub.submission._id;
  };

  const waitForVerdict = async (sid) => {
    for (let i = 0; i < 30; i++) {
      const res = await fetch(`http://localhost:5000/api/v1/submissions/${sid}`, { headers });
      const sub = await res.json();
      if (['COMPLETED', 'FAILED'].includes(sub.status)) return sub.verdict;
      await sleep(1000);
    }
    throw new Error('Timed out waiting for verdict on ' + sid);
  };

  console.log('\n── 4. Submit Solutions (C++, Python, JS) ─────────────────────────');
  
  const cppCode = '#include <iostream>\nint main() { std::cout << "hello\\n"; return 0; }';
  const pyCode = 'print("hello")';
  const jsCode = 'console.log("hello");';

  console.log('Submitting C++...');
  const cppId = await submit('cpp', cppCode);
  let cppVerdict = await waitForVerdict(cppId);
  if (cppVerdict !== 'AC') {
    const res = await fetch(`http://localhost:5000/api/v1/submissions/${cppId}`, { headers });
    console.error(await res.json());
  }
  assert.equal(cppVerdict, 'AC');
  console.log('  ✅  C++ passed (AC)');
  
  console.log('Submitting Python...');
  const pyId = await submit('python', pyCode);
  let pyVerdict = await waitForVerdict(pyId);
  if (pyVerdict !== 'AC') {
    const res = await fetch(`http://localhost:5000/api/v1/submissions/${pyId}`, { headers });
    console.error(await res.json());
  }
  assert.equal(pyVerdict, 'AC');
  console.log('  ✅  Python passed (AC)');
  
  console.log('Submitting JavaScript...');
  const jsId = await submit('javascript', jsCode);
  let jsVerdict = await waitForVerdict(jsId);
  if (jsVerdict !== 'AC') {
    const res = await fetch(`http://localhost:5000/api/v1/submissions/${jsId}`, { headers });
    console.error(await res.json());
  }
  assert.equal(jsVerdict, 'AC');
  console.log('  ✅  JavaScript passed (AC)');

  console.log('\n── 5. Submit Java (package-private with text block) ──────────────');
  const javaCode = `
class Test {
  public static void main(String[] args) {
    String msg = """
hello""";
    System.out.println(msg);
  }
}
`;
  const javaId = await submit('java', javaCode);
  console.log('Waiting for Java...');
  assert.equal(await waitForVerdict(javaId), 'AC');
  console.log('  ✅  Java package-private with text block passed (AC)');

  console.log('\n✅ ALL E2E TESTS PASSED!');
  server.kill();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
