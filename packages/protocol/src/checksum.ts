/**
 * 16-bit big-endian sum of the message body (START byte through the last data
 * byte). Port of the Python `cksum()` in pool-controller/tools.
 */
export function checksum(body: readonly number[] | Uint8Array): [number, number] {
  let sum = 0;
  for (const b of body) sum += b;
  return [(sum >> 8) & 0xff, sum & 0xff];
}
