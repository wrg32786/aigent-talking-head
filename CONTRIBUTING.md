# Contributing

Issues and pull requests are welcome. Keep copy plain (no em dashes), and run `npm run check` and `npm run smoke` before you open a PR. Every command and flag lives in `contract.json`; `npm run check` fails if the CLIs drift from it.

## Support the project

If the kit helps you make a reel, a star on the [repo](https://github.com/wrg32786/aigent-talking-head) helps other creators find it. To share one you posted, [open a Show your reel issue](https://github.com/wrg32786/aigent-talking-head/issues/new?template=show-your-reel.md) or tag [@the_aigent_news](https://www.instagram.com/the_aigent_news/) on Instagram.

The CLI may print a one-line star reminder after your first successful render, and once more after five renders. It is skipped when stdout is not a TTY, when `CI` is set, when you pass `--json`, or when `AIGENT_NO_STAR=1`.
