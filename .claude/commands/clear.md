# clear

Clears the console and automatically commits any pending changes.

## Implementation

```javascript
const { execSync } = require('child_process');
const path = require('path');

// Clear the console
console.clear();

// Auto-commit if there are changes
try {
  const scriptPath = path.join(process.cwd(), 'scripts', 'auto-commit.js');
  execSync(`node "${scriptPath}"`, { 
    stdio: 'inherit',
    cwd: process.cwd()
  });
} catch (error) {
  // If auto-commit fails, just clear console silently
  console.log('Console cleared');
}
```