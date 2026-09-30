function isDevelopmentLanOrigin(origin, nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv === 'production') return false;

  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || !url.port) return false;

    const octets = url.hostname.split('.').map((value) => Number(value));
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;

    return octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  } catch (error) {
    return false;
  }
}

module.exports = { isDevelopmentLanOrigin };