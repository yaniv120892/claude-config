---
name: run-service-in-docker
description: Use when running or starting a service locally and the repo has a Dockerfile — runs the app inside its own Dockerfile-built container (not bare-node/host process) so base-image, OS-library, and dependency regressions surface locally. Use when about to npm run watch / npm start / dev a service, when validating before push/deploy, or when a bug only reproduces in dev/prod and not locally.
---

# Run Service in Docker (locally)

## Overview

Run a service locally **inside the container image built from its own Dockerfile**, not as a bare host process (`npm run watch`, `npm start`, `nodemon`, etc.).

**Core principle:** a host process uses your machine's Node/OpenSSL/system libraries — never the production base image. Base-image and OS-level regressions (a floating base-image tag rebuilt upstream, a new OpenSSL/undici, a native-module break) are therefore **invisible** to bare-node local runs. Running the app in its real container closes that gap.

This is the default way to run a service locally. Bare-node is the exception, for tight inner-loop iteration only.

## When to use

- About to start/run/dev a service that has a `Dockerfile`.
- Validating a change before push or deploy.
- A bug reproduces in dev/prod but **not** locally (suspect base-image / OS-library / dependency drift).
- Verifying a base-image bump (e.g. un-pinning a digest) before shipping it.

## When NOT to use

- Repo has no `Dockerfile` (nothing to containerize).
- Pure unit/lint runs — those don't need the runtime image.

## The trap this exists to prevent

`npm run docker:up` (or `docker compose up`) in many repos starts **infra only** (DB, cache, queue, Temporal, LocalStack) while the app still runs on the host. Bringing up `docker:up` and *also* `npm run watch` feels like "running in Docker" but the app process is still on host Node — the base image is never exercised. **Always confirm the app itself runs in a container built from the Dockerfile.**

## Procedure

```dot
digraph run_in_docker {
  "Dockerfile + compose exist?" [shape=diamond];
  "Does compose run the APP\n(a service with build: -> Dockerfile)?" [shape=diamond];
  "Add app service built from ./Dockerfile" [shape=box];
  "Bring up; verify app started IN container" [shape=box];
  "no Dockerfile -> skill N/A" [shape=box];

  "Dockerfile + compose exist?" -> "no Dockerfile -> skill N/A" [label="no Dockerfile"];
  "Dockerfile + compose exist?" -> "Does compose run the APP\n(a service with build: -> Dockerfile)?" [label="yes"];
  "Does compose run the APP\n(a service with build: -> Dockerfile)?" -> "Bring up; verify app started IN container" [label="yes"];
  "Does compose run the APP\n(a service with build: -> Dockerfile)?" -> "Add app service built from ./Dockerfile" [label="no (infra-only)"];
  "Add app service built from ./Dockerfile" -> "Bring up; verify app started IN container";
}
```

