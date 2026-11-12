function centerOf(bounds) {
  return [
    (bounds[0] + bounds[3]) / 2,
    (bounds[1] + bounds[4]) / 2,
    (bounds[2] + bounds[5]) / 2
  ];
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return vector.map((value) => value / length);
}

function boundsRadius(bounds) {
  return Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) / 2;
}

function defaultOffset(targetBounds, rootBounds) {
  const center = centerOf(targetBounds);
  const modelCenter = centerOf(rootBounds);
  let outward = [center[0] - modelCenter[0], center[1] - modelCenter[1], 0];
  const modelRadius = Math.max(boundsRadius(rootBounds), 1);
  const extentX = Math.abs(targetBounds[3] - targetBounds[0]);
  const extentY = Math.abs(targetBounds[4] - targetBounds[1]);
  let side = extentX >= extentY ? [0, 1, 0] : [1, 0, 0];
  if (Math.hypot(outward[0], outward[1]) < modelRadius * 0.05) {
    outward = [1, -1, 0];
  } else {
    outward = normalize(outward);
    if (side[0] * outward[0] + side[1] * outward[1] < 0) side = side.map((value) => -value);
    outward = [outward[0] * 0.82 + side[0] * 0.36, outward[1] * 0.82 + side[1] * 0.36, 0];
  }
  outward = normalize(outward);
  return normalize([outward[0], outward[1], 0.85]);
}

function segmentEntry(origin, target, bounds) {
  const center = centerOf(bounds);
  const shrink = 0.76;
  const minimum = [
    center[0] + (bounds[0] - center[0]) * shrink,
    center[1] + (bounds[1] - center[1]) * shrink,
    center[2] + (bounds[2] - center[2]) * shrink
  ];
  const maximum = [
    center[0] + (bounds[3] - center[0]) * shrink,
    center[1] + (bounds[4] - center[1]) * shrink,
    center[2] + (bounds[5] - center[2]) * shrink
  ];
  let entry = 0;
  let exit = 0.965;
  for (let axis = 0; axis < 3; axis += 1) {
    const direction = target[axis] - origin[axis];
    if (Math.abs(direction) < 1e-9) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null;
      continue;
    }
    let near = (minimum[axis] - origin[axis]) / direction;
    let far = (maximum[axis] - origin[axis]) / direction;
    if (near > far) [near, far] = [far, near];
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return null;
  }
  return entry > 0.015 && entry < 0.965 ? entry : null;
}

export function focusCandidateOffsets(targetBounds, rootBounds) {
  const candidates = [defaultOffset(targetBounds, rootBounds)];
  for (const elevation of [0.5, 0.85, 1.3, 2]) {
    for (let index = 0; index < 12; index += 1) {
      const angle = index * Math.PI * 2 / 12;
      candidates.push(normalize([Math.cos(angle), Math.sin(angle), elevation]));
    }
  }
  return candidates;
}

const focusViewOverrides = new Map([
  ["hash_877270768_2902", normalize([0, 1, 0.7])],
  ["hash_877271496_2871", normalize([1, 1, 0.7])]
]);

export function chooseFocusView(targetNode, componentNodes, rootBounds) {
  if (!targetNode?.bounds || !rootBounds) {
    return { offset: normalize([1, -1, 0.85]), occluders: 0, defaultOccluders: 0, adjusted: false };
  }
  const override = focusViewOverrides.get(targetNode.id);
  if (override) {
    return { offset: override, occluders: 0, defaultOccluders: 0, adjusted: true, candidateIndex: -1, manual: true };
  }
  const center = centerOf(targetNode.bounds);
  const targetIds = new Set(targetNode.componentIds || []);
  const targetRadius = Math.max(boundsRadius(targetNode.bounds), 0.05);
  const modelRadius = Math.max(boundsRadius(rootBounds), 1);
  const range = Math.max(targetRadius * 4, modelRadius * 0.055, 0.55);
  const offsets = focusCandidateOffsets(targetNode.bounds, rootBounds);
  const modelCenter = centerOf(rootBounds);
  const outward = normalize([center[0] - modelCenter[0], center[1] - modelCenter[1], 0]);
  const results = offsets.map((offset, candidateIndex) => {
    const origin = [center[0] + offset[0] * range, center[1] + offset[1] * range, center[2] + offset[2] * range];
    let occluders = 0;
    let blockingScore = 0;
    for (const other of componentNodes) {
      if (other.id === targetNode.id || !other.bounds) continue;
      if ((other.componentIds || []).some((componentId) => targetIds.has(componentId))) continue;
      const entry = segmentEntry(origin, center, other.bounds);
      if (entry === null) continue;
      occluders += 1;
      blockingScore += 1 + (1 - entry) * 0.2;
    }
    const horizontalLength = Math.hypot(offset[0], offset[1]) || 1;
    const outwardAlignment = (offset[0] * outward[0] + offset[1] * outward[1]) / horizontalLength;
    const preferencePenalty = (1 - outwardAlignment) * 0.035 + Math.abs(offset[2] - 0.65) * 0.025;
    return { offset, occluders, score: blockingScore + preferencePenalty, candidateIndex };
  });
  const defaultResult = results[0];
  results.sort((left, right) => left.score - right.score || left.occluders - right.occluders || left.candidateIndex - right.candidateIndex);
  const best = results[0];
  return {
    offset: best.offset,
    occluders: best.occluders,
    defaultOccluders: defaultResult.occluders,
    adjusted: best.candidateIndex !== 0 && best.occluders < defaultResult.occluders,
    candidateIndex: best.candidateIndex
  };
}

export function deriveRootBounds(nodes) {
  const bounded = nodes.filter((node) => Array.isArray(node.bounds) && node.bounds.length === 6);
  if (!bounded.length) return null;
  return bounded.reduce((result, node) => [
    Math.min(result[0], node.bounds[0]), Math.min(result[1], node.bounds[1]), Math.min(result[2], node.bounds[2]),
    Math.max(result[3], node.bounds[3]), Math.max(result[4], node.bounds[4]), Math.max(result[5], node.bounds[5])
  ], [...bounded[0].bounds]);
}
