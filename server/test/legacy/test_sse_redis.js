// test_sse_redis.js
// Tests the SSE real-time delivery mechanism in isolation

const Redis = require('ioredis');
const http = require('http');
const jwt = require('jsonwebtoken');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const SUBMISSION_ID = 'test-sub-' + Date.now();

// Generate a valid token
const token = jwt.sign({ sub: 'testuser', role: 'contestant' }, JWT_SECRET, { expiresIn: '1h' });

async function main() {
  const publisher = new Redis(REDIS_URL);
  
  console.log('[test] Connecting to SSE stream...');
  const req = http.get(`http://localhost:5000/api/v1/submissions/${SUBMISSION_ID}/stream?token=${token}`, (res) => {
    console.log(`[test] SSE connected. Status: ${res.statusCode}`);
    
    res.on('data', (chunk) => {
      const data = chunk.toString();
      if (data.includes('ping')) return; // ignore keepalive
      console.log('[test] Received SSE data:');
      console.log(data);
      
      if (data.includes('COMPLETED')) {
        console.log('[test] Received terminal status. Success!');
        req.destroy();
        publisher.quit();
        process.exit(0);
      }
    });
  });

  // Wait a moment for subscription to establish
  await new Promise(r => setTimeout(r, 500));

  console.log('[test] Publishing fake verdict 1 (RUNNING)...');
  await publisher.publish(`verdict:${SUBMISSION_ID}`, JSON.stringify({
    type: 'verdict',
    submissionId: SUBMISSION_ID,
    verdict: 'RUNNING',
    status: 'RUNNING'
  }));

  await new Promise(r => setTimeout(r, 500));

  console.log('[test] Publishing fake verdict 2 (AC - COMPLETED)...');
  await publisher.publish(`verdict:${SUBMISSION_ID}`, JSON.stringify({
    type: 'verdict',
    submissionId: SUBMISSION_ID,
    verdict: 'AC',
    runtimeMs: 42,
    status: 'COMPLETED'
  }));
}

main().catch(console.error);
