from mcp.server.fastmcp import FastMCP

from .tools import register_tools


mcp = FastMCP("LLM Wiki MCP", instructions="Use workspace_id + agent_token to operate the knowledge vault.")
register_tools(mcp)
app = mcp.streamable_http_app()
