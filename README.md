# spike-layout

A.3 of the fab0 rebuild's stage A plan (`MIGRATION-P1.md` in fab0-dev/fab0): builds the worked example layout in `fab0-sandbox` as the fab0 App, and runs the checks A.3 asks for.

```bash
bun install
export FAB0_APP_KEY_PATH=/path/outside/any/checkout/fab0-app.pem
bun layout.ts                       # builds the layout; a second run prints "writes: 0"
bun checks.ts deliveries 30         # the App's webhook deliveries
bun checks.ts delivery <id>         # one delivery's payload, trimmed
bun checks.ts approve backend <pr>  # the App approves a PR
bun checks.ts snapshot 1            # run 1's snapshot query and its GraphQL cost
```

The private key is read from the file `FAB0_APP_KEY_PATH` names and never printed or stored here.
