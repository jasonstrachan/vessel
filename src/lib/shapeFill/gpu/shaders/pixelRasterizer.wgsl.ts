export const PIXEL_RASTERIZER_WGSL = /* wgsl */ `
struct RasterUniforms {
  color : vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms : RasterUniforms;

struct VSOut {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn vs_main(@location(0) position : vec2<f32>) -> VSOut {
  return VSOut(vec4<f32>(position, 0.0, 1.0));
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return uniforms.color;
}
`;
