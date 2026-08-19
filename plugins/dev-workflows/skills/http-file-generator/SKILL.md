---
name: http-file-generator
disable-model-invocation: true
description: Generate .http test files for REST API endpoints. Use when the user asks to create HTTP test files, .http files, REST client files, or API test requests. Also generates Swagger/OpenAPI spec if the repo already has one.
---

# HTTP File Generator

## Delegate to a Sonnet subagent

**Do not run the generation inline.** Once the required inputs are gathered from the user, this is a mechanical pattern-following file-generation task that doesn't need this session's model tier or its accumulated context.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched http-file-generator subagent, skip this section and go straight to **Process** below.

Otherwise, gather the inputs from the user first (Step 1 — endpoints, unique fields, sample values, environments), then spawn a subagent for the rest:

```
Agent({
  description: "Generate .http file",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the http-file-generator subagent for <repo absolute path>. Invoke
    the http-file-generator skill yourself and follow it directly from Step 2 onward
    — you are the dispatched subagent, so do not delegate further. Endpoint(s):
    <method/path/status>. Unique fields: <fields>. Sample values: <values>.
    Environments: <envs>. Report back the file(s) created and whether a Swagger/OpenAPI
    update was offered/applied."
})
```

Relay the subagent's result to the user.

Generate `.http` files (VS Code REST Client / IntelliJ HTTP Client format) for testing API endpoints.

## Process

### 1. Gather Information

Before generating, ask the user:

1. **Which endpoint(s)?** — method, path, expected status code
2. **Which fields should be unique per request?** — e.g., `requestId`, `transactionId`, `correlationId`. These will use `{{$timestamp}}` or `{{$guid}}` variables.
3. **What are possible/example values for each field?** — enums, formats, ranges, real URLs. Ask for real sample data when available.
4. **Which environments?** — local, dev, staging, prod. Define `@baseUrl` variables for each (commented out for non-default).

### 2. Check Existing Patterns

Before creating the file, look for existing `.http` files in the repo:

```bash
find . -name "*.http" -maxdepth 3 | head -10
```

Match the existing style:
- Variable naming convention (`@baseUrl`, `@apiVersion`, etc.)
- Header patterns (auth headers, content-type, custom headers like `userid`, `service-host`)
- Comment style
- File location (e.g., `http/`, root, `test/`)

### 3. Generate the `.http` File

Stamp the deterministic boilerplate scaffold (fixed variable block + request stanza header) with the bundled script, redirecting into the target file:

```bash
./gen-http.sh --name "<Descriptive Name>" --method POST --path <path> [--port <port>] [--api-version v1] [--dev-url <dev-url>] > <location>/request.http
```

Then fill in the body and headers — **this is the judgment part the script leaves blank:**
- Use `{{$timestamp}}` for unique IDs (epoch ms), `{{$guid}}` for UUID-style fields, `{{$randomInt}}` for random numbers
- Keep request bodies realistic with real or realistic sample data
- Include all required fields; optional fields only when they add testing value
- Add auth / custom headers (`userid`, `service-host`, etc.) to match the repo's existing `.http` style
- One request per scenario — call the script again per scenario, or separate with `###` comments

### 4. Check for Swagger/OpenAPI

If the repo has an existing Swagger or OpenAPI spec:

```bash
find . -name "swagger*" -o -name "openapi*" -o -name "*.swagger.*" | head -5
```

If found, offer to update it with the new endpoint. If not found, ask:

> "This repo doesn't have a Swagger/OpenAPI spec. Would you like me to create one?"

Only create if the user says yes.

### 5. Commit

Commit the `.http` file (and Swagger if created) with a descriptive message.
