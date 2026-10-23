# Privacy

Effective: July 28, 2026

YouTube Digest is a GitHub-only, bring-your-own-key Chrome extension. It has no YouTube Digest account, developer-operated backend, analytics, advertising, or telemetry.

## Data the extension handles

Depending on the feature you use, YouTube Digest handles:

- the canonical URL and video ID of the active YouTube video;
- transcript text and timestamps;
- video metadata such as title, channel, description, and duration;
- text you select in the transcript and nearby transcript context;
- transcript context around a timestamped note;
- content you ask to translate;
- notes you save;
- vocabulary entries and their source context;
- Supadata and DeepSeek configuration, including API keys; and
- cached transcript, digest, and translation results.

## Where data goes

### YouTube

The extension reads the active player’s selected caption track and retrieves its timestamped captions directly from YouTube.

### LangChain Academy multimedia lessons

The extension reads Academy lesson pages and public written lessons under `https://langchain-ai.github.io/lca-lessons/`. For videos nested inside those lessons, it reads native English caption cues and playback time from the matching Descript player. It also supports standalone Descript video sharing pages. Descript access is limited to `https://share.descript.com/embed/` and `https://share.descript.com/view/` URLs; it does not include Descript account or editing pages. When embedded video captions are unavailable, Digest uses the written lesson content.

### Supadata

YouTube Digest sends the canonical YouTube video URL to `https://api.supadata.ai` with your Supadata API key. Supadata returns the transcript and timestamps. Supadata is used as a fallback when the player caption track cannot be retrieved directly. The requested language follows the selected track when available.

### DeepSeek

The published version sends AI feature content to DeepSeek V4 Flash at `https://api.deepseek.com`:

- transcript plus relevant title, channel, description, or duration for an overview;
- selected text plus nearby transcript context for an explanation;
- small semantic transcript batches currently needed for progressive Chinese
  translation, or requested overview or explanation content;
- nearby transcript context and video metadata when polishing a saved note.

The endpoint and `deepseek-v4-flash` model are fixed in the published Settings page. You provide one DeepSeek API key. To use another provider or model, you must adapt your own local source copy and its permissions. The Settings page provides a coding-agent prompt for that purpose and warns you never to include an API key in the prompt or chat.

Requests go directly from the extension to Supadata or DeepSeek. They are authenticated with the keys you supply. YouTube Digest's developer does not proxy or receive these requests.

Those services process data under their own terms, privacy policies, retention practices, and account settings. Do not send confidential, personal, or regulated content unless their terms and your obligations permit it.

## Local storage and retention

YouTube Digest uses Chrome's local extension storage, not a YouTube Digest cloud service.

- Supadata and DeepSeek settings and API keys remain on the device in Chrome's extension storage.
- Saved notes remain until you delete them or remove/clear the extension's data. The extension keeps up to 100 notes.
- Vocabulary entries remain until you delete them or remove/clear the extension's data.
- Recent transcript, digest, and per-segment translation cache entries are stored
  locally. The cache is limited to 20 videos, and entries older than 30 days are
  removed when the side panel opens.

Chrome extension storage is not a password vault. Anyone with sufficient access to your browser profile or device may be able to recover locally stored keys or content. Use scoped keys where providers support them, set spending limits, and rotate or revoke a key if the device or browser profile is compromised.

To remove data:

- delete individual saved notes in YouTube Digest;
- delete individual vocabulary entries in YouTube Digest;
- use the Options page to clear cached digests, delete all notes, or reset all extension data;
- remove the extension or clear its stored data from Chrome to delete all local settings, keys, notes, and cache entries; and
- revoke keys in the Supadata or DeepSeek dashboard to stop their future use.

Clearing local data does not delete information already processed or retained by Supadata or DeepSeek. Use each service's controls for service-side requests.

## Permissions

YouTube Digest uses Chrome permissions for these purposes:

- `sidePanel`: display the YouTube Digest interface beside YouTube.
- `storage`: store settings, keys, notes, vocabulary, and cached results locally.
- `tabs`: identify and interact with the active YouTube tab.
- `scripting`: coordinate the extension's YouTube page controls.
- YouTube host access: read the active video's URL and metadata and provide timestamp controls.
- Supadata host access: retrieve transcripts.
- DeepSeek host access: provide AI overviews, explanations, translation, and note polishing through DeepSeek V4 Flash.

YouTube Digest does not use these permissions to monitor general browsing activity.

## No sale or advertising use

YouTube Digest does not sell personal information, build advertising profiles, or share data with data brokers. It does not include analytics SDKs.

## Changes

Privacy-relevant changes will be documented in this file and in the repository history. Review updates before installing a new version.

## Questions

This repository does not provide a public support or issue channel. Review this policy, the source code, and each provider's documentation before using the extension. For a vulnerability or accidental secret exposure, follow the private process in [SECURITY.md](SECURITY.md).

### LangChain Academy

The extension reads English captions from the player or visible text from the enrolled lesson you open. It does not collect your Academy password or session cookies, and Academy lesson content is never sent to Supadata. Overview, explanation, and optional translation send relevant lesson text to the configured AI provider. Study journal text and self-assessed progress remain in local extension storage unless you export them.

### Automatic English vocabulary collection

Auto-collect is enabled by default. Loaded transcript text is sent in chunks to the AI provider configured in Settings to suggest words and phrases for IELTS 7.0. Entries, American IPA, bilingual explanations, source sentences, timestamps, mastery status and scan progress are stored locally in Chrome. Vocabulary controls let you disable collection, delete entries and export notebooks. Disabling collection stops future scans; in-flight requests may finish.

Academy lesson text highlights store selected text, nearby text used to restore the selection, its lesson source URL, color, and creation time in local Chrome extension storage. These highlights are not sent to an AI service or to Web Highlights.
