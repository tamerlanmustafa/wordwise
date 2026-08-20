import {
  CLIENT_IP_EXPLANATIONS,
  MEASUREMENT_NOTE,
  explanationForClientIpMetric,
  keySummary,
  traceRows,
  verdict,
} from '../clientIpContent';
import { formatMetricValue, meterGeometry } from '../healthMetricContent';
import type { ClientIpObservation, ClientIpReport, HealthMetric } from '../../../services/api';

/** What prod actually sends today: Cloudflare names the caller, nothing uses it. */
const broken = (over: Partial<ClientIpObservation> = {}): ClientIpObservation => ({
  client_ip: '100.64.0.4',
  rate_limit_key: '100.64.0.4',
  source: 'socket-peer',
  socket_peer: '100.64.0.4',
  forwarded_for: '104.22.100.36, 152.233.47.66',
  trusted_proxy_hops: 0,
  candidate_headers: { 'cf-connecting-ip': '71.117.29.127' },
  trusted_client_ip_header: null,
  trusted_client_ip_header_value: null,
  origin_secret_header: null,
  origin_secret_configured: false,
  origin_secret_matched: false,
  ...over,
});

const working = (): ClientIpObservation =>
  broken({
    client_ip: '71.117.29.127',
    rate_limit_key: '71.117.29.127',
    source: 'trusted-header',
    trusted_client_ip_header: 'CF-Connecting-IP',
    trusted_client_ip_header_value: '71.117.29.127',
    origin_secret_header: 'X-Origin-Secret',
    origin_secret_configured: true,
    origin_secret_matched: true,
  });

describe('traceRows', () => {
  it('marks which value the limits are actually counting', () => {
    // The finding is never the address itself — 100.64.0.4 looks like a caller
    // until you see it is the socket peer and that a real one arrived elsewhere.
    const rows = traceRows(broken());
    expect(rows.find((r) => r.used)?.label).toBe('connecting socket');
    expect(rows.map((r) => r.label)).toEqual([
      'cf-connecting-ip',
      'x-forwarded-for',
      'connecting socket',
    ]);
  });

  it('marks the CDN header once it is the one being trusted', () => {
    const rows = traceRows(working());
    const used = rows.filter((r) => r.used);
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ label: 'cf-connecting-ip', value: '71.117.29.127' });
  });

  it('shows a missing forwarding header as absent rather than blank', () => {
    const rows = traceRows(broken({ forwarded_for: null, candidate_headers: {} }));
    expect(rows.find((r) => r.label === 'x-forwarded-for')?.value).toBe('not sent');
  });
});

describe('keySummary', () => {
  it('says a shared machine is shared, which the address alone never shows', () => {
    expect(keySummary(broken())).toContain('shared by everyone');
  });

  it('names the caller when the CDN header is trusted', () => {
    expect(keySummary(working())).toContain('71.117.29.127');
  });

  it('handles a request with nothing to key on', () => {
    expect(
      keySummary(broken({ source: 'none', client_ip: 'unknown', rate_limit_key: 'unknown' }))
    ).toContain('no usable address');
  });

  it('explains the IPv6 block when the bucket is wider than the address', () => {
    // Otherwise the screen shows one address while the budget is spent by a
    // different-looking one, and the grouping reads as a bug.
    const text = keySummary(
      broken({
        source: 'trusted-header',
        client_ip: '2600:4040:27ed:9700:a93d:371:696a:34dc',
        rate_limit_key: '2600:4040:27ed:9700::/64',
      })
    );
    expect(text).toContain('2600:4040:27ed:9700::/64');
    expect(text).toContain('internet provider');
  });
});

describe('verdict', () => {
  const report = (status: ClientIpReport['overall_status']): ClientIpReport => ({
    generated_at: '2026-08-20T12:00:00Z',
    overall_status: status,
    metrics: [],
    next_step: 'x',
    observed: broken(),
  });

  it('leads with what it means for users, not with a header name', () => {
    expect(verdict(report('fail'))).toContain('not counting per person');
    expect(verdict(report('ok'))).toContain('counting per person');
  });
});

describe('explanations', () => {
  it('covers every metric the server sends', () => {
    for (const key of [
      'throttles_bind_per_caller',
      'client_ip_source',
      'cdn_client_ip_header',
      'origin_proof',
    ]) {
      expect(CLIENT_IP_EXPLANATIONS[key]).toBeDefined();
    }
  });

  it('degrades to a sentence rather than undefined for an unknown key', () => {
    expect(explanationForClientIpMetric('invented')).toContain('No description');
  });

  it('states the caveat that would otherwise make the screen misleading', () => {
    // Read over a VPN this screen measures the VPN, not the app.
    expect(MEASUREMENT_NOTE).toContain('VPN');
  });
});

describe('shared metric formatting with state-valued metrics', () => {
  const stateMetric = (over: Partial<HealthMetric> = {}): HealthMetric => ({
    key: 'client_ip_source',
    label: 'Rate-limit key source',
    value: 'socket-peer',
    unit: '',
    status: 'fail',
    threshold: 'ok: trusted-header (or unproxied)',
    warn_at: null,
    fail_at: null,
    direction: 'max',
    max_value: null,
    ...over,
  });

  it('prints a state as written instead of trying to format it as a number', () => {
    expect(formatMetricValue(stateMetric())).toBe('socket-peer');
    expect(formatMetricValue(stateMetric({ value: 'yes' }))).toBe('yes');
  });

  it('draws no meter for a value that has no position on a scale', () => {
    expect(meterGeometry(stateMetric({ max_value: 100 }))).toBeNull();
  });

  it('leaves numeric metrics on the other reports formatting as before', () => {
    expect(formatMetricValue(stateMetric({ value: 1234, unit: 'ms' }))).toBe('1,234 ms');
    expect(meterGeometry(stateMetric({ value: 50, max_value: 100, warn_at: 90 }))).toEqual({
      fillPct: 50,
      warnPct: 90,
      failPct: null,
    });
  });
});
