# AGENTS.md

This file explains how to work on `grain` as a contributor/agent, while keeping the user experience simple.

## Product intent

`grain` should feel like a straightforward uploader for Grain.social:

- Sign in
- Add photos
- Add title/description/alt text
- Publish

Default to user-facing language. Mention protocol details only when they are needed for debugging or security context.

## UX rules

- Prefer plain wording over implementation details.
  - Good: "secure browser login"
  - Avoid in general help copy: "ATProto OAuth loopback flow"
- Keep command help concise.
- Keep upload success output focused on:
  - gallery URL
  - library URL
  - critical warnings only
- If auto-recovery happens (for odd image formats), log one concise line per file.

## Login/session behavior

- `grain login` must use browser-based login.
- Logging in to a different account should replace active account and revoke previous active session when possible.
- `grain logout` clears local session state.

## Media handling behavior

- Accept local paths and remote URLs.
- `@path` is required in wizard media entry, but CLI flags can pass local paths directly.
- EXIF mode:
  - default `include`
  - optional `exclude`
- Upload flow must be resilient:
  - if EXIF parsing fails: continue without EXIF for that file
  - if metadata stripping fails: normalize image and continue
  - if dimensions are unreadable: attempt fallback normalization and continue
  - fail only when file cannot be made uploadable

## Alt text behavior

- Manual alt text should always be supported.
- AI alt is optional.
- If AI alt fails and fallback prompting is available, ask user for manual alt.

## Docs expectations

- README should optimize for first-run success.
- Put quick start first.
- Keep security section practical and short.
- Keep protocol internals in this file or deeper docs, not front-and-center in README/help.

## Release/update flow

## Versioning standard (required)

- Use semantic versioning in `package.json` as `x.y.z`.
- Increment rules:
  - `x` (major): breaking behavior or incompatible command changes.
  - `y` (minor): new features that are backward-compatible.
  - `z` (patch): bug fixes, docs updates, and non-breaking polish.
- Any user-facing release to GitHub/Tangled must include an intentional version decision.
- `grain update` output should stay plain-language and user-facing (not implementation jargon).

When shipping user-facing changes:

1. Run `bun run check`.
2. Bump `package.json` version according to semantic versioning.
3. Keep README aligned with actual CLI behavior.
4. Push to GitHub `main`.
5. Mirror same `main` to Tangled remote.
