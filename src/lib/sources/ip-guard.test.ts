import { describe, expect, it } from 'vitest';
import { isBlockedAddress } from './ip-guard';

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.5',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.0.9',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.10',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks IPv4 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '::',
    '::1',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '2001:db8::1',
    '2001:0db8:ffff::1',
    '64:ff9b::7f00:1',
    '64:ff9b::10.0.0.1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.1.2.3',
    '::ffff:a9fe:a9fe',
    '::127.0.0.1',
    '::10.0.0.1',
    '2002:c0a8:101::1',
  ])('blocks IPv6 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it('handles bracketed and zone-id forms', () => {
    expect(isBlockedAddress('[::1]')).toBe(true);
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true);
    expect(isBlockedAddress('[fe80::1%25eth0]')).toBe(true);
    expect(isBlockedAddress('[2606:4700:4700::1111]')).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '198.20.0.1',
    '223.255.255.254',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:0808:0808::1',
  ])('allows public %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it.each(['', 'garbage', '999.1.1.1', '1.2.3', '1.2.3.4.5', '::g', '12345::1', 'example.com', '[::1', '1:2:3:4:5:6:7:8:9'])(
    'blocks unparseable %j',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    },
  );
});
