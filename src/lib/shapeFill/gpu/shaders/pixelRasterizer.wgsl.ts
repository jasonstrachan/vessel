export const PIXEL_RASTERIZER_WGSL = /* wgsl */ `
struct RasterUniforms {
  color : vec4<f32>,
  params : vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms : RasterUniforms;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@location(0) position : vec2<f32>, @location(1) uv : vec2<f32>) -> VSOut {
  return VSOut(vec4<f32>(position, 0.0, 1.0), uv);
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let baseColor = uniforms.color;
  var coverage = 1.0;

  if (uniforms.params.x > 0.5) {
    let dist = abs(input.uv.y);
    let coverageRaw = clamp(1.0 - dist, 0.0, 1.0);
    let grad = max(fwidth(input.uv.y), 1e-3);
    let strength = clamp(uniforms.params.y, 0.0, 1.0);
    let threshold = clamp(uniforms.params.w, 0.0, 1.0);
    let feather = max(uniforms.params.z * grad, 1e-3);
    let aa = smoothstep(0.0, feather, coverageRaw);

    let logisticFeather = max(feather, 1e-3);
    let slopeScale = mix(0.75, 2.5, strength);
    let slope = min(48.0, 2.1972246 * slopeScale / logisticFeather);
    let shifted = coverageRaw - threshold;
    let sigmoid = 1.0 / (1.0 + exp(-slope * shifted));
    let hardStep = step(threshold, coverageRaw);
    let hardenedCurve = mix(sigmoid, hardStep, strength);

    coverage = mix(aa, hardenedCurve, strength);
  }

  let alpha = clamp(baseColor.w * coverage, 0.0, 1.0);
  return vec4<f32>(baseColor.xyz, alpha);
}
`;
