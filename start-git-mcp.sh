#!/bin/bash

# Start Git MCP Server for TinyBrush
# This script activates the virtual environment and starts the MCP server

echo "Starting Git MCP Server for TinyBrush..."

# Activate virtual environment
source /home/jason/projects/tinybrush/mcp-env/bin/activate

# Start the MCP server
python -m mcp_server_git --repository /home/jason/projects/tinybrush

echo "Git MCP Server started successfully!"