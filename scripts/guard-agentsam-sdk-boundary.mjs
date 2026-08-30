import { assertSdkBoundary, formatSdkBoundaryReport } from '../bin/lib/sdk-boundary.mjs';

try {
  const report = assertSdkBoundary();
  process.stdout.write(formatSdkBoundaryReport(report));
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
}
