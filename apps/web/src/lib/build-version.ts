/**
 * The version shown in the app, as SemVer 2.0.0: the package version for a build of its release
 * tag, else with build metadata naming the commit (and ".dirty" for uncommitted changes), so a
 * build handed out between releases says exactly what it is.
 */
export function versionLabel(
  version: string,
  git: { tagged: boolean; commit: string; dirty: boolean } | null,
): string {
  if (!git || (git.tagged && !git.dirty)) return version;
  return `${version}+${git.commit}${git.dirty ? '.dirty' : ''}`;
}
