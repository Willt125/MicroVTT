# Contributing to MicroVTT

Thanks for helping. This file covers how changes are written, reviewed and released. For setting
up and running the project, see the [README](README.md#development). To report a problem or ask
for a feature, [open an issue](https://github.com/Willt125/MicroVTT/issues/new/choose).

The repository is public. Never commit or attach caption files, media or anything else that is
private or someone else's work. Real files for local testing go in `tests/private-fixtures/`,
which git ignores.

## Commits and pull request titles

Commit messages and pull request titles follow
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
type(scope): description

Body: what changed and why, wrapped at 72 characters.

Footers, such as "Fixes #123" or "BREAKING CHANGE: …"
```

- **type** is one of:

  | Type       | For                                                         | Version impact |
  | ---------- | ----------------------------------------------------------- | -------------- |
  | `feat`     | something new users can do or see                           | minor          |
  | `fix`      | a bug fix users can notice                                  | patch          |
  | `perf`     | faster or lighter, with the same behaviour                  | patch          |
  | `refactor` | code changes with no change in behaviour                    | none           |
  | `test`     | tests only                                                  | none           |
  | `docs`     | documentation only                                          | none           |
  | `build`    | the build, dependencies or packaging                        | none\*         |
  | `ci`       | CI workflows and repository automation                      | none           |
  | `chore`    | anything else that users cannot notice (including releases) | none           |
  | `style`    | formatting only                                             | none           |
  | `revert`   | undoing an earlier commit                                   | as reverted    |

  \* Unless the change is one users can notice, such as dropping support for a browser; then it
  is `feat` or `fix`, as fits.

- **scope** is optional and names the area: `core`, `web`, `srt`, `timeline`, `export`, `deps` and
  so on. Use lower case, with no spaces.
- **Breaking changes** (see [Versioning](#versioning)) get a `!` after the type or scope, as in
  `feat(export)!: …`, and a `BREAKING CHANGE:` footer saying what breaks and what to do about it.
- **description** is imperative ("add", not "added"), starts in lower case unless it begins with
  a name, and has no full stop. The whole header is at most 72 characters.

Each commit should build and pass its tests on its own. Keep unrelated changes in separate
commits, and separate pull requests where you can.

## Pull requests

- **One topic per pull request.** The title is a Conventional Commits header, and a CI check
  (`PR title`) enforces it. Pull requests are **squash-merged**, so the title becomes the single
  commit on `main` and the pull request number is added to it. Write the title for someone reading
  `git log` in a year.
- **Fill in the template:** what and why, the version impact, and how it was tested. Link issues
  with `Fixes #123`, so they close on merge.
- **CI must be green:** lint, typecheck, unit tests, both builds, and the end-to-end tests in
  Chromium, Firefox and WebKit. A failing test is fixed, not skipped or retried until it passes.
- **Update the docs with the code:** add a `CHANGELOG.md` entry under **Unreleased** for anything
  users can notice, update `docs/MANUAL.md` when the way the editor is used changes, and update
  `docs/FEEDBACK.md` when the pull request settles a reported issue.
- **Branch from `main`.** Don't rewrite history on a branch someone else is working on. On your
  own branch, rebase or amend as you like until review starts.

## Versioning

MicroVTT follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). Versions are
`MAJOR.MINOR.PATCH`, tagged `vMAJOR.MINOR.PATCH` on `main`. The packages in this repository
(`@microvtt/web`, `@microvtt/core`) all carry the same version.

### The public API

MicroVTT is an application, so its public API (SemVer §1) is what users and their files rely on:

1. **Files it writes:** the WebVTT and SubRip output for given options. This means the bytes:
   conformance, line endings, encoding, what the compatibility fixes do.
2. **Files it reads:** which files open, and how they are read and repaired on import.
3. **Keyboard shortcuts** and the other ways of working described in `docs/MANUAL.md`.
4. **What it keeps in the browser:** autosave, the glossary, settings and rule choices. A new
   version must still read what an older one stored.
5. **The single-file build:** that `microvtt.html` works when opened from disk.

The code itself, `@microvtt/core` included, is not part of the public API while its packages
are private. It can change freely as long as the above holds.

### What bumps what

- **MAJOR:** a change that breaks the public API. Examples: removing or reassigning a shortcut,
  writing different output for the same input and options (other than a fix), refusing files
  that used to open, losing stored autosaves or glossaries.
- **MINOR:** something new that keeps the public API working. Examples: a new tool, option,
  shortcut or format.
- **PATCH:** a fix that keeps the public API working, bringing behaviour back to what is
  documented or plainly intended.

**While the version is 0.y.z,** SemVer allows anything to change (§4). Here, a breaking change
bumps MINOR and everything else bumps PATCH. It is still marked `!` and listed under
**Changed** or **Removed** in the changelog, so nothing breaks unannounced. Version 1.0.0 will
mark the first release the owner commits to keeping stable; from then on, breaking changes bump
MAJOR.

## Releasing

Releases are cut by the maintainer, from `main`:

1. Decide the version from the changelog's **Unreleased** entries, using the rules above.
2. In a pull request titled `chore(release): X.Y.Z`:
   - set `"version"` to `X.Y.Z` in every `package.json`;
   - rename **Unreleased** in `CHANGELOG.md` to `[X.Y.Z] - YYYY-MM-DD`, start a new empty
     **Unreleased** above it, and update the comparison links at the bottom.
3. After it merges, tag its squash commit with an annotated tag and push the tag:
   `git tag -a vX.Y.Z -m "MicroVTT X.Y.Z" <commit>`, then `git push origin vX.Y.Z`.
4. The **Release** workflow then publishes the GitHub release. It checks that the tag is a SemVer
   version matching every `package.json`, takes the changelog's section for the version as the
   notes, builds `microvtt.html` from the tag (which then shows the plain version), and attaches
   it. A version with a pre-release part, such as `1.0.0-rc.1`, is marked as a pre-release. If a
   check fails, nothing is published: fix the cause on `main` in a new pull request, then delete
   the tag and tag again.

Builds handed out between releases come from `main` and are not versions. Hand out a tagged
release when you can.
