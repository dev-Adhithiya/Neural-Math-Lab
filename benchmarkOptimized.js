/**
 * Math Tutor AI - Optimized Performance Benchmark
 * Measures latency improvements from caching and inference optimization
 */

import http from 'http';

const PROXY_HOST = 'localhost';
const PROXY_PORT = 8787;

// Test queries
const TEST_QUERIES = [
  // Simple (fast profile)
  { text: 'What is 2+2?', category: 'simple' },
  { text: 'Solve for x: 3x = 9', category: 'simple' },
  
  // Medium (balanced profile)
  { text: 'Solve the quadratic equation: x² + 5x + 6 = 0', category: 'medium' },
  { text: 'How do you find the derivative of 3x²?', category: 'medium' },
  
  // Complex (thorough profile)
  { text: 'Explain how to solve a system of linear equations with 3 variables using Gaussian elimination', category: 'complex' },
];

function makeRequest(prompt) {
  return new Promise((resolve, reject) => {
    const startTime = process.hrtime.bigint();
    
    const req = http.request({
      hostname: PROXY_HOST,
      port: PROXY_PORT,
      path: '/api/proxy/ollama/chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const endTime = process.hrtime.bigint();
        const latencyMs = Number(endTime - startTime) / 1_000_000;
        
        resolve({
          statusCode: res.statusCode,
          latencyMs,
          cached: res.headers['x-cache'] === 'HIT',
          profile: res.headers['x-inference-profile'],
          dataSize: data.length,
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000);
    req.write(JSON.stringify({ prompt }));
    req.end();
  });
}

async function runBenchmarks() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Math Tutor AI - Optimized Performance Benchmark            ║');
  console.log('║  Testing caching and inference optimization impact          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Check if proxy is running
  try {
    await makeRequest('test');
  } catch (err) {
    console.error('❌ Cannot connect to proxy server');
    console.error('   Start it with: npm run dev:api');
    process.exit(1);
  }

  // Test categories
  const results = {
    simple: { first: [], repeat: [] },
    medium: { first: [], repeat: [] },
    complex: { first: [], repeat: [] },
  };

  console.log('📊 Running benchmark in 3 passes: first request, cache hit, profile detection\n');

  for (const query of TEST_QUERIES) {
    const category = query.category;
    
    console.log(`\n📝 Testing ${category.toUpperCase()}: "${query.text.substring(0, 50)}..."`);
    
    // PASS 1: Cold cache (first request)
    console.log('  Pass 1: Cold cache...');
    const coldResult = await makeRequest(query.text);
    results[category].first.push(coldResult.latencyMs);
    console.log(`    ✓ ${coldResult.latencyMs.toFixed(2)}ms (profile: ${coldResult.profile || 'N/A'}, cache: ${coldResult.cached ? 'HIT' : 'MISS'})`);
    
    // Small delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // PASS 2: Warm cache (repeated request)
    console.log('  Pass 2: Warm cache (same query)...');
    const warmResult = await makeRequest(query.text);
    results[category].repeat.push(warmResult.latencyMs);
    console.log(`    ✓ ${warmResult.latencyMs.toFixed(2)}ms (cache: ${warmResult.cached ? 'HIT' : 'MISS'})`);
    
    // Calculate improvement
    const improvement = ((coldResult.latencyMs - warmResult.latencyMs) / coldResult.latencyMs * 100).toFixed(1);
    console.log(`    📈 Improvement: ${improvement}%`);
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  OPTIMIZATION RESULTS SUMMARY                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  function printCategoryResults(category) {
    const firstRuns = results[category].first;
    const repeatRuns = results[category].repeat;
    
    const firstAvg = firstRuns.reduce((a, b) => a + b) / firstRuns.length;
    const repeatAvg = repeatRuns.length > 0 ? repeatRuns.reduce((a, b) => a + b) / repeatRuns.length : 0;
    const improvementPct = ((firstAvg - repeatAvg) / firstAvg * 100).toFixed(1);
    
    console.log(`${category.toUpperCase()} QUERIES:`);
    console.log(`  Cold cache (first):  ${firstAvg.toFixed(2)}ms avg`);
    console.log(`  Warm cache (repeat): ${repeatAvg.toFixed(2)}ms avg`);
    console.log(`  Improvement:         ${improvementPct}% faster with caching`);
    console.log('');
  }

  printCategoryResults('simple');
  printCategoryResults('medium');
  printCategoryResults('complex');

  // Projected impact
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  PROJECTED PRODUCTION IMPACT                               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const allCold = [
    ...results.simple.first,
    ...results.medium.first,
    ...results.complex.first,
  ];
  const allWarm = [
    ...results.simple.repeat,
    ...results.medium.repeat,
    ...results.complex.repeat,
  ];

  const coldAvg = allCold.reduce((a, b) => a + b) / allCold.length;
  const warmAvg = allWarm.reduce((a, b) => a + b) / allWarm.length;
  
  console.log('Full Session Simulation (typical tutoring session: 10 questions):\n');
  console.log('WITHOUT optimization:');
  console.log(`  10 questions × ${coldAvg.toFixed(1)}ms = ${(coldAvg * 10).toFixed(0)}ms (${(coldAvg * 10 / 1000).toFixed(1)}s total)\n`);
  
  // Assume 70% hit rate in typical session (repeats, similar questions)
  const estimatedHitRate = 0.7;
  const mixedAvg = coldAvg * (1 - estimatedHitRate) + warmAvg * estimatedHitRate;
  console.log('WITH optimization (70% cache hit rate):');
  console.log(`  10 questions × ${mixedAvg.toFixed(1)}ms avg = ${(mixedAvg * 10).toFixed(0)}ms (${(mixedAvg * 10 / 1000).toFixed(1)}s total)`);
  console.log(`  Improvement: ${((1 - mixedAvg / coldAvg) * 100).toFixed(0)}% faster session\n`);

  // Cache stats
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  CACHE STATUS                                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    const cacheRes = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/api/cache/stats`);
    const cacheStats = await cacheRes.json();
    console.log(`Cache size: ${cacheStats.size}/${cacheStats.maxSize} entries`);
    console.log(`Utilization: ${cacheStats.hitRate}`);
    console.log(`TTL: ${(cacheStats.ttlMs / 1000 / 60).toFixed(0)} minutes`);
  } catch (err) {
    console.log('(Cache stats endpoint not available)');
  }

  console.log('\n✅ Benchmark complete!');
}

runBenchmarks().catch(console.error);
