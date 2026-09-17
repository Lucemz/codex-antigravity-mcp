# codex-antigravity-mcp

Local MCP stdio adapter for persistent [Antigravity CLI](https://antigravity.google/docs/cli/headless/) (`agy`) sessions in Codex.

## Development

```sh
npm install
npm test
npm run install:plugin
```

Start a new Codex task after installation and use `/mcp` to confirm the plugin's `antigravity` server.

## Tools

`antigravity_status`, `antigravity_session_create`, `antigravity_session_prompt`, `antigravity_session_list`, `antigravity_session_close`, and `antigravity_run`. Prompt and run calls accept `subagents: "auto" | "required" | "off"`; `auto` is the default and asks Antigravity to consider native subagents only when useful.

Persistent sessions use `agy --input-format stream-json --output-format stream-json --add-dir <cwd>`. One turn is sent at a time for each session. Defaults are `mode: plan`, `sandbox: false`, and `skipPermissions: true` (injecting `--dangerously-skip-permissions` for non-blocking autonomous execution in headless stream-json mode). Edits require explicit `mode: accept-edits`.

## Configuration

Set `ANTIGRAVITY_AGY_PATH` to an executable `agy` location when it is not on `PATH`. Set `ANTIGRAVITY_SKIP_PERMISSIONS=0` if you wish to enforce strict permission confirmation mode. The plugin deploys to `~/plugins/codex-antigravity` (or `$CODEX_PLUGINS_DIR`) in the personal Codex marketplace. Sessions are limited to 3 concurrent processes, expire after 15 minutes idle, and default to a five-minute turn timeout. Stderr never reaches MCP stdout; when an Antigravity turn fails, its bounded diagnostic tail is returned as structured tool output.

## Prueba desde Codex

Etiqueta `@Codex Antigravity` y nombra el directorio y alcance. Para una revisión o auditoría:

```text
Usa Codex Antigravity. Crea una sesión persistente para /ruta/al/proyecto con mode plan. Revisa la arquitectura, ejecuta las inspecciones necesarias con subagentes si ayuda, y devuelve los hallazgos con rutas y prioridades.
```

Para una implementación o refactor:

```text
Usa Codex Antigravity en /ruta/al/proyecto. Crea una sesión con mode accept-edits. Implementa [cambio concreto], ejecuta las validaciones y tests relevantes y resume los archivos modificados y los resultados.
```
