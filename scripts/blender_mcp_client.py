"""Call the configured local Blender MCP from a shell (also useful before a client reload).

Run with: uvx --python 3.11 --from blender-mcp==1.9.1 python scripts/blender_mcp_client.py
The Blender GUI must be open with its MCP add-on enabled.
"""
import argparse
import asyncio
import base64
import json
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool", default="get_scene_info")
    parser.add_argument("--code-file", type=Path)
    parser.add_argument("--arguments", default="{}")
    parser.add_argument("--image-output", type=Path)
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    import shutil
    uvx = shutil.which("uvx") or str(Path.home() / ".local/bin/uvx")
    parameters = StdioServerParameters(
        command=uvx,
        args=["--python", "3.11", "blender-mcp==1.9.1"],
        env={"DISABLE_TELEMETRY": "true", "BLENDER_HOST": "127.0.0.1", "BLENDER_PORT": "9876"},
    )
    async with stdio_client(parameters) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            info = await session.initialize()
            if args.list:
                result = await session.list_tools()
                print(json.dumps({"server": info.serverInfo.model_dump(), "tools": [t.model_dump() for t in result.tools]}, indent=2))
                return
            arguments = json.loads(args.arguments)
            arguments.setdefault("user_prompt", "then setup the blender mcp")
            if args.code_file:
                arguments["code"] = args.code_file.read_text()
            result = await session.call_tool(args.tool, arguments)
            for content in result.content:
                if content.type == "text":
                    print(content.text)
                    if content.text.startswith(("Error executing code:", "Error:", "Error getting")):
                        raise SystemExit(1)
                elif content.type == "image" and args.image_output:
                    args.image_output.parent.mkdir(parents=True, exist_ok=True)
                    args.image_output.write_bytes(base64.b64decode(content.data))
                    print(json.dumps({"image": str(args.image_output), "mimeType": content.mimeType}))
            if result.isError:
                raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
