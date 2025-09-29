// Test script for issue triage logic
// Run with: node .github/test-triage.js

const bugCategories = {
  canvas_rendering: {
    name: "Canvas Rendering Specialist",
    keywords: ["cursor", "alignment", "offset", "coordinate", "transform", "zoom", "pan", "drawing position"],
    bodyKeywords: ["getBoundingClientRect", "transform", "screenToCanvas", "clientX", "clientY"],
    files: ["DrawingCanvas.tsx", "BrushCursor.tsx"]
  },
  brush_engine: {
    name: "Brush Engine Specialist", 
    keywords: ["brush", "drawing", "stroke", "pressure", "pixel", "antialiasing", "cache", "line"],
    bodyKeywords: ["useBrushEngine", "drawCustomBrushStamp", "scaledBrushCache", "pressureEnabled"],
    files: ["useBrushEngine.ts", "scaledBrushCache.ts", "brushCache.ts"]
  },
  state_management: {
    name: "State Management Specialist",
    keywords: ["settings", "persist", "save", "load", "state", "sync", "reset"],
    bodyKeywords: ["useAppStore", "localStorage", "brushSettings", "persistence"],
    files: ["useAppStore.ts", "BrushLibrary.tsx"]
  },
  performance: {
    name: "Performance Specialist",
    keywords: ["performance", "memory", "slow", "lag", "cache", "optimization", "freeze"],
    bodyKeywords: ["memory leak", "cache miss", "slow rendering", "optimization"],
    files: ["memoryCleanup.ts", "performanceMonitor.ts"]
  }
};

function analyzeIssue(title, body) {
  const titleLower = title.toLowerCase();
  const bodyLower = body.toLowerCase();
  
  const scores = {};
  
  for (const [category, config] of Object.entries(bugCategories)) {
    let score = 0;
    
    // Title keyword matching (weight: 3)
    const titleMatches = config.keywords.filter(keyword => 
      titleLower.includes(keyword.toLowerCase())
    ).length;
    score += titleMatches * 3;
    
    // Body keyword matching (weight: 2)
    const bodyMatches = config.bodyKeywords.filter(keyword => 
      bodyLower.includes(keyword.toLowerCase())
    ).length;
    score += bodyMatches * 2;
    
    // File mention matching (weight: 1)
    const fileMatches = config.files.filter(file => 
      bodyLower.includes(file.toLowerCase())
    ).length;
    score += fileMatches * 1;
    
    // Normalize score (0-1 range)
    const maxPossibleScore = (config.keywords.length * 3) + (config.bodyKeywords.length * 2) + (config.files.length * 1);
    scores[category] = maxPossibleScore > 0 ? score / maxPossibleScore : 0;
  }
  
  return scores;
}

// Test cases based on Vessel issue patterns
const testCases = [
  {
    title: "Cursor offset when drawing after zoom",
    body: "When I zoom in and try to draw, the cursor appears in the wrong position. The drawing happens offset from where the cursor is. Looking at DrawingCanvas.tsx, it seems like the getBoundingClientRect calculation might be wrong.",
    expected: "canvas_rendering"
  },
  {
    title: "Brush strokes not rendering smoothly",
    body: "The brush strokes appear jagged and broken. Issue seems to be in useBrushEngine.ts where the drawCustomBrushStamp function is called. The scaledBrushCache might not be working correctly.",
    expected: "brush_engine"
  },
  {
    title: "Settings not persisting between sessions",
    body: "User settings keep getting reset when I reload the page. The useAppStore localStorage persistence isn't working. Custom brush settings from BrushLibrary.tsx are not being saved.",
    expected: "state_management"
  },
  {
    title: "Application running slowly with memory leaks",
    body: "The app gets slower over time and uses more memory. Looking at performanceMonitor.ts, there might be cache miss issues causing slow rendering. Need optimization.",
    expected: "performance"
  },
  {
    title: "Random UI bug",
    body: "Something is broken but I'm not sure what exactly. The interface looks weird sometimes.",
    expected: "low_confidence"
  }
];

console.log("🧪 Testing Vessel Issue Triage Logic\n");

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: ${testCase.title}`);
  console.log(`Expected: ${testCase.expected}`);
  
  const scores = analyzeIssue(testCase.title, testCase.body);
  const sortedCategories = Object.entries(scores)
    .sort(([,a], [,b]) => b - a);
  
  const primaryCategory = sortedCategories[0];
  const confidence = Math.round(primaryCategory[1] * 100);
  
  console.log(`Predicted: ${primaryCategory[0]} (${confidence}% confidence)`);
  
  if (testCase.expected === "low_confidence" && primaryCategory[1] < 0.1) {
    console.log("✅ PASS - Correctly identified as low confidence\n");
  } else if (primaryCategory[0] === testCase.expected && primaryCategory[1] > 0.1) {
    console.log("✅ PASS - Correct category prediction\n");
  } else {
    console.log("❌ FAIL - Incorrect prediction\n");
    console.log("All scores:", scores);
  }
  
  console.log("---");
});

console.log("\n🎯 Test completed. Check results above.");