/**
 * Math Tutor AI Application - Performance Benchmark Suite
 * Measures latency, throughput, and performance metrics for resume documentation
 */

import http from 'http';
import https from 'https';

// Configuration
const PROXY_HOST = 'localhost';
const PROXY_PORT = 8787;
const ITERATIONS = 10;

// Result tracking
const results = {
  health_check: [],
  ollama_inference: [],
  azure_chat: [],
  rag_search: [],
};

/**
 * Make HTTP request and measure latency
 */
function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const startTime = process.hrtime.bigint();
    
    const req = http.request(options, (res) => {
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
          dataSize: data.length,
          data,
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000); // 30 second timeout
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

/**
 * Test health check endpoint
 */
async function benchmarkHealthCheck() {
  console.log('\n📊 Benchmarking Health Check Endpoint...');
  
  for (let i = 0; i < ITERATIONS; i++) {
    try {
      const result = await makeRequest({
        hostname: PROXY_HOST,
        port: PROXY_PORT,
        path: '/api/health',
        method: 'GET',
      });
      
      if (result.statusCode === 200) {
        results.health_check.push(result.latencyMs);
        console.log(`  Iteration ${i + 1}: ${result.latencyMs.toFixed(2)}ms`);
      }
    } catch (err) {
      console.error(`  Iteration ${i + 1}: ERROR - ${err.message}`);
    }
  }
}

/**
 * Test Ollama inference endpoint
 */
async function benchmarkOllamaInference() {
  console.log('\n🧠 Benchmarking Ollama Inference Endpoint...');
  
  const payload = {
    model: process.env.OLLAMA_MODEL || 'deepseek-r1:7b',
    prompt: 'What is 2 + 2? Answer briefly.',
    stream: false,
    keep_alive: '10m',
  };
  
  for (let i = 0; i < ITERATIONS; i++) {
    try {
      const result = await makeRequest({
        hostname: PROXY_HOST,
        port: PROXY_PORT,
        path: '/api/proxy/ollama/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, payload);
      
      if (result.statusCode === 200) {
        results.ollama_inference.push(result.latencyMs);
        console.log(`  Iteration ${i + 1}: ${result.latencyMs.toFixed(2)}ms (${result.dataSize} bytes)`);
      } else {
        console.log(`  Iteration ${i + 1}: Status ${result.statusCode}`);
      }
    } catch (err) {
      console.error(`  Iteration ${i + 1}: ERROR - ${err.message}`);
    }
  }
}

/**
 * Test Azure OpenAI chat endpoint
 */
async function benchmarkAzureChat() {
  console.log('\n☁️  Benchmarking Azure OpenAI Chat Endpoint...');
  
  const hasAzureConfig = process.env.AZURE_OPENAI_ENDPOINT && 
                         process.env.AZURE_OPENAI_KEY && 
                         process.env.AZURE_OPENAI_DEPLOYMENT;
  
  if (!hasAzureConfig) {
    console.log('  ⚠️  Azure OpenAI not configured (skipping)');
    return;
  }
  
  const payload = {
    messages: [{ role: 'user', content: 'What is 2 + 2?' }],
    stream: false,
    temperature: 0.4,
  };
  
  for (let i = 0; i < ITERATIONS; i++) {
    try {
      const result = await makeRequest({
        hostname: PROXY_HOST,
        port: PROXY_PORT,
        path: '/api/proxy/azure/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, payload);
      
      if (result.statusCode === 200) {
        results.azure_chat.push(result.latencyMs);
        console.log(`  Iteration ${i + 1}: ${result.latencyMs.toFixed(2)}ms (${result.dataSize} bytes)`);
      } else {
        console.log(`  Iteration ${i + 1}: Status ${result.statusCode}`);
      }
    } catch (err) {
      console.error(`  Iteration ${i + 1}: ERROR - ${err.message}`);
    }
  }
}

/**
 * Test RAG search endpoint
 */
async function benchmarkRAGSearch() {
  console.log('\n🔍 Benchmarking RAG Search Endpoint...');
  
  const hasAzureSearch = process.env.AZURE_SEARCH_ENDPOINT && 
                         process.env.AZURE_SEARCH_KEY && 
                         process.env.AZURE_SEARCH_INDEX;
  
  if (!hasAzureSearch) {
    console.log('  ⚠️  Azure Search not configured (skipping)');
    return;
  }
  
  const payload = {
    query: 'algebra quadratic equations',
    top: 4,
  };
  
  for (let i = 0; i < ITERATIONS; i++) {
    try {
      const result = await makeRequest({
        hostname: PROXY_HOST,
        port: PROXY_PORT,
        path: '/api/proxy/rag/search',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, payload);
      
      if (result.statusCode === 200) {
        results.rag_search.push(result.latencyMs);
        console.log(`  Iteration ${i + 1}: ${result.latencyMs.toFixed(2)}ms (${result.dataSize} bytes)`);
      } else {
        console.log(`  Iteration ${i + 1}: Status ${result.statusCode}`);
      }
    } catch (err) {
      console.error(`  Iteration ${i + 1}: ERROR - ${err.message}`);
    }
  }
}

/**
 * Calculate statistics from results
 */
function calculateStats(data) {
  if (data.length === 0) return null;
  
  const sorted = [...data].sort((a, b) => a - b);
  const sum = data.reduce((a, b) => a + b, 0);
  const avg = sum / data.length;
  const min = sorted[0];
  const max = sorted[data.length - 1];
  const p50 = sorted[Math.floor(data.length * 0.5)];
  const p95 = sorted[Math.floor(data.length * 0.95)];
  const p99 = sorted[Math.floor(data.length * 0.99)];
  
  return { avg, min, max, p50, p95, p99, count: data.length };
}

/**
 * Format statistics for display
 */
function formatStats(name, data) {
  const stats = calculateStats(data);
  if (!stats) return `${name}: No data collected`;
  
  return `
${name}:
  ✓ Samples: ${stats.count}
  ✓ Min:     ${stats.min.toFixed(2)}ms
  ✓ Avg:     ${stats.avg.toFixed(2)}ms
  ✓ Median:  ${stats.p50.toFixed(2)}ms
  ✓ P95:     ${stats.p95.toFixed(2)}ms
  ✓ P99:     ${stats.p99.toFixed(2)}ms
  ✓ Max:     ${stats.max.toFixed(2)}ms`;
}

/**
 * Main benchmark runner
 */
async function runBenchmarks() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Math Tutor AI - Performance Benchmark Suite               ║');
  console.log('║  Measuring latency, throughput, and performance metrics    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  try {
    // Check if proxy is running
    console.log('\n🔌 Checking if proxy server is running...');
    await makeRequest({
      hostname: PROXY_HOST,
      port: PROXY_PORT,
      path: '/api/health',
      method: 'GET',
    });
    console.log('✅ Proxy server is responding');
  } catch (err) {
    console.error('❌ Cannot connect to proxy server on localhost:8787');
    console.error('   Make sure to run: npm run dev:api');
    process.exit(1);
  }
  
  // Run benchmarks
  await benchmarkHealthCheck();
  await benchmarkOllamaInference();
  await benchmarkAzureChat();
  await benchmarkRAGSearch();
  
  // Print results summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  PERFORMANCE BENCHMARK RESULTS                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  console.log(formatStats('📡 API Health Check', results.health_check));
  console.log(formatStats('\n🧠 Ollama Local Inference', results.ollama_inference));
  console.log(formatStats('\n☁️  Azure OpenAI Chat', results.azure_chat));
  console.log(formatStats('\n🔍 RAG Search', results.rag_search));
  
  // Summary statistics
  const allResults = Object.values(results).flat();
  console.log(formatStats('\n📊 OVERALL (All Endpoints)', allResults));
  
  // Generate resume section
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  RESUME SUMMARY                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const healthStats = calculateStats(results.health_check);
  const ollamaStats = calculateStats(results.ollama_inference);
  const overallStats = calculateStats(allResults);
  
  console.log('Key Performance Metrics for Resume:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (healthStats) {
    console.log(`• API Latency: ${healthStats.avg.toFixed(0)}ms avg (min: ${healthStats.min.toFixed(0)}ms, max: ${healthStats.max.toFixed(0)}ms)`);
  }
  if (ollamaStats) {
    console.log(`• Model Inference: ${ollamaStats.avg.toFixed(0)}ms avg (p95: ${ollamaStats.p95.toFixed(0)}ms)`);
  }
  if (overallStats) {
    console.log(`• Overall System Response: ${overallStats.avg.toFixed(0)}ms median latency`);
    console.log(`• Throughput: ${(1000 / overallStats.avg).toFixed(0)} requests/second capacity`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// Run benchmarks
runBenchmarks().catch(console.error);
