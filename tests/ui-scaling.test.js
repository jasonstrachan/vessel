/**
 * UI Scaling Test Suite
 * Tests for coordinate system integrity and UI scaling behavior
 */

// Mock DOM environment
const mockDocument = {
  body: {
    style: {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1920,
      height: 1080
    })
  }
};

const mockWindow = {
  innerWidth: 1920,
  innerHeight: 1080,
  getComputedStyle: (element) => ({
    transform: 'none',
    zoom: '1'
  })
};

// Test coordinate transformation functions
function transformCoordinates(clientX, clientY, panX, panY, zoom, rectLeft = 0, rectTop = 0) {
  const rawX = clientX - rectLeft;
  const rawY = clientY - rectTop;
  const mouseX = (rawX - panX) / zoom;
  const mouseY = (rawY - panY) / zoom;
  
  return { mouseX, mouseY, rawX, rawY };
}

// Test cases
const testCases = [
  {
    name: 'Normal coordinates without scaling',
    input: { clientX: 100, clientY: 100, panX: 0, panY: 0, zoom: 1 },
    expected: { mouseX: 100, mouseY: 100, rawX: 100, rawY: 100 }
  },
  {
    name: 'Coordinates with 2x zoom',
    input: { clientX: 100, clientY: 100, panX: 0, panY: 0, zoom: 2 },
    expected: { mouseX: 50, mouseY: 50, rawX: 100, rawY: 100 }
  },
  {
    name: 'Coordinates with pan offset',
    input: { clientX: 100, clientY: 100, panX: 50, panY: 50, zoom: 1 },
    expected: { mouseX: 50, mouseY: 50, rawX: 100, rawY: 100 }
  },
  {
    name: 'Coordinates with zoom and pan',
    input: { clientX: 200, clientY: 200, panX: 100, panY: 100, zoom: 2 },
    expected: { mouseX: 50, mouseY: 50, rawX: 200, rawY: 200 }
  },
  {
    name: 'Coordinates with rect offset',
    input: { clientX: 200, clientY: 200, panX: 0, panY: 0, zoom: 1, rectLeft: 50, rectTop: 50 },
    expected: { mouseX: 150, mouseY: 150, rawX: 150, rawY: 150 }
  }
];

// Run tests
console.log('🧪 Running UI Scaling Tests...\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  const result = transformCoordinates(
    test.input.clientX,
    test.input.clientY,
    test.input.panX,
    test.input.panY,
    test.input.zoom,
    test.input.rectLeft,
    test.input.rectTop
  );
  
  const success = 
    result.mouseX === test.expected.mouseX &&
    result.mouseY === test.expected.mouseY &&
    result.rawX === test.expected.rawX &&
    result.rawY === test.expected.rawY;
  
  if (success) {
    console.log(`✅ Test ${index + 1}: ${test.name}`);
    passed++;
  } else {
    console.log(`❌ Test ${index + 1}: ${test.name}`);
    console.log(`   Expected:`, test.expected);
    console.log(`   Got:`, result);
    failed++;
  }
});

console.log(`\n📊 Test Results:`);
console.log(`   Passed: ${passed}`);
console.log(`   Failed: ${failed}`);
console.log(`   Total: ${passed + failed}`);

// UI Scaling Detection Tests
console.log('\n🔍 UI Scaling Detection Tests...\n');

function detectUIScaling(computedStyle) {
  const transform = computedStyle.transform;
  const zoom = computedStyle.zoom;
  
  let scaling = 1;
  
  if (zoom && zoom !== '1' && zoom !== 'normal') {
    scaling = parseFloat(zoom);
  }
  
  if (transform && transform !== 'none') {
    const scaleMatch = transform.match(/scale\(([^)]+)\)/);
    if (scaleMatch) {
      scaling = parseFloat(scaleMatch[1]);
    }
  }
  
  return scaling;
}

const scalingTests = [
  {
    name: 'No scaling',
    style: { transform: 'none', zoom: '1' },
    expected: 1
  },
  {
    name: 'CSS zoom 0.8',
    style: { transform: 'none', zoom: '0.8' },
    expected: 0.8
  },
  {
    name: 'Transform scale 0.8',
    style: { transform: 'scale(0.8)', zoom: '1' },
    expected: 0.8
  },
  {
    name: 'Transform scale 1.2',
    style: { transform: 'scale(1.2)', zoom: '1' },
    expected: 1.2
  }
];

scalingTests.forEach((test, index) => {
  const result = detectUIScaling(test.style);
  const success = Math.abs(result - test.expected) < 0.001;
  
  if (success) {
    console.log(`✅ Scaling Test ${index + 1}: ${test.name} - ${result}x`);
  } else {
    console.log(`❌ Scaling Test ${index + 1}: ${test.name} - Expected ${test.expected}, Got ${result}`);
  }
});

console.log('\n🏁 UI Scaling Tests Complete!');