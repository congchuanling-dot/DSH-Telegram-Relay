# DSH-Telegram-Relay

A standalone DeepSeek Harness plugin bundle that adds the model-callable
`hello_plugin` tool.

## Local test

The current Harness release-candidate packages have not been published to npm.
For local source development, link the tool package from the adjacent Harness
checkout, then install this bundle into the Web profile:

```sh
PLUGIN_DIR="$(pwd)"
pnpm link ../deepseek-harness/packages/core/tools
pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PLUGIN_DIR"
pnpm --dir ../deepseek-harness dsh --profile web --dump-config
pnpm --dir ../deepseek-harness dsh web
```

Ask the Web agent to use `hello_plugin` to greet Ada. It returns `Hello, Ada!`.

## Package contents

- `index.js` exports the Cordis plugin and registers `hello_plugin`.
- `cordis.patch.yml` inserts the plugin into a profile.
- `package.json` marks this package as a `dsh.bundle`.

`@deepseek-ai/dsh-tools` is a peer dependency because the installed DSH runtime
owns the tool registry. When that package is published, replace the local
development link with an npm-installed compatible version.

## Publish

Publish the package with prebuilt files:

```sh
npm publish
```

Users then install it with:

```sh
dsh plugin --profile <profile> add dsh-telegram-relay
```

For GitHub installation, keep the package self-contained and add a `prepare` script that produces every runtime file.
