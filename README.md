<p align="center">
  <img src="assets/social-preview.png" alt="utm-guard — clean analytics, enforced at the source." width="820">
</p>

<p align="center">
  <img alt="npm version" src="https://img.shields.io/npm/v/utm-guard?color=black">
  <img alt="npm downloads" src="https://img.shields.io/npm/dm/utm-guard?color=black">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-black">
  <img alt="Node 18+" src="https://img.shields.io/badge/node-%3E%3D18-black">
  <img alt="Zero dependencies" src="https://img.shields.io/badge/dependencies-0-black">
</p>

# utm-guard

Build UTM-tagged URLs from a controlled vocabulary that refuses unknown values, and lint your files for links that forgot their tags. Clean analytics, enforced at the source.

## The Problem

To know where your visitors come from, you tag your links. A UTM tag is just text bolted onto a URL: `?utm_source=linkedin`. The trouble is that it is *just text*, and text drifts.

One person writes `linkedin`, another writes `LinkedIn`, a third writes `li`. Your analytics treats those as three different sources, and your traffic picture splinters into pieces that should have been one. Worse, when someone forgets the tag entirely, that visit shows up as **direct**, as if the person arrived from nowhere. So the truth about where your audience comes from quietly rots, one inconsistent or missing tag at a time.

Here is what that costs. On a site I run, an attribution audit found that about 70 percent of our "direct" traffic was not direct at all. It was shared links that had gone out untagged. We had been flying blind on most of our reach without knowing it.

The fix is one idea: **write your allowed values down once, then enforce them.** When you build a link, refuse any source, medium, or campaign that is not on the list, so `linkedin` can never quietly become `LinkedIn`. And scan your files for links that forgot their tags, so a missing tag fails a check instead of silently becoming "direct."

## What it does

Two commands around one vocabulary:

- **`build`** makes a tagged URL, and refuses any value that is not in your vocabulary.
- **`lint`** scans your files for outbound links to your domain that are missing their tag, or that carry tag values outside your vocabulary. A hand-written `utm_source=LinkedIn` splinters analytics just as badly as a missing tag, so both fail the check.

## Demo

```text
$ utm-guard build /guides/arc-registration --source linkedin --campaign launch
https://example.com/guides/arc-registration?utm_source=linkedin&utm_medium=social&utm_campaign=launch
  medium "social" inferred from source "linkedin"

$ utm-guard build /guides/arc-registration --source LinkedIn --medium social
utm-guard: refused.
  --source "LinkedIn" is not in the vocabulary. Allowed: newsletter, linkedin, x, facebook, instagram, tiktok, youtube, pinterest, reddit, whatsapp, telegram, discord, github

$ utm-guard lint
utm-guard: FAIL. 2 issue(s) on example.com links across 1 file(s).

  examples/content/bad-post.md:7  https://example.com/guides/how-jeonse-works  (missing utm_source)
  examples/content/bad-post.md:15  https://example.com/guides/how-jeonse-works?utm_source=LinkedIn&utm_medium=social  (utm_source "LinkedIn" is not in the vocabulary)
```

The second command is refused because the vocabulary only allows lowercase `linkedin`. That refusal is the whole point: the bad value never makes it into a real link. And when a bad value is already sitting in a file, `lint` names it, with the file and line to fix.

## Quick Start

See it work:

```bash
git clone https://github.com/hwajongpark/utm-guard
cd utm-guard
npm run demo:build    # prints a tagged URL
npm run demo:refuse   # shows a refusal
npm run demo:lint     # catches an untagged link
```

Use it on your own project:

```bash
npm install --save-dev utm-guard

# copy the example vocabulary and edit it
cp node_modules/utm-guard/examples/utm.vocab.example.json ./utm.vocab.json

# build a tagged link (medium is inferred from the source when the
# vocabulary has a defaultMediumForSource entry for it)
npx utm-guard build /guides/arc --source linkedin --campaign launch

# check that nothing shipped untagged or wrongly tagged
npx utm-guard lint
```

After copying the example vocabulary, point `lint.scanDirs` at your own content directories. If you leave it at a path that does not exist, `lint` will tell you so loudly instead of passing on zero files.

Wire the lint into your build so an untagged link fails the deploy:

```json
{
  "scripts": {
    "prebuild": "utm-guard lint"
  }
}
```

## Configuration

