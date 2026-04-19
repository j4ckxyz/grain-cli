# grain

`grain` is a Bun-based CLI for uploading galleries to Grain.social over the AT Protocol.

It is **not** a Bluesky product client. It uses ATProto primitives and OAuth.

## Security model

- Login uses **ATProto OAuth** with a localhost callback (`127.0.0.1`), not app passwords.
- OAuth scope is restricted to the app requirements:
  - `atproto`
  - `blob:image/*`
  - `repo:social.grain.actor.profile`
  - `repo:social.grain.comment`
  - `repo:social.grain.favorite`
  - `repo:social.grain.gallery`
  - `repo:social.grain.gallery.item`
  - `repo:social.grain.graph.follow`
  - `repo:social.grain.photo`
  - `repo:social.grain.photo.exif`
  - `repo:social.grain.story`
- OAuth state/session files are stored under `~/.config/grain-cli` (or `$XDG_CONFIG_HOME/grain-cli`) with `0600` permissions.

## Defaults

- AI alt text: **off** (opt-in)
- EXIF metadata: **included**
- Location metadata: optional, but recommended

## Install

Prerequisites:

- macOS or Linux
- Bun installed: https://bun.sh/docs/installation

### Quick install (curl | bash)

```bash
curl -fsSL https://raw.githubusercontent.com/j4ckxyz/grain-cli/main/scripts/install.sh | bash
```

Then refresh your shell:

```bash
exec "$SHELL" -l
```

### Local dev install

```bash
bun install
bun install -g .
```

## Commands

```bash
grain help
```

Login:

```bash
grain login --handle j4ck.xyz
```

Show active account:

```bash
grain whoami
```

Logout:

```bash
grain logout
```

Upload gallery (non-interactive):

```bash
grain upload-gallery \
  --title "Morning walk" \
  --description "Hi @alice.com #nature https://example.com" \
  --location-name "St Ouen" \
  --location-value "8a1862806aa7fff" \
  --country JE \
  --cw nudity \
  --exif include \
  --alt "Trees by the coast" \
  --alt "Clouds over the beach" \
  ./img1.jpg ./img2.jpg
```

Upload with image URLs:

```bash
grain upload-gallery \
  --title "City textures" \
  --description "Street art and signs #urban" \
  --image-url https://example.com/photo1.jpg \
  --image-url https://example.com/photo2.jpg
```

AI alt text (OpenAI-compatible API, optional):

```bash
grain upload-gallery \
  --title "Food market" \
  --description "Saturday market #food" \
  --alt-ai-endpoint https://api.openai.com/v1 \
  --alt-ai-api-key $OPENAI_API_KEY \
  --alt-ai-model gpt-4.1-mini \
  --image-url https://example.com/market.jpg
```

AI config can also be provided via env vars:

- `GRAIN_ALT_AI_ENDPOINT`
- `GRAIN_ALT_AI_API_KEY`
- `GRAIN_ALT_AI_MODEL`

If `--alt` is set for an image, manual alt wins and AI is skipped for that image.

## Interactive mode

Run:

```bash
grain
```

Media entry format in wizard:

- local file: `@photo.jpg` or `@./images/a.jpg`
- remote URL: `https://...`

If AI alt is enabled in wizard, manual prompts are skipped unless generation fails.

## Error handling

Errors are printed in a structured form:

- `Error [code]: message`
- optional actionable hint

Examples include missing gallery title, invalid media URL, AI alt failures, and OAuth/session issues.

## Testing

```bash
bun test
bunx tsc --noEmit
```
