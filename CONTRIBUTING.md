# Contributing

Issues and pull requests are welcome. Keep copy plain (no em dashes), and run `npm run check` and `npm run smoke` before you open a PR. Every command and flag lives in `contract.json`; `npm run check` fails if the CLIs drift from it.

## Support the project

If the kit helps you make a reel, a star on the [repo](https://github.com/wrg32786/aigent-talking-head) helps other creators find it. To share one you posted, [open a Show your reel issue](https://github.com/wrg32786/aigent-talking-head/issues/new?template=show-your-reel.md) or tag [@the_aigent_news](https://www.instagram.com/the_aigent_news/) on Instagram.

The CLI may print a one-line star reminder after your first successful render, and once more after five renders. It is skipped when stdout is not a TTY, when `CI` is set, when you pass `--json`, or when `AIGENT_NO_STAR=1`. A run that does not print the star reminder may instead print a one-line AIgent Academy invitation (`AIGENT_NO_SKOOL=1` turns it off). At most one line prints per run.

## Releases

Each feature PR is one minor version. In the PR: bump `version` in `package.json` and `contract.json` (and the version lines in `CITATION.cff`, `llms.txt`, `docs/faq.md` and the README citation), add a `## X.Y.0 (unreleased)` section at the top of `CHANGELOG.md`, and draft the release notes with `npm run release:notes -- --write --images docs/studio/<shot>.png,...`, then edit `docs/releases/vX.Y.0.md` into plain words. `npm run check` fails if the version has no CHANGELOG section or notes file. After the merge, the maintainer tags the merge commit and makes the GitHub release from that file (`gh release create vX.Y.0 --notes-file docs/releases/vX.Y.0.md`). Agents never make tags or releases.
