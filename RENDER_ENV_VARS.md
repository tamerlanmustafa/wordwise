# Render Environment Variables

Add these environment variables to your Render backend service:

## Required Variables (Already Added)
```bash
DATABASE_URL=<your-postgres-internal-url>
JWT_SECRET_KEY=<your-jwt-secret>
TMDB_API_KEY=9dece7a38786ac0c58794d6db4af3d51
GOOGLE_CLIENT_ID=400446242104-gvfqp0soikdji99132k59nlh88moucpt.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-new-google-client-secret>
GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google_service.json
```

## MISSING - Add These Now to Fix STANDS4 Error

```bash
USER_ID=13215
TOKEN=1QkSBAoK6Ss2L5Gt
SCRIPTS_URL=https://www.stands4.com/services/v2/scripts.php
```

## Optional (But Recommended)

```bash
# DeepL Translation (better quality than Google for supported languages)
DEEPL_API_KEY=ac3fb787-112b-48f2-8290-42a9f87dc99e:fx
DEEPL_PLAN=free

# Google Translate (fallback)
GOOGLE_TRANSLATE_ENABLED=true

# Application Settings
DEBUG=False
ALLOWED_ORIGINS=https://tamerlanmustafa.github.io
```

---

## Steps to Add

1. Go to Render dashboard → wordwise-backend service
2. Click "Environment" tab
3. Add the three STANDS4 variables listed above
4. Save changes
5. Render will automatically redeploy

This will fix the error:
```
ValueError: STANDS4 credentials (USER_ID and TOKEN) are required
```
