/**
 * clientIpContent — the plain-English layer over /admin/health/client-ip.
 *
 * The report answers one question: when someone hammers the login screen, does
 * the API know it's the same someone? Everything here turns header names and
 * proxy hops into that question. All pure — no React, no fetching.
 *
 * Statuses come from the server, never from thresholds redeclared here, same
 * as every other /admin/health/* screen.
 */

import type { ClientIpObservation, ClientIpReport } from '../../services/api';

/**
 * What each check means, in terms of what could actually happen to the app.
 * The trap this screen exists to expose is that broken rate limiting looks
 * identical to working rate limiting — the 429s still come back.
 */
export const CLIENT_IP_EXPLANATIONS: Readonly<Record<string, string>> = {
  throttles_bind_per_caller:
    'Sign-in, sign-up and password-reset have a cap on attempts, and the only thing identifying a signed-out attacker is the address their request came from. If that address is really a shared piece of network equipment, the cap counts everyone together: the attacker gets far more tries than the number suggests, and the honest users behind the same equipment get locked out by the attacker’s traffic.',
  client_ip_source:
    'Which piece of information the cap is counting against. Only the CDN’s own header names one caller. Anything else names a machine that thousands of callers pass through, so it counts the wrong thing — quietly, and with no error anywhere.',
  cdn_client_ip_header:
    'Cloudflare knows who called, because the caller’s connection ends there. It passes that on in a header. Railway rewrites the standard forwarding header and drops what Cloudflare put in it, so this is the one place the real address can still be. If nothing shows here, it did not survive the trip and no amount of configuration will fix it.',
  origin_proof:
    'Our server on Railway will answer anyone who finds its address directly, without going through Cloudflare. So a header saying "the caller is 1.2.3.4" proves nothing on its own — anyone could send it and hand themselves a private, unlimited allowance. The fix is a shared password that Cloudflare stamps on every request it forwards: no stamp, header ignored.',
};

export function explanationForClientIpMetric(key: string): string {
  return CLIENT_IP_EXPLANATIONS[key] ?? 'No description available for this check yet.';
}

/**
 * The line under the hero. States the one caveat that invalidates the whole
 * screen if ignored: this describes the request that loaded it. Opened over
 * the phone's network it is a real measurement; opened through anything that
 * re-routes the request, it measures that instead.
 */
export const MEASUREMENT_NOTE =
  'This describes the request your phone just made, not an average over time. ' +
  'That makes it a live test — but only while the phone is on a normal internet ' +
  'connection. On a VPN or a corporate network you are measuring that, not the app.';

/** Where this request actually came from, one line per hop we can see. */
export interface TraceRow {
  label: string;
  value: string;
  /** True for the value the throttles are keyed on. */
  used: boolean;
}

export function traceRows(obs: ClientIpObservation): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const [name, value] of Object.entries(obs.candidate_headers).sort()) {
    rows.push({ label: name, value, used: obs.source === 'trusted-header' && value === obs.client_ip });
  }
  rows.push({
    label: 'x-forwarded-for',
    value: obs.forwarded_for ?? 'not sent',
    used: obs.source === 'forwarded-for',
  });
  rows.push({
    label: 'connecting socket',
    value: obs.socket_peer ?? 'unknown',
    used: obs.source === 'socket-peer',
  });
  return rows;
}

/**
 * One sentence naming what is being counted, which is the whole finding. An
 * address on its own tells you nothing — 100.64.0.4 looks as much like a
 * caller as any other number until you know it is Railway's internal router.
 */
export function keySummary(obs: ClientIpObservation): string {
  switch (obs.source) {
    case 'trusted-header':
      return obs.rate_limit_key === obs.client_ip
        ? `Counting attempts against ${obs.client_ip}, the caller’s own address.`
        : `Counting attempts against ${obs.rate_limit_key} — the block this caller’s ` +
          `internet provider gave them, rather than ${obs.client_ip} exactly. Phones ` +
          `change the tail end of an IPv6 address on their own, so counting the exact ` +
          `one would hand the same person a fresh allowance every few hours.`;
    case 'forwarded-for':
      return `Counting attempts against ${obs.client_ip}, taken from the forwarding header.`;
    case 'socket-peer':
      return `Counting attempts against ${obs.client_ip} — whatever machine opened the connection to us, which behind a CDN is the CDN, shared by everyone.`;
    default:
      return 'Nothing to count against: this request carried no usable address at all.';
  }
}

/** Hero subtitle: the verdict, before any of the detail. */
export function verdict(report: ClientIpReport): string {
  return report.overall_status === 'ok'
    ? 'Sign-in and password-reset limits are counting per person.'
    : 'Sign-in and password-reset limits are not counting per person.';
}
