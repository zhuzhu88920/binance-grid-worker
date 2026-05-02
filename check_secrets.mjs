import { execSync } from 'child_process';
try {
  const result = execSync('npx wrangler secret list', {
    cwd: 'X:\\code\\binance-grid-worker',
    shell: true,
    stdio: 'pipe'
  });
  console.log(result.toString());
} catch(e) {
  console.error('stderr:', e.stderr ? e.stderr.toString() : 'none');
  console.error('stdout:', e.stdout ? e.stdout.toString() : 'none');
  console.error('status:', e.status);
}
