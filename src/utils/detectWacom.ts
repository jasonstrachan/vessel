/**
 * Detect if Wacom drivers are properly configured for the browser
 */

export function detectWacomIssues(): {
  hasIssue: boolean;
  message: string;
  solutions: string[];
} {
  // Check if we can detect pointer events API support
  const supportsPointerEvents = 'PointerEvent' in window;
  const supportsPointerEventsPressure = 
    supportsPointerEvents && 
    'pressure' in PointerEvent.prototype;
  
  if (!supportsPointerEvents) {
    return {
      hasIssue: true,
      message: 'Browser does not support Pointer Events API',
      solutions: [
        'Update your browser to the latest version',
        'Try Chrome, Firefox, or Edge'
      ]
    };
  }
  
  if (!supportsPointerEventsPressure) {
    return {
      hasIssue: true,
      message: 'Browser Pointer Events API does not support pressure',
      solutions: [
        'Update your browser to the latest version'
      ]
    };
  }
  
  // Check browser and OS
  const userAgent = navigator.userAgent.toLowerCase();
  const isWindows = userAgent.includes('windows');
  const isMac = userAgent.includes('mac');
  const isLinux = userAgent.includes('linux');
  const isChrome = userAgent.includes('chrome');
  const isFirefox = userAgent.includes('firefox');
  const isSafari = userAgent.includes('safari') && !isChrome;
  const solutions: string[] = [];
  
  if (isWindows) {
    solutions.push(
      'Windows: Install latest Wacom drivers from wacom.com',
      'Windows: Enable Windows Ink in Wacom Tablet Properties',
      'Windows: In Wacom settings, ensure "Use Windows Ink" is checked',
      'Windows: Try disabling "Windows Ink" if pressure still doesn\'t work',
      'Windows: Check Chrome flags - chrome://flags/#enable-pointer-event-v1'
    );
  }
  
  if (isMac) {
    solutions.push(
      'macOS: Install latest Wacom drivers from wacom.com',
      'macOS: Grant browser permission in System Preferences > Security & Privacy > Accessibility',
      'macOS: In Wacom Desktop Center, check tablet is recognized'
    );
  }
  
  if (isLinux) {
    solutions.push(
      'Linux: Install xf86-input-wacom package',
      'Linux: Check xinput list for Wacom device',
      'Linux: For Firefox, set dom.w3c_pointer_events.enabled to true in about:config'
    );
  }
  
  if (isSafari) {
    solutions.push(
      '⚠️ Safari has limited pressure support - try Chrome or Firefox instead'
    );
  }
  
  if (isFirefox) {
    solutions.push(
      'Firefox: Check about:config - dom.w3c_pointer_events.enabled should be true'
    );
  }
  
  return {
    hasIssue: false,
    message: 'No obvious issues detected',
    solutions
  };
}

export function testWacomPressure(event: React.PointerEvent | PointerEvent): {
  isWorking: boolean;
  details: string;
} {
  const pointerType = event.pointerType;
  const pressure = event.pressure;
  
  if (pointerType === 'pen') {
    if (pressure > 0 && pressure < 1) {
      return {
        isWorking: true,
        details: `✅ Wacom working! Pressure: ${pressure.toFixed(3)}`
      };
    } else if (pressure === 0) {
      return {
        isWorking: false,
        details: '❌ Pen detected but pressure is 0 - hover or driver issue'
      };
    } else if (pressure === 1) {
      return {
        isWorking: false,
        details: '❌ Pen detected but pressure is max - driver issue'
      };
    }
  } else if (pointerType === 'mouse') {
    // Mouse events typically have pressure 0.5 when no pressure is supported
    // But Wacom pens incorrectly detected as mice might have varying pressure
    if (pressure === 0.5 || pressure === 0 || pressure === 1) {
      return {
        isWorking: false,
        details: `❌ Wacom pen detected as mouse (pressure: ${pressure}) - driver/browser issue`
      };
    }
    // If mouse has variable pressure between 0 and 1, it might be a misdetected pen
    return {
      isWorking: false,
      details: `⚠️ Unusual mouse pressure: ${pressure} - possible misdetected pen`
    };
  } else if (pointerType === 'touch') {
    return {
      isWorking: false,
      details: '❌ Detected as touch instead of pen - driver issue'
    };
  }
  
  return {
    isWorking: false,
    details: `Unknown pointer type: ${pointerType}, pressure: ${pressure}`
  };
}
