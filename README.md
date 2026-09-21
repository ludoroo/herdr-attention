# Herdr Attention View

A small [Herdr](https://herdr.dev/) plugin that keeps the Agents panel focused on sessions that need attention. It shows agents that are:

- `blocked`, waiting for input; or
- `done`, with completed work that has not yet been seen.

Blocked agents sort first, followed by the most recently changed completed agents.

## Requirements

- Herdr 0.9.0 or newer
- Node.js 18 or newer, available on the `PATH` inherited by the Herdr server
- Linux or macOS

## Install

```sh
herdr plugin install ludoroo/herdr-attention
herdr plugin action invoke ludoroo.attention.activate
```

The activation command applies the view immediately to a running Herdr server. On later server starts, the plugin applies it automatically and retries briefly while Herdr's API socket becomes ready.

This repository is private. Configure GitHub HTTPS authentication before installation if needed:

```sh
gh auth login --hostname github.com --git-protocol https
gh auth setup-git
```

## Actions

```sh
# Reapply the attention view now
herdr plugin action invoke ludoroo.attention.activate

# Return to Herdr's unfiltered agent view until the next server start
herdr plugin action invoke ludoroo.attention.deactivate
```

The plugin owns only the view whose source is `plugin:ludoroo.attention`. Deactivation clears that view without modifying agents, panes, tabs, or workspaces. Because startup activates the view again, disable the plugin for a persistent opt-out:

```sh
herdr plugin disable ludoroo.attention
```

## Migrating from the local plugin

If the earlier `ludo.attention` development copy is linked, remove it before installing this package so both startup commands cannot race:

```sh
herdr plugin unlink ludo.attention
```

## Development

```sh
npm test
herdr plugin link "$(pwd)" --enabled
```

The implementation uses only Node.js built-ins and talks to Herdr's NDJSON socket API.

## Uninstall

Deactivate the view before uninstalling so the current server immediately returns to its unfiltered agent list:

```sh
herdr plugin action invoke ludoroo.attention.deactivate
herdr plugin uninstall ludoroo.attention
```

## License

MIT
