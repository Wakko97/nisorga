import dns from "dns";
import net from "net";

/**
 * SSRF guard for user-supplied webhook URLs: rejects anything that isn't a
 * plain http(s) URL resolving only to public IP addresses. Used both when a
 * webhook is registered and again right before dispatch (TOCTOU: DNS can
 * change between the two).
 */

function ipv4ToLong(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const long = ipv4ToLong(ip);
  const inRange = (base: string, bits: number) => {
    const baseLong = ipv4ToLong(base);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (long & mask) === (baseLong & mask);
  };
  return (
    inRange("127.0.0.0", 8) || // loopback
    inRange("10.0.0.0", 8) || // private
    inRange("172.16.0.0", 12) || // private
    inRange("192.168.0.0", 16) || // private
    inRange("169.254.0.0", 16) || // link-local incl. cloud metadata (169.254.169.254)
    inRange("0.0.0.0", 8) || // "this" network
    inRange("100.64.0.0", 10) || // carrier-grade NAT
    inRange("224.0.0.0", 4) // multicast
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 (unique local)
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (lower.startsWith("ff")) return true; // multicast
  // IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) — check the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isDisallowedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not a recognizable IP — reject rather than let it slip through
}

/**
 * Throws if `url` is not safe to make a server-side HTTP request to:
 * wrong protocol, or its hostname resolves to a private/loopback/link-local/
 * multicast/metadata address (including 169.254.169.254).
 */
export async function assertPublicHttpUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }

  const hostname = parsed.hostname;
  if (hostname.toLowerCase() === "localhost") {
    throw new Error("URL not allowed");
  }

  // If the hostname is already a literal IP, check it directly.
  if (net.isIP(hostname)) {
    if (isDisallowedIp(hostname)) throw new Error("URL not allowed");
    return;
  }

  const addresses = await dns.promises.lookup(hostname, { all: true });
  if (addresses.length === 0) throw new Error("URL could not be resolved");
  for (const addr of addresses) {
    if (isDisallowedIp(addr.address)) throw new Error("URL not allowed");
  }
}
