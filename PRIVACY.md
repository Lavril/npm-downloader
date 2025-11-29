# Privacy Policy

This extension does not collect or transmit personal data intentionally. It only performs requests to registries (the registry URL you enter, default is https://registry.npmjs.org/) in order to fetch package metadata and tarball URLs which are then downloaded by the browser.

## What the extension does:
- Fetches package metadata from the configured registry.
- Caches metadata locally using `chrome.storage.local`.
- Initiates downloads of tarballs via `chrome.downloads`.

## What it does NOT do:
- It does not transmit or store personally identifiable information to third-party servers.
- It does not collect telemetry.

If you have concerns or want to audit network calls, inspect the extension code before installing or run in a test profile.
