const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function isPrerelease(version) {
  const parsed = parseVersion(version);
  return parsed !== null && parsed.prerelease.length > 0;
}

export function compareVersions(left, right) {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  if (!leftParsed || !rightParsed) {
    throw new Error(`cannot compare versions (left: ${left}, right: ${right})`);
  }
  for (const part of ['major', 'minor', 'patch']) {
    if (leftParsed[part] !== rightParsed[part]) {
      return leftParsed[part] - rightParsed[part];
    }
  }
  return comparePrerelease(leftParsed.prerelease, rightParsed.prerelease);
}

export function highestStable(versions) {
  const stable = versions.filter((version) => parseVersion(version) !== null && !isPrerelease(version));
  if (stable.length === 0) {
    return null;
  }
  return stable.reduce((best, version) => (compareVersions(version, best) > 0 ? version : best));
}

// The versions a `^`/`~` spec anchored at `current` admits: what `npm install`
// could move to without the spec changing.
export function highestStableWithinRange(versions, current, prefix) {
  const anchor = parseVersion(current);
  if (!anchor || prefix === '') {
    return null;
  }
  const admitted = versions.filter((version) => {
    const parsed = parseVersion(version);
    if (!parsed) {
      return false;
    }
    switch (prefix) {
      case '^':
        return anchor.major === 0 ? parsed.major === 0 && parsed.minor === anchor.minor : parsed.major === anchor.major;
      case '~':
        return parsed.major === anchor.major && parsed.minor === anchor.minor;
      default:
        return false;
    }
  });
  return highestStable(admitted);
}

// Below 1.0.0 a minor bump is the breaking one, so it ranks as major.
export function bumpLevel(from, to) {
  const fromParsed = parseVersion(from);
  const toParsed = parseVersion(to);
  if (!fromParsed || !toParsed) {
    throw new Error(`cannot classify bump (from: ${from}, to: ${to})`);
  }
  if (fromParsed.major !== toParsed.major) {
    return 'major';
  }
  if (fromParsed.minor !== toParsed.minor) {
    return fromParsed.major === 0 ? 'major' : 'minor';
  }
  return 'patch';
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) {
      return -1;
    }
    if (right[index] === undefined) {
      return 1;
    }
    const leftNumeric = /^\d+$/.test(left[index]);
    const rightNumeric = /^\d+$/.test(right[index]);
    if (leftNumeric && rightNumeric) {
      const difference = Number(left[index]) - Number(right[index]);
      if (difference !== 0) {
        return difference;
      }
    } else if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}
