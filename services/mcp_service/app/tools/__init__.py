from mcp.server.fastmcp import FastMCP

from .delete import register_delete_tool
from .guide import register_guide_tool
from .lint import register_lint_tool
from .read import register_read_tool
from .search import register_search_tool
from .write import register_write_tools


def register_tools(mcp: FastMCP) -> None:
    register_guide_tool(mcp)
    register_search_tool(mcp)
    register_read_tool(mcp)
    register_write_tools(mcp)
    register_delete_tool(mcp)
    register_lint_tool(mcp)
