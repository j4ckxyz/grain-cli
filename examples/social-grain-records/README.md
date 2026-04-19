# social.grain record examples (j4ck.xyz)

This folder contains real record-shape examples pulled from `j4ck.xyz` on the `https://eurosky.social` PDS.

## Files

- `actor-profile.example.json` - Profile metadata for the Grain app namespace (`social.grain.actor.profile`).
- `graph-follow.example.json` - Follow edge to another DID (`social.grain.graph.follow`).
- `photo.example.json` - Photo post object with image blob and display metadata (`social.grain.photo`).
- `photo-exif.example.json` - EXIF/technical metadata linked to a photo (`social.grain.photo.exif`).
- `gallery.example.json` - Gallery/album object with title and optional location (`social.grain.gallery`).
- `gallery-item.example.json` - Join record that adds an item (usually a photo) to a gallery (`social.grain.gallery.item`).
- `story.example.json` - Story object with media and optional location (`social.grain.story`).
- `comment.example.json` - Comment text on a subject AT-URI (`social.grain.comment`).
- `favorite.example.json` - Favorite/like record targeting a subject AT-URI (`social.grain.favorite`).

## Common envelope pattern

Each `com.atproto.repo.listRecords` response item has:

- `uri` - Stable AT-URI of this record (`at://did/collection/rkey`).
- `cid` - Content identifier for this version of the record.
- `value` - The lexicon-defined payload.

Inside `value`, Grain record types consistently include:

- `$type` - Lexicon NSID for the record type.
- `createdAt` - ISO timestamp when the record was created.

## How records connect together

### 1) Actor/profile layer

- `social.grain.actor.profile` represents app-specific identity info (display name, avatar blob, bio text).

### 2) Content layer

- `social.grain.photo` stores an uploaded image blob plus alt text/aspect ratio.
- `social.grain.story` stores story media (blob) and optional location metadata.
- `social.grain.gallery` stores a gallery container (title, address/location context).

### 3) Linking layer

- `social.grain.gallery.item` links a `gallery` AT-URI to an `item` AT-URI, with `position` for ordering.
  - In your sample, `item` points to `social.grain.photo`.
- `social.grain.photo.exif` links back to a photo through `photo` (AT-URI), adding camera metadata.

### 4) Social-interaction layer

- `social.grain.comment` references any target record via `subject` (AT-URI) plus comment `text`.
- `social.grain.favorite` references any target record via `subject` (AT-URI).
- `social.grain.graph.follow` references an actor DID in `subject`.

## Relationship examples from these files

- `gallery-item.example.json` -> `value.gallery` points to `gallery.example.json`'s URI.
- `gallery-item.example.json` -> `value.item` points to `photo.example.json`'s URI.
- `photo-exif.example.json` -> `value.photo` points to `photo.example.json`'s URI.
- `comment.example.json` and `favorite.example.json` each target a record via `value.subject`.

## Practical graph model

You can model Grain data as:

- Nodes: records (`photo`, `gallery`, `story`, actor profile, etc.)
- Edges: URI or DID references (`gallery.item`, `photo.exif`, `favorite.subject`, `comment.subject`, `follow.subject`)

That makes hydration straightforward:

1. Fetch primary nodes (e.g., gallery).
2. Resolve join edges (`gallery.item`) to get ordered content items.
3. Hydrate item nodes (`photo`) and optional metadata nodes (`photo.exif`).
4. Attach interaction overlays (`favorite`, `comment`) by matching `subject` URI.
