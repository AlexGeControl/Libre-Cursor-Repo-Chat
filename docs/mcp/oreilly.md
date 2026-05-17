# O'Reilly MCP Server

This markdown provides a technical roadmap of the O'Reilly MCP (Model Context Protocol) Server. The MCP server endpoint is: https://api.oreilly.com/api/content-discovery/v1/mcp/

## API Docs

You can see [here](https://learning.oreilly.com/apidocs/mcp/content/) for the detailed documentation on MCP API.

## Cursor MCP Settings

```json
{
  "mcpServers": {
    "oreilly": {
      "url": "https://api.oreilly.com/api/content-discovery/v1/mcp/",
      "headers": {
        "Authorization": "Bearer {YOUR_TOKEN}"
      }
    }
  }
}
```