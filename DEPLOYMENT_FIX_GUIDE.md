# Deployment Fix Guide - CORS and OAuth Issues

## Problem Summary
The production deployment was experiencing CORS errors and Google OAuth login failures because:
1. Backend CORS settings didn't include the production frontend URL
2. Frontend production environment wasn't configured with the backend URL
3. Google OAuth redirect URIs need to be updated in Google Cloud Console

## Changes Made Locally

### 1. Backend Configuration (`backend/.env`)
```
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,https://tamerlanmustafa.github.io
GOOGLE_REDIRECT_URI=https://tamerlanmustafa.github.io/wordwise/
```

### 2. Frontend Configuration (`frontend/.env.production`)
```
VITE_API_URL=https://wordwise-backend-3i5n.onrender.com
VITE_GOOGLE_CLIENT_ID=400446242104-gvfqp0soikdji99132k59nlh88moucpt.apps.googleusercontent.com
VITE_TMDB_API_KEY=9dece7a38786ac0c58794d6db4af3d51
```

### 3. Frontend Built Successfully
The production build has been created in `frontend/dist/`

## Steps to Complete Deployment

### Step 1: Update Google Cloud Console OAuth Settings
**CRITICAL: You must do this manually**

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to "APIs & Services" → "Credentials"
3. Find your OAuth 2.0 Client ID: `400446242104-gvfqp0soikdji99132k59nlh88moucpt.apps.googleusercontent.com`
4. Click "Edit"
5. Under "Authorized JavaScript origins", add:
   - `https://tamerlanmustafa.github.io`
6. Under "Authorized redirect URIs", add:
   - `https://tamerlanmustafa.github.io/wordwise/`
   - `https://tamerlanmustafa.github.io/wordwise/auth/callback`
7. Click "Save"

### Step 2: Update Render Backend Environment Variables
**CRITICAL: You must do this on Render dashboard**

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Select your backend service: `wordwise-backend-3i5n`
3. Go to "Environment" tab
4. Update/Add these environment variables:
   ```
   ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,https://tamerlanmustafa.github.io
   GOOGLE_REDIRECT_URI=https://tamerlanmustafa.github.io/wordwise/
   ```
5. Click "Save Changes"
6. The backend will automatically redeploy with the new settings

### Step 3: Deploy Frontend to GitHub Pages

The project has a GitHub Actions workflow that automatically deploys to GitHub Pages.

Simply commit and push the changes:

```bash
git add .
git commit -m "Fix CORS and OAuth configuration for production deployment"
git push origin main
```

The GitHub Actions workflow will:
1. Install frontend dependencies
2. Build the production version (using `.env.production`)
3. Deploy to GitHub Pages automatically

Monitor the deployment:
- Go to your GitHub repository
- Click on "Actions" tab
- Watch the "Deploy Vite App to GitHub Pages" workflow run

### Step 4: Verify Deployment

1. Wait for GitHub Pages deployment to complete (check Actions tab)
2. Wait for Render backend to finish redeploying
3. Visit: `https://tamerlanmustafa.github.io/wordwise/`
4. Try Google OAuth login
5. Check browser console for any errors

## Expected Results

After completing all steps:
- ✅ No CORS errors
- ✅ Google OAuth login works on production
- ✅ API calls to Render backend succeed
- ✅ All features work as in local development

## Troubleshooting

### If CORS errors persist:
1. Check Render backend logs to confirm environment variables were applied
2. Verify `ALLOWED_ORIGINS` includes `https://tamerlanmustafa.github.io` (no trailing slash)
3. Clear browser cache and try again

### If Google OAuth fails:
1. Check Google Cloud Console authorized origins and redirect URIs
2. Verify the redirect URI exactly matches what's configured
3. Check browser console for specific OAuth error messages

### If API calls fail:
1. Verify `VITE_API_URL` in `.env.production` is correct
2. Check that Render backend is running (not suspended)
3. Test backend directly: `https://wordwise-backend-3i5n.onrender.com/health`

## Quick Reference

**Production URLs:**
- Frontend: `https://tamerlanmustafa.github.io/wordwise/`
- Backend: `https://wordwise-backend-3i5n.onrender.com`

**Google Client ID:**
`400446242104-gvfqp0soikdji99132k59nlh88moucpt.apps.googleusercontent.com`

**Required Authorized Origins:**
- `http://localhost:3000` (development)
- `https://tamerlanmustafa.github.io` (production)

**Required Redirect URIs:**
- `http://localhost:3000/auth/callback` (development)
- `https://tamerlanmustafa.github.io/wordwise/` (production)
- `https://tamerlanmustafa.github.io/wordwise/auth/callback` (production)
