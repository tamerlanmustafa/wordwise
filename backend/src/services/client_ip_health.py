"""
Does IP-keyed rate limiting actually bind? (issue #139)

Every anonymous throttle in the API — `auth-login`, `auth-register`,
`auth-forgot-password`, `auth-reset-password`, and the app-wide 600/min ceiling
— keys on the caller's address, because an unauthenticated request carries
nothing else stable to key on. If that address is not per-caller, the limits
still *return 429s* and still *look* enforced, but each attacker request lands
in a different bucket and the brute-force budget is multiplied by however many
addresses the platform rotates through.

Measured on Railway 2026-08-17: the caller's real address reaches the process
at no index of any header. Cloudflare sends one, Railway discards it and
rebuilds `X-Forwarded-For` from its own hops, so `trusted_proxy_hops=1`
resolves to a pool of five edge addresses and `=2` to a Cloudflare egress
address. Neither is a caller. The fix is Cloudflare's own `CF-Connecting-IP`,
which is only safe once the origin can prove it is being fronted — see
`utils/rate_limit._origin_secret_matches`.

Why this report is per-request rather than a window
---------------------------------------------------
The other /admin/health/* reports aggregate a rolling window because they
measure load. This one measures *topology*, which one real request from
outside the network settles completely: either the header arrived or it did
not. So the report describes the request that asked for it, and the honest way
to read it is to call it from off-network — from inside the platform the
answer is about the platform, not about callers.

Shares the metric contract in `health_metrics` so the admin app renders it with
the same card component as the latency and event-loop reports.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from .health_metrics import FAIL, OK, WARN, metric, overall_status

# A CDN client-IP header arriving means something terminates connections in
# front of this process and knows who the caller is. Not using it is then a
# choice the report should call a failure, not a quiet default.
_CDN_HEADER_HINT = "candidate_headers"


def _per_caller(obs: dict[str, Any]) -> bool:
    """Is the resolved address one caller, or a proxy standing in for many?

    `socket-peer` is exactly right for a directly-exposed process and exactly
    wrong behind a proxy, and the same value means both — so the verdict comes
    from what else arrived on the request, not from the source alone.
    """
    if obs["source"] == "trusted-header":
        return True
    return not obs[_CDN_HEADER_HINT] and not obs["forwarded_for"]


def _source_status(obs: dict[str, Any]) -> str:
    if _per_caller(obs):
        return OK
    if obs[_CDN_HEADER_HINT]:
        # A CDN is in front and is telling us the caller; we're ignoring it.
        return FAIL
    # Proxied, but with no per-caller address on offer. Shared bucket — weak,
    # though not forgeable.
    return WARN


def _source_detail(obs: dict[str, Any]) -> str:
    if obs["source"] == "trusted-header":
        return (
            f"keyed on {obs['trusted_client_ip_header']}, which the origin secret "
            "proved the CDN set — anonymous throttles bind per caller"
        )
    if obs[_CDN_HEADER_HINT]:
        names = ", ".join(sorted(obs[_CDN_HEADER_HINT]))
        return (
            f"a CDN is sending the caller's address ({names}) and it is being ignored, "
            "so every anonymous throttle keys on a shared proxy address instead"
        )
    if obs["forwarded_for"]:
        return (
            "proxied, but no per-caller address arrived — all callers behind this "
            "proxy share one bucket"
        )
    return "nothing is proxying this request, so the socket peer is the caller"


def _origin_proof_status(obs: dict[str, Any]) -> str:
    """Whether the CDN can prove it is the CDN.

    Without the proof the client-IP header is refused, so the failure mode is
    an inert feature rather than a forgeable one — but the deployment is then
    still running with limits that don't bind, which is a fail, not a warn.
    """
    if obs["origin_secret_matched"]:
        return OK
    if obs["trusted_client_ip_header"]:
        # Configured to trust a header, but nothing proves the CDN set it, so
        # the header is (correctly) being refused and the limits don't bind.
        return FAIL
    if obs[_CDN_HEADER_HINT]:
        # A CDN is in front and the proof isn't set up yet: the one thing
        # standing between this deployment and working rate limits.
        return WARN
    # Nothing is fronting this request, so there is nothing to prove.
    return OK


def _origin_proof_detail(obs: dict[str, Any]) -> str:
    if obs["origin_secret_matched"]:
        return f"{obs['origin_secret_header']} matched on this request"
    if not obs["origin_secret_configured"]:
        if not obs[_CDN_HEADER_HINT]:
            return "nothing is fronting this request, so there is nothing to prove"
        return (
            "no origin secret is configured, so no client-IP header can be trusted: "
            "the Railway origin answers requests that never went through Cloudflare, "
            "and a header anyone can set is worse than a shared bucket"
        )
    return (
        f"{obs['origin_secret_header']} is configured but did not match on this "
        "request — either this request bypassed the CDN, or the Cloudflare rule and "
        "the Railway variable have drifted apart"
    )


def _cdn_header_status(obs: dict[str, Any]) -> str:
    """The step-one question: is a per-caller address on offer at all?

    A warning only when something *is* proxying and still no CDN header
    arrived — that is the dead end where the platform strips it and keying on
    an address cannot be made to work. With nothing in front, there is no
    header to want.
    """
    if obs[_CDN_HEADER_HINT] or _per_caller(obs):
        return OK
    return WARN


def _cdn_header_detail(obs: dict[str, Any]) -> str:
    seen = obs[_CDN_HEADER_HINT]
    if seen:
        return "; ".join(f"{name}: {value}" for name, value in sorted(seen.items()))
    if _per_caller(obs):
        return "nothing is fronting this request, so the socket peer is already the caller"
    return (
        "this request is proxied and no CDN client-IP header reached the app — the "
        "platform strips it, so rate limits here cannot key on an address"
    )


def _next_step(obs: dict[str, Any]) -> str:
    """What to do about it, in the order the steps are safe to take."""
    if _per_caller(obs):
        return "nothing — anonymous throttles are keyed per caller"
    if not obs[_CDN_HEADER_HINT]:
        return (
            "confirm this was called from outside the network; if a CDN client-IP "
            "header still doesn't arrive, the platform strips it and rate limits "
            "have to key on something other than an address"
        )
    if not obs["origin_secret_configured"]:
        return (
            "add a Cloudflare Transform Rule setting a secret header on requests to "
            "the origin, then set TRUSTED_CLIENT_IP_SECRET_HEADER and "
            "TRUSTED_CLIENT_IP_SECRET on Railway to match"
        )
    if not obs["origin_secret_matched"]:
        return (
            "the origin secret didn't match — check the Cloudflare rule and the "
            "Railway variable are the same value, and that this request went "
            "through the CDN"
        )
    return (
        "set TRUSTED_CLIENT_IP_HEADER=CF-Connecting-IP on Railway; the origin proof "
        "is already in place"
    )


def build_report(
    obs: dict[str, Any], moment: Optional[datetime] = None
) -> dict[str, Any]:
    """Turn one request's observation into the shared health-report shape."""
    moment = moment or datetime.now(timezone.utc)
    binds = _per_caller(obs)

    metrics = [
        metric(
            "throttles_bind_per_caller",
            "Anonymous throttles bind per caller",
            # Every metric in this report is a state, not a quantity, so the
            # values are strings: there is no meter to draw and "yes"/"no"
            # reads better on the admin card than a bare boolean. Anything a
            # machine should branch on is in `observed` below.
            "yes" if binds else "no",
            "",
            OK if binds else FAIL,
            "fail unless the key is per-caller",
            detail=(
                "login, registration and password-reset limits are only as strong as "
                "this — when it is false one attacker's budget is multiplied across "
                "the addresses the platform rotates through, and they share a bucket "
                "with real users, so they can lock others out too"
            ),
        ),
        metric(
            "client_ip_source",
            "Rate-limit key source",
            obs["source"],
            "",
            _source_status(obs),
            "ok: trusted-header (or unproxied)",
            detail=_source_detail(obs),
        ),
        metric(
            "cdn_client_ip_header",
            "CDN client-IP header reaching the app",
            ", ".join(sorted(obs[_CDN_HEADER_HINT])) or "none",
            "",
            _cdn_header_status(obs),
            "must arrive before it can be trusted",
            detail=_cdn_header_detail(obs),
        ),
        metric(
            "origin_proof",
            "Origin secret proving the CDN set it",
            "matched" if obs["origin_secret_matched"] else (
                "configured, not matched" if obs["origin_secret_configured"] else "not configured"
            ),
            "",
            _origin_proof_status(obs),
            "required before any client-IP header is trusted",
            detail=_origin_proof_detail(obs),
        ),
    ]

    return {
        "generated_at": moment.isoformat(),
        "overall_status": overall_status(metrics),
        "metrics": metrics,
        "next_step": _next_step(obs),
        # The raw inputs behind the verdict, so a mismatch can be debugged
        # without redeploying with extra logging. No secret values here.
        "observed": obs,
    }


__all__ = ["build_report"]
