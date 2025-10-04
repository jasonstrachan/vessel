export const SEED_GENERATOR_WGSL = /* wgsl */ `
struct SeedUniforms {
  boundsMin : vec2<f32>,
  boundsSize : vec2<f32>,
  gridSize : vec2<u32>,
  seedCount : u32,
  _padding : u32,
};

struct SeedPoint {
  position : vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms : SeedUniforms;
@group(0) @binding(1) var<storage, read_write> seeds : array<SeedPoint>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let index = global_id.x;
  if (index >= uniforms.seedCount) {
    return;
  }

  let gridX = uniforms.gridSize.x;
  let gridY = uniforms.gridSize.y;
  if (gridX == 0u || gridY == 0u) {
    return;
  }

  let xIndex = index % gridX;
  let yIndex = index / gridX;

  let fx = (f32(xIndex) + 0.5) / f32(gridX);
  let fy = (f32(yIndex) + 0.5) / f32(gridY);

  let position = uniforms.boundsMin + vec2<f32>(fx, fy) * uniforms.boundsSize;
  seeds[index].position = vec4<f32>(position, 0.0, 1.0);
}
`;
