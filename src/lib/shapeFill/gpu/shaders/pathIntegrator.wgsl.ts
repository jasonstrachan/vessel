export const PATH_INTEGRATOR_WGSL = /* wgsl */ `
struct PathUniforms {
  direction : vec2<f32>,
  halfLength : f32,
  thickness : f32,
  totalVertices : u32,
};

struct SeedPoint {
  position : vec4<f32>,
};

struct PathVertex {
  position : vec2<f32>,
};

@group(0) @binding(0) var<storage, read> seeds : array<SeedPoint>;
@group(0) @binding(1) var<storage, read_write> vertices : array<PathVertex>;
@group(0) @binding(2) var<uniform> uniforms : PathUniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let seedIndex = global_id.x;
  if (seedIndex * 2u >= uniforms.totalVertices) {
    return;
  }

  let seed = seeds[seedIndex].position.xy;
  var dir = normalize(uniforms.direction);
  if (all(dir == vec2<f32>(0.0, 0.0))) {
    dir = vec2<f32>(0.0, 1.0);
  }

  let offset = dir * uniforms.halfLength;
  let startPos = seed - offset;
  let endPos = seed + offset;

  let vertexIndex = seedIndex * 2u;
  vertices[vertexIndex].position = startPos;
  vertices[vertexIndex + 1u].position = endPos;
}
`;
