import { assertSdkBoundary, formatSdkBoundaryReport } from '../../lib/sdk-boundary.mjs';

export async function sdkCmd(args = []) {
  const sub = args[0] || 'status';
  if (sub !== 'status') {
    throw new Error('usage: bin/agentsam sdk status');
  }
  const report = assertSdkBoundary();
  process.stdout.write(formatSdkBoundaryReport(report));
}
