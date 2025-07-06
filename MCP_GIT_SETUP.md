# Git MCP Server Setup for TinyBrush

This document describes the Git MCP (Model Context Protocol) server setup for the TinyBrush project.

## What is Git MCP?

The Git MCP server enables AI assistants to interact with Git repositories through the Model Context Protocol. It provides tools for:

- `git_status`: Shows working tree status
- `git_diff_unstaged`: Displays unstaged changes
- `git_diff_staged`: Shows staged changes
- `git_commit`: Records repository changes
- `git_add`: Stages file contents
- `git_reset`: Unstages changes
- `git_log`: Displays commit history
- `git_create_branch`: Creates new branches
- `git_checkout`: Switches branches

## Installation

The Git MCP server is already installed in a virtual environment at `mcp-env/`.

## Configuration

### Claude Code Configuration
The MCP server is configured for Claude Code in `.claude/mcp_config.json`:

```json
{
  "mcpServers": {
    "git": {
      "command": "/home/jason/projects/tinybrush/mcp-env/bin/python",
      "args": ["-m", "mcp_server_git", "--repository", "/home/jason/projects/tinybrush"]
    }
  }
}
```

### Starting the Server

#### Manual Start
```bash
# Activate virtual environment
source mcp-env/bin/activate

# Start the MCP server
python -m mcp_server_git --repository /home/jason/projects/tinybrush
```

#### Using the Startup Script
```bash
./start-git-mcp.sh
```

## Usage

Once configured, the Git MCP server will be available to AI assistants that support the Model Context Protocol. The server provides Git functionality scoped to the TinyBrush repository.

## Files Created

- `mcp-env/`: Virtual environment with mcp-server-git installed
- `.claude/mcp_config.json`: Claude Code MCP configuration
- `start-git-mcp.sh`: Startup script for convenience
- `MCP_GIT_SETUP.md`: This documentation file

## Security Notes

The MCP server is configured to only access the TinyBrush repository (`/home/jason/projects/tinybrush`). It cannot access other repositories on the system.

## Troubleshooting

If the server doesn't start:
1. Ensure the virtual environment is activated
2. Check that the repository path is correct
3. Verify Git is installed and the repository is valid
4. Check file permissions on the startup script

For more information, see the [official MCP documentation](https://modelcontextprotocol.io/).