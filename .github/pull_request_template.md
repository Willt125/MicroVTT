<!--
The title is the commit that lands on main (pull requests are squash-merged), so write it as a
Conventional Commits header: "type(scope): description", e.g. "fix(web): keep the playhead when
seeking". Add "!" after the type or scope for a breaking change. See CONTRIBUTING.md.
-->

## What and why

<!-- What changes for users or for the code, and why. Link issues with "Fixes #123". -->

## Version impact

<!-- Tick one. The public API is defined in CONTRIBUTING.md, "Versioning". -->

- [ ] None (docs, tests, CI, refactoring with no change users can notice)
- [ ] Patch: a fix
- [ ] Minor: a new feature (or, while the version is 0.y.z, a breaking change)
- [ ] Major: a breaking change (from 1.0.0 on)

## Testing

<!-- What you ran, and in which browsers. CI runs Chromium, Firefox and WebKit. -->

## Checklist

- [ ] The title is a Conventional Commits header.
- [ ] `CHANGELOG.md` has an entry under "Unreleased" for anything users can notice.
- [ ] `docs/MANUAL.md` is updated if the way the editor is used changed.
- [ ] Nothing private or third-party (caption files, media, names) is included.
