/**
 * Math Tutor AI - Frontend Build & Bundle Analysis
 * Measures build time, bundle size, and frontend performance metrics
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Math Tutor AI - Frontend Performance Analysis             ║');
console.log('║  Measuring build time, bundle size, and asset metrics      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Check if build exists
const distDir = path.join(process.cwd(), 'dist');
const hasExistingBuild = fs.existsSync(distDir);

if (!hasExistingBuild) {
  console.log('📦 Building frontend with Vite...\n');
  
  const buildStart = process.hrtime.bigint();
  try {
    execSync('npm run build', { stdio: 'inherit' });
  } catch (err) {
    console.error('❌ Build failed');
    process.exit(1);
  }
  const buildEnd = process.hrtime.bigint();
  const buildTimeMs = Number(buildEnd - buildStart) / 1_000_000;
  
  console.log(`\n✅ Build completed in ${(buildTimeMs / 1000).toFixed(2)}s\n`);
}

// Analyze bundle
console.log('📊 Analyzing Build Output...\n');

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function analyzeDirectory(dir, prefix = '') {
  const stats = {
    totalSize: 0,
    files: [],
  };
  
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      const subStats = analyzeDirectory(filePath, prefix + file + '/');
      stats.totalSize += subStats.totalSize;
      stats.files.push(...subStats.files);
    } else {
      stats.totalSize += stat.size;
      stats.files.push({
        path: prefix + file,
        size: stat.size,
        type: path.extname(file),
      });
    }
  }
  
  return stats;
}

const analysis = analyzeDirectory(distDir);

// Group by file type
const filesByType = {};
analysis.files.forEach((file) => {
  const type = file.type || 'other';
  if (!filesByType[type]) filesByType[type] = { count: 0, size: 0 };
  filesByType[type].count += 1;
  filesByType[type].size += file.size;
});

// Sort by size
const sortedTypes = Object.entries(filesByType)
  .sort((a, b) => b[1].size - a[1].size);

console.log('Bundle Breakdown by File Type:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const [type, data] of sortedTypes) {
  const percentage = ((data.size / analysis.totalSize) * 100).toFixed(1);
  console.log(`  ${type.padEnd(8)} ${formatBytes(data.size).padStart(10)} (${data.count.toString().padStart(3)} files, ${percentage.padStart(5)}%)`);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  TOTAL    ${formatBytes(analysis.totalSize).padStart(10)}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Find largest files
const largestFiles = analysis.files
  .sort((a, b) => b.size - a.size)
  .slice(0, 10);

console.log('Top 10 Largest Files:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
largestFiles.forEach((file, i) => {
  const percentage = ((file.size / analysis.totalSize) * 100).toFixed(1);
  console.log(`  ${(i + 1).toString().padStart(2)}. ${file.path.padEnd(40)} ${formatBytes(file.size).padStart(10)} (${percentage.padStart(5)}%)`);
});
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Get main JS bundle info
const jsFiles = analysis.files.filter(f => f.type === '.js');
const totalJsSize = jsFiles.reduce((sum, f) => sum + f.size, 0);
const mainJs = jsFiles.find(f => f.path.includes('index-') || f.path.includes('main-'));

console.log('📈 Key Metrics:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`• Total Bundle Size: ${formatBytes(analysis.totalSize)}`);
console.log(`• JavaScript: ${formatBytes(totalJsSize)} (${jsFiles.length} files)`);
console.log(`• CSS: ${formatBytes(filesByType['.css']?.size || 0)}`);
console.log(`• Images: ${formatBytes(filesByType['.svg']?.size || 0 + filesByType['.png']?.size || 0 + filesByType['.jpg']?.size || 0)}`);
console.log(`• HTML: ${formatBytes(filesByType['.html']?.size || 0)}`);
console.log(`• Total Files: ${analysis.files.length}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Generate resume section
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  RESUME SUMMARY - FRONTEND PERFORMANCE                     ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('Key Metrics for Resume:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`• Frontend Bundle Size: ${formatBytes(analysis.totalSize)}`);
console.log(`• JavaScript Bundle: ${formatBytes(totalJsSize)}`);
console.log(`• Optimized for production deployment`);
console.log(`• Built with Vite (fast cold starts)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
