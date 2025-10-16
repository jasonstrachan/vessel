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

describe('UI Coordinate Transformation', () => {
  testCases.forEach((test, index) => {
    it(test.name, () => {
      const result = transformCoordinates(
        test.input.clientX,
        test.input.clientY,
        test.input.panX,
        test.input.panY,
        test.input.zoom,
        test.input.rectLeft,
        test.input.rectTop
      );
      
      expect(result.mouseX).toBe(test.expected.mouseX);
      expect(result.mouseY).toBe(test.expected.mouseY);
      expect(result.rawX).toBe(test.expected.rawX);
      expect(result.rawY).toBe(test.expected.rawY);
    });
  });
});

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

describe('UI Scaling Detection', () => {
  scalingTests.forEach((test, index) => {
    it(test.name, () => {
      const result = detectUIScaling(test.style);
      expect(result).toBeCloseTo(test.expected, 3);
    });
  });
});