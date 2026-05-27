const { spawn } = require('child_process');
const fs = require('fs');
const log = fs.createWriteStream('/tmp/next-dev.log', { flags: 'w' });

const server = spawn('npx', ['next', 'dev', '-p', '3013'], {
  cwd: '/mnt/e/Users/Public/wq-research-agent',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'development' }
});

server.stdout.on('data', d => { log.write('[STDOUT] ' + d); });
server.stderr.on('data', d => { log.write('[STDERR] ' + d); });

server.on('exit', (code, sig) => {
  log.write(`EXIT code=${code} signal=${sig}\n`);
  log.end();
  process.exit(code || 0);
});

// Keep running
setInterval(() => {}, 60000);
