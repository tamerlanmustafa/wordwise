/**
 * Pricing / Stripe checkout scaffold for web.
 *
 * SETUP REQUIRED:
 *   1. Create a Stripe account at https://stripe.com
 *   2. Create products: "WordWise Plus Monthly" and "WordWise Plus Annual"
 *   3. Set STRIPE_SECRET_KEY env var on the backend
 *   4. Set VITE_STRIPE_PUBLISHABLE_KEY env var on the frontend
 *   5. Install: npm install @stripe/stripe-js @stripe/react-stripe-js
 *   6. Add backend endpoint: POST /billing/stripe/create-checkout-session
 *
 * Until Stripe is configured, this page shows pricing info with a
 * "Coming soon" state on the checkout buttons.
 */

import { useState } from 'react';
import { Box, Button, Card, CardContent, Chip, Container, Typography, Stack, Alert } from '@mui/material';

const PLANS = [
  {
    id: 'monthly',
    name: 'Monthly',
    price: '$4.99',
    period: '/month',
    features: ['Unlimited SRS reviews', 'No ads', 'Detailed stats', 'Export to Anki/CSV', 'Cross-movie sentences', 'Audio pronunciation'],
    popular: false,
    stripePriceId: 'price_MONTHLY_ID_HERE',
  },
  {
    id: 'annual',
    name: 'Annual',
    price: '$29.99',
    period: '/year',
    savings: 'Save 50%',
    features: ['Everything in Monthly', '2 months free', 'Priority support', 'Family plan eligible'],
    popular: true,
    stripePriceId: 'price_ANNUAL_ID_HERE',
  },
];

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async (_priceId: string, planId: string) => {
    if (!STRIPE_KEY) {
      setError('Stripe is not configured yet. Set VITE_STRIPE_PUBLISHABLE_KEY in your environment.');
      return;
    }

    setLoading(planId);
    setError(null);

    try {
      // TODO: Uncomment when Stripe backend endpoint is created
      // const { loadStripe } = await import('@stripe/stripe-js');
      // const stripe = await loadStripe(STRIPE_KEY);
      //
      // const token = localStorage.getItem('wordwise_token');
      // const res = await fetch(`${API_URL}/billing/stripe/create-checkout-session`, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      //   body: JSON.stringify({ price_id: priceId }),
      // });
      // const { session_id } = await res.json();
      // await stripe?.redirectToCheckout({ sessionId: session_id });

      setError('Stripe checkout is scaffolded but not yet connected. See frontend/src/pages/PricingPage.tsx for setup instructions.');
    } catch (e: any) {
      setError(e.message || 'Checkout failed');
    } finally {
      setLoading(null);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h3" fontWeight={800} textAlign="center" gutterBottom>
        WordWise Plus
      </Typography>
      <Typography variant="h6" color="text.secondary" textAlign="center" sx={{ mb: 4 }}>
        Stop forgetting the words you saved.
      </Typography>

      {error && (
        <Alert severity="info" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} justifyContent="center">
        {PLANS.map((plan) => (
          <Card
            key={plan.id}
            elevation={plan.popular ? 8 : 2}
            sx={{
              flex: 1,
              maxWidth: 360,
              border: plan.popular ? '2px solid #7C5CBF' : '1px solid #E8E8EC',
              position: 'relative',
            }}
          >
            {plan.popular && (
              <Chip
                label="Most Popular"
                color="primary"
                size="small"
                sx={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)' }}
              />
            )}
            <CardContent sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="h5" fontWeight={700} gutterBottom>
                {plan.name}
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h3" fontWeight={800} component="span" color="primary">
                  {plan.price}
                </Typography>
                <Typography variant="body1" color="text.secondary" component="span">
                  {plan.period}
                </Typography>
              </Box>
              {plan.savings && (
                <Chip label={plan.savings} color="success" size="small" sx={{ mb: 2 }} />
              )}
              <Stack spacing={1} sx={{ mb: 3, textAlign: 'left' }}>
                {plan.features.map((f) => (
                  <Typography key={f} variant="body2" color="text.secondary">
                    ✓ {f}
                  </Typography>
                ))}
              </Stack>
              <Button
                variant={plan.popular ? 'contained' : 'outlined'}
                color="primary"
                fullWidth
                size="large"
                disabled={loading === plan.id}
                onClick={() => handleCheckout(plan.stripePriceId, plan.id)}
                sx={{ py: 1.5, fontWeight: 700 }}
              >
                {loading === plan.id ? 'Loading...' : 'Start 7-Day Free Trial'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 3 }}>
        Cancel anytime. 7-day free trial for new subscribers.
      </Typography>

      <Box sx={{ mt: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Student? Get 50% off with a valid .edu email. <a href="/settings">Verify here</a>.
        </Typography>
      </Box>
    </Container>
  );
}