1. **Detect** — find the `Dockerfile`, the compose file, and the run scripts in `package.json`. Read the compose `services:`.
2. **Classify** — does any compose service build the app from the Dockerfile (a `build:` context pointing at it)? Or is compose **infra-only** (every service is a stock `image:`)? If a service runs `npm run watch`/`npm start` on the **host**, the app is NOT containerized.
3. **Discover repo specifics** (needed to build the app service correctly):
   - **Listen port** — read the Dockerfile `EXPOSE` and `CMD`, the `PORT` env in `.env.local`, and the server bootstrap. Map it host:internal.
   - **Run command** — use the Dockerfile's production `CMD` (e.g. `node dist/server.js`), NOT the host watch command. Image fidelity is the goal; inner-loop watch stays bare-node.
   - **Dependencies & their env var names** — grep the app for how it reaches each infra service (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`/`RABBITMQ_URL`, `TEMPORAL_ADDRESS`, `AWS_ENDPOINT`, …) so you know which vars to rewrite.
   - **Build args & secrets** — `grep -E 'ARG |--mount=type=secret' Dockerfile` to enumerate exactly what the build needs.
4. **If infra-only, add an app service** (see below) and a `docker:app` / `docker:full` script.
5. **Run** — bring up infra + app; `--build` so the Dockerfile is actually built. Use the **same `-p <project>` name** as the existing `docker:up` (or the repo dir name) so the app joins the already-running infra network rather than spawning a parallel one.
6. **Verify** — confirm the container is up *and the app logged its real startup* (server listening / worker registered / migrations ran) **from inside the container** (`docker compose logs -f app`), not a host process. Report the built image digest if relevant.

## Adding an app service to an infra-only compose

Three things are repo-specific and must be handled — they are where this goes wrong:

### 1. Networking rewrite (host ports → compose hostnames)

Inside the compose network the app reaches dependencies by **service name + internal port**, NOT `localhost:<host-mapped-port>`. Override the app's connection env accordingly:

**Rule:** for *every* dependency, the in-container target is `<compose-service-name>:<internal-port>`. The internal port is the **right-hand side** of the compose `ports:` mapping (`5434:5432` → use `5432`); the host port (left side) only works from your host, not from inside the network. The table below is illustrative, not exhaustive — derive each row from the actual compose file.

| Dependency | Host (bare-node) | In-container (compose) | Typical env var |
|---|---|---|---|
| Postgres | `localhost:5434` | `postgres:5432` | `DATABASE_URL` |
| Redis | `localhost:6381` | `redis:6379` | `REDIS_URL` |
| RabbitMQ (AMQP) | `localhost:5672` | `rabbitmq:5672` | `AMQP_URL` / `RABBITMQ_URL` |
| Temporal | `localhost:7233` | `temporal:7233` | `TEMPORAL_ADDRESS` |
| LocalStack (SQS/S3/SNS) | `localhost:4566` | `localstack:4566` | `AWS_ENDPOINT` |

Service names come from the compose `services:` keys in *that* repo — match them exactly.

### 2. Build args & secrets

The Dockerfile may need build `ARG`s and secret mounts. Surface them in the compose `build:` block. Example shape (ai-workflow-engine needs `PROJECT_ID`, `NPM_TOKEN`, `PORT`, and an npmrc secret mount):

```yaml
  app:
    build:
      context: ..
      dockerfile: Dockerfile
      args:
        PROJECT_ID: ${PROJECT_ID:-local}
        PORT: "3000"
      secrets:
        - npmrc
    env_file:
      - ../.env.local
    environment:
      DATABASE_URL: postgres://postgres:mysecretpassword@postgres:5432/ai-workflows
      REDIS_URL: redis://redis:6379
      TEMPORAL_ADDRESS: temporal:7233
      AWS_ENDPOINT: http://localstack:4566
    depends_on:
      - postgres
      - redis
      - temporal
      - localstack
    ports:
      - "3000:3000"
secrets:
  npmrc:
    file: ../.gitlab.npmrc
```

Add scripts:
```json
"docker:app": "docker compose -f bin/docker-compose.yml -p <project> up -d --build app",
"docker:full": "docker compose -f bin/docker-compose.yml -p <project> up -d --build"
```

### 3. Env source of truth

Containerized app must read the same `.env.local` the host run uses (`env_file:`), then have the host-vs-network values **overridden** by `environment:` (rule 1). Don't bake secrets into the image.

## Fidelity boundary (state this when reporting)

- **Catches:** base-image / OS-library drift (the AIP-649 class), OpenSSL/undici/TLS-layer regressions, native-module build breaks, prod-vs-host Node behavior differences.
- **Does NOT catch:** prod **egress/NAT/proxy** network behavior — local container egress is your machine's network, not the prod egress hop. Network-path-triggered socket resets may not reproduce locally even in-container.

## Common mistakes

| Mistake | Fix |
|---|---|
| `docker:up` + `npm run watch` and calling it "running in Docker" | The app is on host Node. Run the app *in* a container built from the Dockerfile. |
| App in container still points at `localhost:<port>` | Rewrite to compose service hostnames + internal ports (table above). |
| Forgetting `--build` | The Dockerfile isn't rebuilt; you test a stale image, not your change. |
| Wrong/blank `-p <project>` | Use the same project name as `docker:up` so the app joins the running infra network instead of a parallel one. |
| `build.context` pointing at the wrong dir | Context must be the Dockerfile's build root (relative to the compose file's location), so `COPY . .` copies the repo, not `bin/`. |
| Running the host watch command in the container | Use the Dockerfile's production `CMD`; there's no watch in-container — **rebuild (`--build`) after each code change**. Iterate on the host with bare-node, validate in-container. |
| Baking `.env.local`/secrets into the image | Use `env_file:` + `secrets:`; keep the image clean. |
| Claiming success on "container is Up" | A container can be Up while the app crash-loops. Verify the app's real startup log from inside the container. |
