export const PIXEL_RASTERIZER_WGSL = /* wgsl */ `
struct RasterUniforms {
  boundsMin : vec2<f32>,
  boundsSize : vec2<f32>,
  targetSize : vec2<f32>,
  color : vec4<f32>,
};

struct VSIn {
  @location(0) position : vec2<f32>,
  @location(1) thickness : f32,
  @location(2) weight : f32,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) thickness : f32,
};

@group(0) @binding(0) var<uniform> uniforms : RasterUniforms;

fn safe_divide(a : vec2<f32>, b : vec2<f32>) -> vec2<f32> {
  let epsilon = vec2<f32>(1e-6, 1e-6);
  return a / max(b, epsilon);
}

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var output : VSOut;
  var relative = safe_divide(input.position - uniforms.boundsMin, uniforms.boundsSize);
  var clip = vec2<f32>(relative.x * 2.0 - 1.0, 1.0 - relative.y * 2.0);
  output.position = vec4<f32>(clip, 0.0, 1.0);
  output.thickness = input.thickness;
  return output;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  return uniforms.color;
}
`;
