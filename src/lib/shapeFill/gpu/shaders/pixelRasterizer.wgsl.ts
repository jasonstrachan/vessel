export const PIXEL_RASTERIZER_WGSL = /* wgsl */ `
struct RasterUniforms {
  boundsMin : vec2<f32>,
  boundsSize : vec2<f32>,
  targetSize : vec2<f32>,
  color : vec4<f32>,
  flags : vec2<f32>,
  padding : vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms : RasterUniforms;

struct VSOut {
  @builtin(position) position : vec4<f32>,
};

fn clamp01(value : vec2<f32>) -> vec2<f32> {
  return clamp(value, vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));
}

fn compute_uv(position : vec2<f32>) -> vec2<f32> {
  if (uniforms.flags.x > 0.5) {
    return clamp01(position);
  }

  let size = max(uniforms.boundsSize, vec2<f32>(1e-6, 1e-6));
  let normalized = (position - uniforms.boundsMin) / size;
  return clamp01(normalized);
}

@vertex
fn vs_main(@location(0) pos : vec2<f32>) -> VSOut {
  let uv = compute_uv(pos);
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, -(uv.y * 2.0 - 1.0));
  return VSOut(vec4<f32>(ndc, 0.0, 1.0));
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return uniforms.color;
}
`;
