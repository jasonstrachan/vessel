# Vessel Warp Commands

## Quick Development Commands
dev: npm run dev
dev-clean: npm run dev:clean
build: npm run build
test: npm run test
lint: npm run lint
type-check: npm run type-check
clean: npm run clean
commit: npm run cc

## Project Scripts
start-app: ./start-vessel.sh
stop-app: ./stop-vessel.sh

## Common Git Operations
status: git status --porcelain
diff: git diff --no-pager
log: git log --oneline --no-pager -10
branches: git branch -a --no-pager

## File Operations  
show-src: Get-ChildItem src -Recurse -Name
show-tests: Get-ChildItem tests -Recurse -Name
show-config: Get-ChildItem -Name *.config.*,*.json,*.md
show-logs: Get-ChildItem -Name *.log

## Development Helpers
clear-cache: npm run cache:clear
deps-check: npm outdated
deps-audit: npm audit
deps-update: npm update

## Canvas/Drawing Specific
test-brushes: start TEST_PLUGIN_BRUSHES_SIMPLE.html
test-layers: start test-layer-rendering.html
test-grid: start test-grid-snap.html
