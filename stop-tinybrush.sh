#!/bin/bash

# TinyBrush Stop Script

echo "🛑 Stopping TinyBrush servers..."

# Kill all related processes
pkill -f "next dev" 2>/dev/null
pkill -f "proxy-server" 2>/dev/null  
pkill -f "node.*3000" 2>/dev/null
pkill -f "node.*8080" 2>/dev/null

# Clean up log files
rm -f next.log proxy.log 2>/dev/null

echo "✅ TinyBrush stopped"