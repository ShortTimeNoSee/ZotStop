# Contributing to ZotStop

Contributions are welcome, including small fixes, clearer wording, accessible interactions, and corrections to boarding guidance.

## Before you start

For a substantial change, open an [issue](https://github.com/ShortTimeNoSee/ZotStop/issues) to describe the problem and proposed behavior. For a small fix, a pull request is enough. Check existing issues and pull requests first.

Follow [Development](docs/development.md) to install dependencies and run the app. Routes and campus map data are bundled, so ordinary interface work does not require refreshing the feeds or creating a Cloudflare account.

## Make the change

- Keep the app usable without location permission and without an account.
- Provide a button or keyboard alternative for gesture interactions. Preserve visible focus, meaningful control labels, and readable text at larger sizes.
- Keep stops available outside the map. Route identity and data freshness should be understandable without relying on color alone.
- Check narrow phone layouts and desktop layouts. For native changes, also check system bars, back navigation, permission changes, and returning from the background.
- Keep transit calculations in `packages/transit-engine`, native integrations in `apps/mobile`, and shared design values in `packages/tokens/tokens.json`.
- Add or update a test when behavior changes. Prefer tests that exercise an observable outcome or a real edge case.

## Verify before opening a pull request

For web, engine, token, or Worker changes, run the same verification script used by CI:

```sh
bash .github/scripts/web-checks.sh
```

For Android changes, use the pinned emulator and tools described in [Development](docs/development.md), then run:

```sh
pnpm preflight
```

iOS changes need Xcode on macOS. CI also builds the iOS app and runs its simulator flow. A passing local check does not replace the remaining platform checks.

In your pull request, explain the problem, the change, and what you tested. Include before and after screenshots for visible changes. Note any platform you could not verify. Do not include real rider reports, precise personal locations, signing keys, credentials, or private logs.

## Data corrections

Route names, colors, stops, and shapes come from the operator’s GTFS feed. Share a link to official information when reporting a mismatch. Boarding guidance is maintained separately in the transit engine and should be checked at the actual stop when possible.

Generated feed and map changes should include their source, generation date, and a review of affected routes. Do not adjust route geometry simply to make it look smoother if the change would misrepresent the journey.

## Security and licensing

Use [private vulnerability reporting](SECURITY.md) for security problems. Contributions are provided under the repository’s [AGPLv3 license](LICENSE). Keep attribution and licensing information for any third party code or data you introduce.
