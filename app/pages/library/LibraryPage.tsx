import { ArtifactsDriveShell } from '../../src/components/library/ArtifactsDriveShell';

/** /dashboard/artifacts — Drive-parity library shell (Step 1: exact prototype UI). */
export default function LibraryPage() {
  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
      <ArtifactsDriveShell />
    </div>
  );
}
