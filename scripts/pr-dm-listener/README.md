# pr-dm-listener

A Slack DM containing a GitHub PR link pops a dialog; **Review** opens a workspace in the cmux
`pr-reviews` group running `/pr-workflows:pr-review <url>`, with the PR in a browser tab.

Slack pushes the DM over Socket Mode (no polling). A bot token cannot see your DMs, so the app
uses a **user** token.

## Setup

1. https://api.slack.com/apps → Create New App → From manifest, paste:

   ```yaml
   display_information: { name: PR DM Listener }
   oauth_config:
     scopes:
       user: [im:history, users:read]
   settings:
     event_subscriptions:
       user_events: [message.im]
     socket_mode_enabled: true
   ```

2. Install to the workspace; copy the **User OAuth Token** (`xoxp-…`).
3. Basic Information → App-Level Tokens → generate one with `connections:write` (`xapp-…`).
4. Store both:

   ```bash
   security add-generic-password -U -s pr-dm-listener-user -a "$USER" -w 'xoxp-…'
   security add-generic-password -U -s pr-dm-listener-app  -a "$USER" -w 'xapp-…'
   ```

5. Start it:

   ```bash
   sed "s|__HOME__|$HOME|g" com.bazak.pr-dm-listener.plist > ~/Library/LaunchAgents/com.bazak.pr-dm-listener.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bazak.pr-dm-listener.plist
   ```

Logs: `~/Library/Logs/pr-dm-listener.log`. Test: `node --test scripts/pr-dm-listener/`.
