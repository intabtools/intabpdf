# Security policy

InTab PDF promises that your files never leave your device. If you find something that breaks this promise, or any other security problem, thank you for telling us. Please do it privately first.

## How to report

Please do not open a normal public issue for a security problem. This repo is public, so everyone can see issues.

**Option 1: GitHub private reporting (preferred)**

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Tell us what you found, how to repeat it, and which browser, device or app version you used.

**Option 2: Email**

If you cannot or do not want to use GitHub, email intabtools@gmail.com with "Security" in the subject line. Please do not put full exploit details in any public place.

## What counts

- Anything that sends a user's file, file name or file text over the network
- Tracking, analytics or third-party scripts
- A weaker Content-Security-Policy
- A crafted PDF that crashes the app or runs unwanted code
- Weaker Electron security settings (context isolation, sandbox or web security turned off, Node integration turned on)
- A new Android permission, or a plugin that talks to a server
- A leaked signing key, keystore, password or other secret
- A known vulnerability in a library we use (for example PDF.js or Electron)

If you only have a question about our privacy rules, a normal issue with the `privacy` label is fine. See [docs/privacy.md](docs/privacy.md).

## What to expect

We are a small student team, so we cannot promise a fixed time. We will try to reply within 7 days, fix confirmed problems quickly, and explain what happened in simple words. If you like, we will happily mention your name as a thank you.

Please give us a chance to fix the problem before you share the details publicly. We welcome good-faith security research, and we will not take action against people who report problems responsibly.

## Official downloads

InTab PDF is only distributed through these places:

- [GitHub Releases](https://github.com/intabtools/intabpdf/releases) (every release includes SHA-256 checksums)
- Our other official listings (Microsoft Store and F-Droid), linked from the [README](README.md) once they are published

Anything else is not ours. If you find a fake copy of InTab PDF, or a channel pretending to be us, please report it the same way as a security problem.

## Supported versions

There is no release yet. Once we have releases, only the latest one will be supported.