// Start next dev and capture all output including crash
const { spawn } = require('child_process');
const http = require('http');

const server = spawn('npx', ['next', 'dev', '-p', '3010'], {
  cwd: '/mnt/e/Users/Public/wq-research-agent',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'development' }
});

let output = '';
server.stdout.on('data', d => { output += d.toString(); });
server.stderr.on('data', d => { output += '[STDERR] ' + d.toString(); });

// Wait up to 40s for the server
setTimeout(() => {
  console.log('=== FULL OUTPUT ===');
  console.log(output);

  // Check if still alive
  if (server.exitCode === null) {
    console.log('Server is still running!');
    
    // Try to hit the API
    http.get('http://localhost:3010/api/settings', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('API Response:', data);
        process.exit(0);
      });
    }).on('error', (e) => {
      console.log('API Error:', e.message);
      process.exit(1);
    });
  } else {
    console.log('Server exited with code:', server.exitCode);
    console.log('Signal:', server.signalCode);
    process.exit(server.exitCode || 1);
  }
}, 40000);
