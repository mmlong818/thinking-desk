import { isIP } from 'node:net';

type V4 = readonly [number, number, number, number];

// [base, prefix length]
const BLOCKED_V4: ReadonlyArray<readonly [V4, number]> = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

function v4ToInt(p: V4): number {
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function isBlockedV4(p: V4): boolean {
  const n = v4ToInt(p);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function parseV4(s: string): V4 | null {
  const parts = s.split('.').map(Number);
  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

function groupsToV4(hi: number, lo: number): V4 {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

// Expands any textual IPv6 (already validated by isIP) into 8 16-bit groups.
function parseV6(s: string): number[] | null {
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const tok of part.split(':')) {
      if (tok.includes('.')) {
        const v4 = parseV4(tok);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(tok)) return null;
        out.push(parseInt(tok, 16));
      }
    }
    return out;
  };
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function isBlockedV6(g: readonly number[]): boolean {
  const zeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d); this also covers :: and ::1 via 0.0.0.0/8.
  if (zeroPrefix(5) && g[5] === 0xffff) return isBlockedV4(groupsToV4(g[6], g[7]));
  if (zeroPrefix(6)) return isBlockedV4(groupsToV4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // 64:ff9b::/96 embeds the IPv4 address; 64:ff9b:1::/48 is local-use NAT64.
    if (g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return isBlockedV4(groupsToV4(g[6], g[7]));
    return g[2] === 1;
  }
  if (g[0] === 0x2002) return isBlockedV4(groupsToV4(g[1], g[2])); // 6to4 embeds an IPv4 address
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return g[0] === 0x2001 && g[1] === 0x0db8; // documentation
}

export function isBlockedAddress(ip: string): boolean {
  if (typeof ip !== 'string') return true;
  let s = ip.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  const kind = isIP(s);
  if (kind === 4) {
    const p = parseV4(s);
    return p ? isBlockedV4(p) : true;
  }
  if (kind === 6) {
    const g = parseV6(s);
    return g ? isBlockedV6(g) : true;
  }
  return true;
}
