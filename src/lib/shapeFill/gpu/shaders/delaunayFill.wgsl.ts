export const DELAUNAY_FILL_WGSL = /* wgsl */ `
struct TriangleUniforms {
  data0 : vec4<f32>,
  data1 : vec4<f32>,
  data2 : vec4<f32>,
  data3 : vec4<f32>,
  data4 : vec4<f32>,
  data5 : vec4<f32>,
  data6 : vec4<f32>,
  data7 : vec4<f32>,
};

struct VertexCounter {
  count : atomic<u32>,
};

@group(0) @binding(0) var<uniform> uniforms : TriangleUniforms;
@group(0) @binding(1) var<storage, read> polygon : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> lineVertices : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> vertexCounter : VertexCounter;

const MAX_SEEDS : u32 = 512u;
const MAX_TRIANGLES : u32 = 1024u;
const MAX_EDGES : u32 = 1536u;

fn bounds_min() -> vec2<f32> {
  return uniforms.data0.xy;
}

fn bounds_max() -> vec2<f32> {
  return uniforms.data0.zw;
}

fn cell_size() -> f32 {
  return uniforms.data1.x;
}

fn min_spacing() -> f32 {
  return uniforms.data1.y;
}

fn jitter_strength() -> f32 {
  return uniforms.data1.z;
}

fn seed_value() -> f32 {
  return uniforms.data1.w;
}

fn max_seed_count() -> u32 {
  return u32(uniforms.data2.x);
}

fn max_triangle_count() -> u32 {
  return u32(uniforms.data2.y);
}

fn max_edge_count() -> u32 {
  return u32(uniforms.data2.z);
}

fn polygon_vertex_count() -> u32 {
  return u32(uniforms.data2.w);
}

fn line_width_value() -> f32 {
  return uniforms.data3.x;
}

fn rotation_sin() -> f32 {
  return uniforms.data3.y;
}

fn rotation_cos() -> f32 {
  return uniforms.data3.z;
}

fn normalize_direction(dir : vec2<f32>) -> vec2<f32> {
  let len = max(length(dir), 1e-6);
  return dir / len;
}

fn hash_random(seed : f32, index : u32) -> f32 {
  let n = seed * 1.3247179 + f32(index) * 0.8191725;
  return fract(sin(n) * 43758.5453);
}

fn rotate_point(p : vec2<f32>, origin : vec2<f32>) -> vec2<f32> {
  let s = rotation_sin();
  let c = rotation_cos();
  let translated = p - origin;
  return vec2<f32>(translated.x * c - translated.y * s, translated.x * s + translated.y * c);
}

fn inverse_rotate_point(p : vec2<f32>, origin : vec2<f32>) -> vec2<f32> {
  let s = rotation_sin();
  let c = rotation_cos();
  let x = p.x * c + p.y * s;
  let y = -p.x * s + p.y * c;
  return vec2<f32>(x, y) + origin;
}

fn point_in_polygon(point : vec2<f32>) -> bool {
  let count = polygon_vertex_count();
  var inside = false;
  var j = count - 1u;
  for (var i : u32 = 0u; i < count; i = i + 1u) {
    let pi = polygon[i];
    let pj = polygon[j];
    let cond = ((pi.y > point.y) != (pj.y > point.y)) &&
      (point.x < (pj.x - pi.x) * (point.y - pi.y) / max(pj.y - pi.y, 1e-6) + pi.x);
    if (cond) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

fn circumcircle_contains(a : vec2<f32>, b : vec2<f32>, c : vec2<f32>, p : vec2<f32>) -> bool {
  let ax = a.x - p.x;
  let ay = a.y - p.y;
  let bx = b.x - p.x;
  let by = b.y - p.y;
  let cx = c.x - p.x;
  let cy = c.y - p.y;

  let det = (ax * ax + ay * ay) * (bx * cy - cx * by)
          - (bx * bx + by * by) * (ax * cy - cx * ay)
          + (cx * cx + cy * cy) * (ax * by - bx * ay);
  return det > 0.0001;
}

fn append_edge(edges : ptr<function, array<vec2<u32>, MAX_EDGES>>, edgeCounts : ptr<function, array<u32, MAX_EDGES>>, edgeCountRef : ptr<function, u32>, a : u32, b : u32) {
  var idxA = a;
  var idxB = b;
  if (idxB < idxA) {
    let temp = idxA;
    idxA = idxB;
    idxB = temp;
  }

  var existing = false;
  for (var i : u32 = 0u; i < (*edgeCountRef); i = i + 1u) {
    if ((*edges)[i].x == idxA && (*edges)[i].y == idxB) {
      existing = true;
      (*edgeCounts)[i] = (*edgeCounts)[i] + 1u;
      break;
    }
  }

  if (!existing && (*edgeCountRef) < MAX_EDGES) {
    (*edges)[*edgeCountRef] = vec2<u32>(idxA, idxB);
    (*edgeCounts)[*edgeCountRef] = 1u;
    (*edgeCountRef) = (*edgeCountRef) + 1u;
  }
}

fn emit_line(a : vec2<f32>, b : vec2<f32>) {
  let index = atomicAdd(&vertexCounter.count, 2u);
  let capacity = u32(max_edge_count()) * 2u;
  if (index + 1u >= capacity) {
    return;
  }
  lineVertices[index] = vec4<f32>(a, line_width_value(), 1.0);
  lineVertices[index + 1u] = vec4<f32>(b, line_width_value(), 1.0);
}

@compute @workgroup_size(1)
fn main() {
  let minBounds = bounds_min();
  let maxBounds = bounds_max();
  let origin = (minBounds + maxBounds) * 0.5;

  let maxSeeds = min(max_seed_count(), MAX_SEEDS);
  let maxTriangles = min(max_triangle_count(), MAX_TRIANGLES);
  let maxEdges = min(max_edge_count(), MAX_EDGES);

  var seeds : array<vec2<f32>, MAX_SEEDS>;
  var seedCount : u32 = 0u;

  let delta = max(maxBounds.x - minBounds.x, maxBounds.y - minBounds.y) * 4.0;
  seeds[0u] = vec2<f32>(minBounds.x - delta, minBounds.y - delta);
  seeds[1u] = vec2<f32>((minBounds.x + maxBounds.x) * 0.5, maxBounds.y + delta);
  seeds[2u] = vec2<f32>(maxBounds.x + delta, minBounds.y - delta);
  seedCount = 3u;

  let minSpacingSq = min_spacing() * min_spacing();
  var iterations : u32 = 0u;
  let maxIterations = maxSeeds * 40u;

  loop {
    if (seedCount >= maxSeeds || iterations >= maxIterations) {
      break;
    }
    iterations = iterations + 1u;

    let r1 = hash_random(seed_value(), iterations);
    let r2 = hash_random(seed_value() + 13.37, iterations * 7u + 3u);
    var candidate = vec2<f32>(mix(minBounds.x, maxBounds.x, r1), mix(minBounds.y, maxBounds.y, r2));

    if (jitter_strength() > 0.0) {
      let jitter = (hash_random(seed_value() + 91.7, iterations) - 0.5) * cell_size() * jitter_strength();
      candidate = candidate + vec2<f32>(jitter, jitter * 0.3);
    }

    let rotated = rotate_point(candidate, origin);
    if (!point_in_polygon(rotated)) {
      continue;
    }

    var farEnough = true;
    for (var i : u32 = 3u; i < seedCount; i = i + 1u) {
      let d = seeds[i] - candidate;
      if (dot(d, d) < minSpacingSq) {
        farEnough = false;
        break;
      }
    }

    if (!farEnough) {
      continue;
    }

    seeds[seedCount] = candidate;
    seedCount = seedCount + 1u;
  }

  var triangles : array<vec3<u32>, MAX_TRIANGLES>;
  var triangleCount : u32 = 1u;
  triangles[0u] = vec3<u32>(0u, 1u, 2u);

  for (var pIndex : u32 = 3u; pIndex < seedCount; pIndex = pIndex + 1u) {
    let point = seeds[pIndex];

    var bad : array<bool, MAX_TRIANGLES>;
    var edgePool : array<vec2<u32>, MAX_EDGES>;
    var edgeUsage : array<u32, MAX_EDGES>;
    var edgeCount : u32 = 0u;

    for (var t : u32 = 0u; t < triangleCount; t = t + 1u) {
      let tri = triangles[t];
      let a = seeds[tri.x];
      let b = seeds[tri.y];
      let c = seeds[tri.z];
      if (circumcircle_contains(a, b, c, point)) {
        bad[t] = true;
        append_edge(&edgePool, &edgeUsage, &edgeCount, tri.x, tri.y);
        append_edge(&edgePool, &edgeUsage, &edgeCount, tri.y, tri.z);
        append_edge(&edgePool, &edgeUsage, &edgeCount, tri.z, tri.x);
      } else {
        bad[t] = false;
      }
    }

    var newCount : u32 = 0u;
    var newTriangles : array<vec3<u32>, MAX_TRIANGLES>;

    for (var t : u32 = 0u; t < triangleCount; t = t + 1u) {
      if (!bad[t]) {
        newTriangles[newCount] = triangles[t];
        newCount = newCount + 1u;
      }
    }

    triangleCount = newCount;
    for (var e : u32 = 0u; e < edgeCount; e = e + 1u) {
      if (edgeUsage[e] == 1u && triangleCount < maxTriangles) {
        newTriangles[triangleCount] = vec3<u32>(edgePool[e].x, edgePool[e].y, pIndex);
        triangleCount = triangleCount + 1u;
      }
    }

    for (var t : u32 = 0u; t < triangleCount; t = t + 1u) {
      triangles[t] = newTriangles[t];
    }
  }

  atomicStore(&vertexCounter.count, 0u);

  for (var t : u32 = 0u; t < triangleCount; t = t + 1u) {
    let tri = triangles[t];
    if (tri.x < 3u || tri.y < 3u || tri.z < 3u) {
      continue;
    }

    let a = seeds[tri.x];
    let b = seeds[tri.y];
    let c = seeds[tri.z];

    emit_line(a, b);
    emit_line(b, c);
    emit_line(c, a);
  }
}
`;
