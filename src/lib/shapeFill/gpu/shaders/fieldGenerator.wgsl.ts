export const FIELD_GENERATOR_WGSL = /* wgsl */ `
struct FieldUniforms {
  tileOrigin : vec2<f32>,
  tileSize : vec2<f32>,
  boundsMin : vec2<f32>,
  boundsMax : vec2<f32>,
  resolution : f32,
  padding : f32,
  vertexCount : u32,
  flags : u32,
};

@group(0) @binding(0) var<storage, read> vertices : array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> uniforms : FieldUniforms;
@group(0) @binding(2) var distanceOut : texture_storage_2d<rgba32float, write>;

fn segment_closest_point(p : vec2<f32>, a : vec2<f32>, b : vec2<f32>) -> vec2<f32> {
  let ab = b - a;
  let ab_len_sq = max(dot(ab, ab), 1e-6);
  let t = clamp(dot(p - a, ab) / ab_len_sq, 0.0, 1.0);
  return a + ab * t;
}

fn compute_signed_distance(p : vec2<f32>) -> vec4<f32> {
  let vertex_count = uniforms.vertexCount;
  if (vertex_count < 3u) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  var min_dist = 1e9;
  var gradient = vec2<f32>(0.0, 0.0);

  for (var i : u32 = 0u; i < vertex_count; i = i + 1u) {
    let current = vertices[i];
    let next = vertices[(i + 1u) % vertex_count];
    let closest = segment_closest_point(p, current, next);
    let offset = p - closest;
    let dist = length(offset);
    if (dist < min_dist) {
      min_dist = dist;
      gradient = offset;
    }
  }

  var inside = false;
  for (var i : u32 = 0u; i < vertex_count; i = i + 1u) {
    let a = vertices[i];
    let b = vertices[(i + 1u) % vertex_count];
    let cond_a = (a.y <= p.y && b.y > p.y);
    let cond_b = (a.y > p.y && b.y <= p.y);
    if (cond_a || cond_b) {
      let denom = max(b.y - a.y, 1e-6);
      let proj = a.x + (p.y - a.y) * (b.x - a.x) / denom;
      if (p.x < proj) {
        inside = !inside;
      }
    }
  }

  var sign = -1.0;
  if (inside) {
    sign = 1.0;
  }

  let grad_len = length(gradient);
  if (grad_len > 1e-6) {
    gradient = normalize(gradient) * sign;
  } else {
    gradient = vec2<f32>(0.0, 0.0);
  }

  return vec4<f32>(min_dist * sign, gradient.x, gradient.y, sign);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let dims = textureDimensions(distanceOut);
  if (global_id.x >= dims.x || global_id.y >= dims.y) {
    return;
  }

  let texel = vec2<f32>(f32(global_id.x) + 0.5, f32(global_id.y) + 0.5);
  let world = uniforms.tileOrigin + texel * uniforms.resolution;
  let result = compute_signed_distance(world);
  textureStore(distanceOut, vec2<i32>(global_id.xy), result);
}
`;
