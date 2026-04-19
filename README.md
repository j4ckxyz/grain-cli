# grain

`grain` is a simple command-line uploader for Grain.social.

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/j4ckxyz/grain-cli/main/scripts/install.sh | bash
exec "$SHELL" -l
grain login --handle your.handle
grain
```

## Core commands

```bash
grain help
grain start
grain login --handle j4ck.xyz
grain whoami
grain update
grain logout
grain drafts list
grain queue run
grain styles list
```

Small interactive animations are enabled in TTY by default. Disable them with:

```bash
GRAIN_NO_ANIM=1 grain
```

Run `grain` with no subcommand (or `grain start`) for the guided posting flow.

## Guided flow

- `grain start` opens a beginner-friendly posting flow.
- Includes a **Review before publish** step where you can publish, edit, or save draft.
- You can save unfinished galleries and resume later with `grain drafts resume --id <draft-id>`.
- Optional scheduling: choose a future publish time and it is added to queue.
- Optional retry queue: if network upload fails, it can auto-save to queue and retry later.

Queue commands:

```bash
grain queue list
grain queue run
grain queue clear
```

Draft commands:

```bash
grain drafts list
grain drafts resume --id d_...
grain drafts delete --id d_...
```

Reusable posting styles:

```bash
grain styles list
grain styles save --name "Street" --cw "violence" --exif include
grain styles delete --name "Street"
```

## Upload basics

```bash
grain upload-gallery \
  --title "Morning walk" \
  --description "Hi @alice.com #nature https://example.com" \
  --schedule-at "2026-05-01T09:30:00" \
  --queue-on-fail \
  --alt "Trees by the coast" \
  --alt "Clouds over the beach" \
  --image @img1.jpg \
  --image-url https://example.com/img2.jpg
```

Media formats:

- Local file: prefix with `@` (for example `@photo.jpg`, `@./images/a.jpg`)
- Remote URL: full `http://` or `https://` URL

## Alt text

- Manual alt text: repeat `--alt` in the same order as images.
- Optional AI alt text: provide endpoint/key/model flags.
- In wizard mode, the tool opens each image in your native viewer when manual alt input is needed.

## EXIF handling

- Default: `--exif include`
- Optional: `--exif exclude`
- If EXIF parsing or image metadata normalization fails for a specific file, the CLI now auto-recovers by normalizing the image to a safe JPEG upload path instead of failing the whole gallery.

## Login and security

- Uses secure browser-based login, no app passwords.
- On account switch, logging into a new account revokes the previous active session (best-effort) and updates local active account.
- Local config/session files live in:
  - `$XDG_CONFIG_HOME/grain-cli/config.json`, or
  - `~/.config/grain-cli/config.json`

Files are written with user-only permissions (`0600`).

## Notes on local dev install

Use the installer for a stable global command path. Repeated `bun link` / `bun install -g .` cycles can leave duplicate entries in Bun global metadata on some setups.

## Tests

```bash
bun test
bunx tsc --noEmit
```
