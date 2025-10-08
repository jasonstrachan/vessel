export const ISOLINE_EXTRACTOR_WGSL = /* wgsl */ `
struct IsolineUniforms {
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

@group(0) @binding(0) var<uniform> uniforms : IsolineUniforms;
@group(0) @binding(1) var distanceField : texture_storage_2d<rgba32float, read>;
@group(0) @binding(2) var<storage, read_write> vertices : array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> vertexCounter : VertexCounter;
@group(0) @binding(4) var<storage, read_write> segmentMeta : array<f32>;

fn tile_origin() -> vec2<f32> {
  return uniforms.data0.xy;
}

fn resolution() -> f32 {
  return uniforms.data0.z;
}

fn mode_value() -> f32 {
  return uniforms.data0.w;
}

fn spacing_a() -> f32 {
  return uniforms.data1.x;
}

fn spacing_b() -> f32 {
  return uniforms.data1.y;
}

fn variance_value() -> f32 {
  return uniforms.data1.z;
}

fn smoothness_value() -> f32 {
  return uniforms.data1.w;
}

fn max_distance() -> f32 {
  return uniforms.data2.x;
}

fn line_width_value() -> f32 {
  return uniforms.data2.y;
}

fn max_levels_value() -> f32 {
  return uniforms.data2.z;
}

fn seed_value() -> f32 {
  return uniforms.data2.w;
}

fn vertex_capacity() -> f32 {
  return uniforms.data3.x;
}

fn preview_flag() -> f32 {
  return uniforms.data3.y;
}

fn bounds_min() -> vec2<f32> {
  return vec2<f32>(uniforms.data3.z, uniforms.data3.w);
}

fn bounds_max() -> vec2<f32> {
  return vec2<f32>(uniforms.data4.x, uniforms.data4.y);
}

fn bounds_size() -> vec2<f32> {
  let size = bounds_max() - bounds_min();
  return max(size, vec2<f32>(1e-4, 1e-4));
}

fn normalize_position(position : vec2<f32>) -> vec2<f32> {
  return clamp((position - bounds_min()) / bounds_size(), vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));
}

fn base_origin() -> vec2<f32> {
  return vec2<f32>(uniforms.data4.z, uniforms.data4.w);
}

fn direction_vec() -> vec2<f32> {
  let dir = vec2<f32>(uniforms.data5.x, uniforms.data5.y);
  let len = max(length(dir), 1e-5);
  return dir / len;
}

fn normal_vec() -> vec2<f32> {
  let normal = vec2<f32>(uniforms.data5.z, uniforms.data5.w);
  let len = max(length(normal), 1e-5);
  return normal / len;
}

fn sample_offset(index : u32) -> vec2<u32> {
  if (index == 0u) {
    return vec2<u32>(0u, 0u);
  }
  if (index == 1u) {
    return vec2<u32>(1u, 0u);
  }
  if (index == 2u) {
    return vec2<u32>(1u, 1u);
  }
  return vec2<u32>(0u, 1u);
}

fn direction_extent() -> f32 {
  return max(uniforms.data6.x, 1e-3);
}

fn back_distance() -> f32 {
  return max(uniforms.data6.y, 0.0);
}

fn metadata_capacity() -> u32 {
  return max(u32(uniforms.data6.z), 0u);
}

fn alternate_stride() -> f32 {
  return max(uniforms.data6.w, 0.0);
}

fn clip_min() -> vec2<f32> {
  return vec2<f32>(uniforms.data7.x, uniforms.data7.y);
}

fn clip_max() -> vec2<f32> {
  return vec2<f32>(uniforms.data7.z, uniforms.data7.w);
}

fn hash(seed : f32, index : u32) -> f32 {
  let n = seed * 0.3183099 + f32(index) * 0.3678794;
  return fract(sin(n) * 43758.5453);
}

fn compute_level(index : u32) -> f32 {
  if (mode_value() < 0.5) {
    if (spacing_a() <= 1e-4) {
      return 0.0;
    }
    let base = spacing_a() * f32(index + 1u);
    if (variance_value() <= 1e-4) {
      return base;
    }
    let jitter = hash(seed_value(), index) * 2.0 - 1.0;
    let scaled = base * (1.0 + jitter * variance_value());
    return max(0.0, scaled);
  }

  let base = f32(index + 1u);
  if (variance_value() <= 1e-4) {
    return base;
  }
  let jitter = hash(seed_value(), index) * 2.0 - 1.0;
  let scaled = base * (1.0 + jitter * variance_value());
  return max(0.0, scaled);
}

fn smooth_mix(t : f32) -> f32 {
  let cubic = t * t * (3.0 - 2.0 * t);
  return mix(t, cubic, clamp(smoothness_value(), 0.0, 1.0));
}

fn intersection(p0 : vec2<f32>, p1 : vec2<f32>, v0 : f32, v1 : f32, level : f32) -> vec2<f32> {
  let denom = max(abs(v1 - v0), 1e-6);
  var t = clamp((level - v0) / denom, 0.0, 1.0);
  t = smooth_mix(t);
  return mix(p0, p1, t);
}

fn append_segment(a : vec2<f32>, b : vec2<f32>, level_index : u32) {
  let index = atomicAdd(&vertexCounter.count, 2u);
  if (f32(index + 1u) >= vertex_capacity()) {
    return;
  }
  let clippedA = clamp(a, clip_min(), clip_max());
  let clippedB = clamp(b, clip_min(), clip_max());
  vertices[index] = normalize_position(clippedA);
  vertices[index + 1u] = normalize_position(clippedB);

  if (mode_value() >= 0.5) {
    let segIdx = index / 2u;
    let cap = metadata_capacity();
    let metaLength = arrayLength(&segmentMeta);
    if (segIdx < cap && segIdx < metaLength) {
      segmentMeta[segIdx] = f32(level_index);
    }
  }
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  if (mode_value() < 0.5 && spacing_a() <= 1e-4) {
    return;
  }

  let dims = textureDimensions(distanceField);
  if (dims.x < 2u || dims.y < 2u) {
    return;
  }

  if (global_id.x >= dims.x - 1u || global_id.y >= dims.y - 1u) {
    return;
  }

  let coord = vec2<u32>(global_id.xy);
  let basePos = tile_origin() + (vec2<f32>(f32(coord.x), f32(coord.y)) + vec2<f32>(0.5, 0.5)) * resolution();
  let clipMin = clip_min();
  let clipMax = clip_max();
  if (basePos.x < clipMin.x - 1e-3 || basePos.x > clipMax.x + 1e-3 ||
      basePos.y < clipMin.y - 1e-3 || basePos.y > clipMax.y + 1e-3) {
    return;
  }
  let dx = vec2<f32>(resolution(), 0.0);
  let dy = vec2<f32>(0.0, resolution());

  var cornerValues : array<f32, 4>;
  var cornerSigns : array<f32, 4>;
  var validCount : u32 = 0u;

  for (var i : u32 = 0u; i < 4u; i = i + 1u) {
    let offset = sample_offset(i);
    let sample = textureLoad(distanceField, vec2<i32>(coord + offset));
    cornerSigns[i] = sample.w;

    let cornerPos = tile_origin() + (vec2<f32>(f32(coord.x + offset.x), f32(coord.y + offset.y)) + vec2<f32>(0.5, 0.5)) * resolution();

    if (mode_value() < 0.5) {
      cornerValues[i] = sample.x;
      if (sample.x > 0.0) {
        validCount = validCount + 1u;
      }
    } else {
      if (sample.w <= 0.0) {
        cornerValues[i] = -1.0;
        continue;
      }

      let rel = cornerPos - base_origin();
      let along = dot(rel, direction_vec());
      let extent = direction_extent();
      let t = clamp(along / extent, 0.0, 1.0);
      let localSpacing = mix(spacing_a(), spacing_b(), t);
      let perp = dot(rel, normal_vec());

      if (perp < -back_distance() || perp > max_distance()) {
        cornerValues[i] = -1.0;
        continue;
      }

      cornerValues[i] = perp / max(localSpacing, 1e-3);
      validCount = validCount + 1u;
    }
  }

  if (validCount == 0u) {
    return;
  }

  let maxLevels = clamp(u32(max_levels_value()), 1u, 256u);
  var levelIndex : u32 = 0u;

  loop {
    if (levelIndex >= maxLevels) {
      break;
    }

    if (preview_flag() > 0.5 && (levelIndex & 1u) == 1u) {
      levelIndex = levelIndex + 1u;
      continue;
    }

    let level = compute_level(levelIndex);
    if (level <= 0.0) {
      levelIndex = levelIndex + 1u;
      continue;
    }

    if (mode_value() < 0.5) {
      if (level > max_distance()) {
        break;
      }
      let maxVal = max(max(cornerValues[0], cornerValues[1]), max(cornerValues[2], cornerValues[3]));
      let minVal = min(min(cornerValues[0], cornerValues[1]), min(cornerValues[2], cornerValues[3]));
      if (level < minVal || level > maxVal) {
        levelIndex = levelIndex + 1u;
        continue;
      }
    }

    var intersections : array<vec2<f32>, 4>;
    var count : u32 = 0u;

    if ((cornerValues[0] - level) * (cornerValues[1] - level) < 0.0) {
      intersections[count] = intersection(basePos, basePos + dx, cornerValues[0], cornerValues[1], level);
      count = count + 1u;
    }
    if ((cornerValues[1] - level) * (cornerValues[2] - level) < 0.0) {
      intersections[count] = intersection(basePos + dx, basePos + dx + dy, cornerValues[1], cornerValues[2], level);
      count = count + 1u;
    }
    if ((cornerValues[2] - level) * (cornerValues[3] - level) < 0.0) {
      intersections[count] = intersection(basePos + dx + dy, basePos + dy, cornerValues[2], cornerValues[3], level);
      count = count + 1u;
    }
    if ((cornerValues[3] - level) * (cornerValues[0] - level) < 0.0) {
      intersections[count] = intersection(basePos + dy, basePos, cornerValues[3], cornerValues[0], level);
      count = count + 1u;
    }

    if (count == 2u) {
      append_segment(intersections[0u], intersections[1u], levelIndex);
    } else if (count == 4u) {
      let config = (select(0u, 1u, cornerValues[0] > level) << 3u) |
                   (select(0u, 1u, cornerValues[1] > level) << 2u) |
                   (select(0u, 1u, cornerValues[2] > level) << 1u) |
                   (select(0u, 1u, cornerValues[3] > level));

      // 6u (0b0110) and 9u (0b1001) represent the diagonal ambiguity cases.
      if (config == 6u || config == 9u) {
        append_segment(intersections[0u], intersections[2u], levelIndex);
        append_segment(intersections[1u], intersections[3u], levelIndex);
      } else {
        append_segment(intersections[0u], intersections[1u], levelIndex);
        append_segment(intersections[2u], intersections[3u], levelIndex);
      }
    }

    levelIndex = levelIndex + 1u;
  }
}
`;