One `utm.vocab.json` at your project root. The included [`examples/utm.vocab.example.json`](examples/utm.vocab.example.json) is the demo vocabulary.

```json
{
  "baseUrl": "https://example.com",
  "sources": ["newsletter", "linkedin", "x", "instagram", "youtube", "reddit", "whatsapp", "github"],
  "mediums": ["social", "email", "bio", "cpc", "comment", "video-description", "dm", "referral"],
  "defaultMediumForSource": {
    "newsletter": "email",
    "linkedin": "social",
    "whatsapp": "dm",
    "github": "referral"
  },
  "lint": {
    "scanDirs": ["content"],
    "extensions": [".md", ".mdx", ".html", ".txt"],
    "urlHost": "example.com",
    "requireParam": "utm_source"
  }
}
```

- **`baseUrl`**: lets `build` tag a relative path like `/guides/arc`.
- **`sources`, `mediums`**: your allowed values. `build` refuses anything not listed, and `lint` flags links whose tag values fall outside them.
- **`defaultMediumForSource`** (optional): the medium `build` uses when you omit `--medium`. In practice most sources have one obvious medium (a chat app is `dm`, a newsletter is `email`), so this removes the flag from the common case. Pass `--medium` explicitly when the inference is wrong, e.g. a profile bio link wants `bio`, not `social`.
- **`campaigns`** (optional): campaign names rarely stay a closed set for long, so by default `utm_campaign` is validated as lowercase kebab-case (`spring-launch`, not `Spring_Launch`). If you do want a closed list, add a `campaigns` array and membership becomes the rule, as before.
- **`lint`**: where to scan, which file types, the domain whose outbound links must be tagged, and the param they must carry. All values are treated as literal data, never as patterns.

`build` also takes `--content` for `utm_content` (a kebab-case variant tag such as `bio-link` or `carousel-slide-1`, for telling apart placements within one campaign) and `--force` (see the next section).

## Two rules that save you later

Two operational rules that are easy to learn the expensive way:

1. **Never put UTM tags on internal links** (page A to page B on your own site). Analytics tools treat UTM params as the start of a new attribution: an internal tagged link resets the session's source and erases the original referrer, so "Reddit, then three pages, then signup" becomes "internal campaign, then signup". Tag only the links you publish *outside* your site: posts, bios, emails, ads, chat shares. Point `lint.scanDirs` at those outbound surfaces, not at your site content.

2. **Tag first, wrap second, and keep tagging idempotent.** If links pass through a shortener or an email provider's click-tracking redirect, apply UTM params *before* that wrapping so they ride along to the destination. And any pipeline that adds tags automatically should skip links that already carry `utm_source` rather than overwrite them. `build` enforces this: it refuses a target URL that already carries `utm_*` params and asks for `--force` when you really do mean to re-tag. Note that `lint` matches your `urlHost` only, so links hidden behind a wrapper domain are invisible to it; lint the files that hold the unwrapped URLs.

## How It Works

**One vocabulary, two jobs.** The same list of allowed values powers both generating links and auditing them. There is a single source of truth, not one rule for writing and another for checking.

**It enforces at generation time, not audit time.** The cheapest moment to stop a bad tag is before the bad URL exists. `build` refuses `LinkedIn` up front, so you never have to hunt it down in analytics three weeks later.

**No dependencies.** It is plain Node: it builds URL strings with the standard library and scans files with the standard library. Nothing to audit but the one file.

**Exit codes are built for CI.** `0` clean, `1` something was refused, untagged, or wrongly tagged, `2` a config or usage error. Drop `utm-guard lint` in `prebuild` and an untagged link fails the deploy, not your analytics. A lint run that scanned zero files warns loudly, and exits `2` when every configured scanDir is missing, so a misconfigured check can never masquerade as a green one.

## What It Does Not Do

- It does not talk to Google Analytics or any provider. It governs the links you create and ship, which is the part you control.
- It does not rewrite existing links. `lint` reports them with file and line; you fix them.
- It does not check that the destination resolves. It checks that the tag is present and from your vocabulary.

## Contributing

Contributions are welcome. Bug reports, a `lint` false positive, an untagged link it missed, or an idea for a new check all help. The fastest way to land a fix is a failing example under [`examples/content/`](examples/content) plus the result you expected. Run the test suite with:

```bash
npm test
```

## License

[MIT](LICENSE)
