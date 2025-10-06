export const QUAD_EXPAND_WGSL = /* wgsl */ `
struct Params {
  bounds : vec4<f32>,
  texSize : vec4<f32>,
  inCount : u32,
  coordSpace : u32,
  halfPx : f32,
  halfPxAlt : f32,
  stride : u32,
  metaPresent : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> inVerts : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> outVerts : array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> metadata : array<f32>;

fn to_world(p : vec2<f32>) -> vec2<f32> {
  if (params.coordSpace == 0u) {
    return p;
  }
  let minXY = params.bounds.xy;
  let size = params.bounds.zw;
  return minXY + p * size;
}

fn world_to_ndc(p : vec2<f32>) -> vec2<f32> {
  let minXY = params.bounds.xy;
  let size = params.bounds.zw;
  let uv = (p - minXY) / max(size, vec2<f32>(1e-6));
  let ndc = uv * 2.0 - vec2<f32>(1.0, 1.0);
  return vec2<f32>(ndc.x, -ndc.y);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let segIdx = gid.x;
  let segCount = params.inCount / 2u;
  if (segIdx >= segCount) {
    return;
  }

  let aWorld = to_world(inVerts[segIdx * 2u + 0u]);
  let bWorld = to_world(inVerts[segIdx * 2u + 1u]);

  var dir = bWorld - aWorld;
  let len = max(length(dir), 1e-6);
  dir = dir / len;
  let n = vec2<f32>(-dir.y, dir.x);

  var halfPx = params.halfPx;
  if (params.metaPresent == 1u && params.stride > 0u) {
    let metaLength = arrayLength(&metadata);
    if (segIdx < metaLength) {
      let levelValue = metadata[segIdx];
      if (levelValue >= 0.0) {
        let levelIndex = u32(levelValue + 0.5);
        if (params.stride > 0u && params.halfPxAlt > 0.0 && (levelIndex % params.stride) == 0u) {
          halfPx = params.halfPxAlt;
        }
      }
    }
  }

  let offPx = n * halfPx;
  let A = world_to_ndc(aWorld + offPx);
  let B = world_to_ndc(bWorld + offPx);
  let C = world_to_ndc(bWorld - offPx);
  let D = world_to_ndc(aWorld - offPx);

  let base = segIdx * 6u;
  outVerts[base + 0u] = A;
  outVerts[base + 1u] = B;
  outVerts[base + 2u] = C;
  outVerts[base + 3u] = A;
  outVerts[base + 4u] = C;
  outVerts[base + 5u] = D;
}
`;
