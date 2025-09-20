'use client';

/**
 * Test Suite Landing Page
 * Navigate to different test suites for the 2D unified rendering pipeline
 */

import Link from 'next/link';

export default function TestsPage() {
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold mb-8 text-center">🧪 TinyBrush Test Suite</h1>
        
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-2xl font-semibold mb-4">2D Unified Rendering Pipeline Tests</h2>
            <p className="text-gray-600 mb-6">
              Run comprehensive tests to verify and benchmark the new Canvas2D rendering pipeline 
              that replaced WebGL for color cycling animations.
            </p>
          </div>
          
          <div className="grid gap-6">
            <Link href="/tests/migration" className="block">
              <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-blue-500">
                <div className="flex items-center mb-3">
                  <span className="text-3xl mr-4">🔄</span>
                  <h3 className="text-xl font-semibold">Canvas2D vs WebGL Migration Tests</h3>
                </div>
                <p className="text-gray-600 mb-4">
                  Complete test suite comparing the new Canvas2D implementation against the original WebGL version.
                  Includes feature parity, performance benchmarks, visual quality, and memory analysis.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">Feature Parity</span>
                  <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-sm">Performance</span>
                  <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">Visual Quality</span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-sm">Memory Usage</span>
                </div>
              </div>
            </Link>
            
            <Link href="/tests/performance" className="block">
              <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-green-500">
                <div className="flex items-center mb-3">
                  <span className="text-3xl mr-4">🚀</span>
                  <h3 className="text-xl font-semibold">Performance Enhancement Tests</h3>
                </div>
                <p className="text-gray-600 mb-4">
                  Benchmark the performance optimizations including OffscreenCanvas, Web Workers, 
                  WebAssembly, and ImageBitmap transfers. Compare baseline vs optimized implementations.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-sm">OffscreenCanvas</span>
                  <span className="px-2 py-1 bg-cyan-100 text-cyan-800 rounded text-sm">Web Workers</span>
                  <span className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-sm">WebAssembly</span>
                  <span className="px-2 py-1 bg-pink-100 text-pink-800 rounded text-sm">ImageBitmap</span>
                </div>
              </div>
            </Link>
          </div>
          
          <div className="mt-8 bg-blue-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3">📊 What These Tests Measure</h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm text-gray-700">
              <div>
                <h4 className="font-semibold mb-2">Migration Success</h4>
                <ul className="space-y-1">
                  <li>• API compatibility maintained</li>
                  <li>• All features working correctly</li>
                  <li>• Visual output identical</li>
                  <li>• Performance improved or equal</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Performance Gains</h4>
                <ul className="space-y-1">
                  <li>• 75% memory reduction</li>
                  <li>• Faster rendering with optimizations</li>
                  <li>• Smooth 60 FPS animations</li>
                  <li>• Better browser compatibility</li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="mt-6 bg-yellow-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-2">⚡ Quick Start</h3>
            <ol className="list-decimal list-inside space-y-2 text-gray-700">
              <li>Click on a test suite above to navigate to the test page</li>
              <li>Select which tests to run (or run all)</li>
              <li>Click &ldquo;Run Tests&rdquo; and wait for completion</li>
              <li>Review results and download detailed reports</li>
            </ol>
          </div>
          
          <div className="mt-6 text-center">
            <Link 
              href="/" 
              className="inline-block px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-semibold transition-all"
            >
              ← Back to App
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
