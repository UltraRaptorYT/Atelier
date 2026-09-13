# Blender MCP

Installed for this workspace on 2026-09-13 using the upstream
[Blender MCP package](https://github.com/ahujasid/blender-mcp), version 1.9.1.

- Blender: 5.2.1 LTS, `/Applications/Blender.app`.
- Add-on: `~/Library/Application Support/Blender/5.2/scripts/addons/blender_mcp.py`.
- Enabled in saved Blender preferences, with telemetry consent off.
- Local add-on socket: `127.0.0.1:9876`.
- Codex server name: `blender`, in `~/.codex/config.toml`.
- Server command: `~/.local/bin/uvx --python 3.11 blender-mcp==1.9.1`.
- Environment: `DISABLE_TELEMETRY=true`, `BLENDER_HOST=127.0.0.1`, `BLENDER_PORT=9876`.

Keep Blender open. Its **MCP for Blender** sidebar provides the connection
controls; the installed add-on starts the local listener automatically.
If a running Codex conversation does not show the newly configured native
tools, start a new conversation or reload the client. The configuration uses
the [official Codex MCP configuration mechanism](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

A local MCP client is also included. It performs a real MCP initialization and
tool call, so it can be used before a client reload:

```sh
uvx --python 3.11 --from blender-mcp==1.9.1 python scripts/blender_mcp_client.py
uvx --python 3.11 --from blender-mcp==1.9.1 python scripts/blender_mcp_client.py \
  --tool execute_blender_code --code-file /path/to/blender_script.py
```

Verified by reading the scene, creating and reading a temporary object, then
removing that object. Telemetry was read back as disabled. The Pikachu house
was subsequently compiled through `execute_blender_code` on this connection.

For the locally authored house, the source of truth is `project/design.json`.
The project-specific [Pikachu renderer](../scripts/render_pikachu_house.py)
reads its optional per-element `blender` geometry extension. Run
`python3 scripts/author_pikachu_house.py` to recreate the original V1/V2 design
inputs, or edit the canonical JSON directly for incremental changes.

This local MCP connection and its richer house-authoring metadata are separate
from the application's [concurrent specialist workflow](concurrent-agents.md).
That workflow publishes validated canonical revisions through the coordinator;
its E2B presentation-render task uses
[blender_compile.py](../scripts/blender_compile.py), which compiles the supported
box-and-stair contract. The browser does not load the local Blender scene or
interpret its extra geometry automatically. See [walkthrough requirements](walkthrough.md)
before expecting a Blender or Spline result to be explorable inside Atelier.
