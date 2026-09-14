import type { StoredStop } from '@/utils/colorCycleGradientDefs';

type Sample = { rgba: [number, number, number, number] };

const gaussianKernel = (sigma: number): Float64Array => {
  const radius = Math.ceil(sigma * 3);
  const weights = new Float64Array(radius * 2 + 1);
  let weightSum = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    weightSum += weight;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= weightSum;
  return weights;
};

/** Light local softness, with a short wider blend only at the cyclic seam. */
export const smoothSampledGradient = (samples: Sample[]): StoredStop[] => {
  const count = samples.length;
  if (!count) return [];
  const localWeights = gaussianKernel(Math.max(0.5, Math.min(1.5, count / 32)));
  const seamWeights = gaussianKernel(Math.max(0.5, Math.min(3, count / 32)));
  const localRadius = (localWeights.length - 1) / 2;
  const seamRadius = (seamWeights.length - 1) / 2;
  const seamWidth = Math.min(8, count / 4);
  const filtered = new Float64Array(count * 4);
  for (let i = 0; i < count; i++) {
    const seamProximity = Math.max(0, 1 - Math.min(i, count - i) / seamWidth);
    const seamMix = seamProximity * seamProximity * (3 - 2 * seamProximity);
    const radius = seamMix > 0 ? seamRadius : localRadius;
    for (let offset = -radius; offset <= radius; offset++) {
      const rgba = samples[((i + offset) % count + count) % count].rgba;
      const weight = (localWeights[offset + localRadius] ?? 0) * (1 - seamMix)
        + seamWeights[offset + seamRadius] * seamMix;
      const alpha = rgba[3] / 255;
      // Premultiplication prevents transparent source pixels from adding dark fringes.
      for (let channel = 0; channel < 3; channel++) {
        filtered[i * 4 + channel] += rgba[channel] * alpha * weight;
      }
      filtered[i * 4 + 3] += alpha * weight;
    }
  }
  const stops: StoredStop[] = [];
  const outputCount = Math.max(3, count);
  for (let i = 0; i < outputCount; i++) {
    const position = i / (outputCount - 1);
    const samplePosition = position * count;
    const left = Math.floor(samplePosition) % count;
    const right = (left + 1) % count;
    const mix = samplePosition - Math.floor(samplePosition);
    const read = (channel: number) => filtered[left * 4 + channel] * (1 - mix)
      + filtered[right * 4 + channel] * mix;
    const opacity = Math.max(0, Math.min(1, read(3)));
    const rgb = [0, 1, 2].map(channel => opacity > 1e-6 ? Math.round(read(channel) / opacity) : 0);
    stops.push({ position, color: `rgb(${rgb.join(', ')})`, ...(opacity < 1 ? { opacity } : {}) });
  }
  return stops;
};
