// AmerTech's public key: news items and plugins from the Nova team are signed with its private
// key (kept off GitHub), so a changed or foreign file is never shown or installed.
const crypto = require('crypto');

const PUBLIC_KEY = crypto.createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAB9MjI9rEIq86S4Wx0diaLPKJY+jX8rQhhu5jQqe//hk=
-----END PUBLIC KEY-----`);

// one fixed text for an object: keys sorted at every level, so the signature doesn't depend on
// how the file happens to be formatted
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function verify(obj, sig, key = PUBLIC_KEY) {
  try {
    return typeof sig === 'string' && crypto.verify(null, Buffer.from(canonical(obj)), key, Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}

module.exports = { canonical, verify };
